import { Linking, NativeModules, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  FrigateConfig,
  FrigateEvent,
  FrigateExport,
  FrigateProfile,
  FrigateRecordingSegment,
  FrigateStats,
  SavedConfig,
} from './types';

export const DEFAULT_SERVER_URL = 'https://frigate.labjaringanukdw.my.id';

const KEY_SERVER = 'frigate_server_url';
const KEY_TOKEN = 'frigate_jwt_token';
const KEY_USER = 'frigate_username';
const KEY_PASS = 'frigate_password';
const KEY_BIO = 'frigate_biometric';
const KEY_REFRESH = 'frigate_refresh_sec';

export function cleanServerUrl(url: string): string {
  let u = url.trim();
  if (!u) return DEFAULT_SERVER_URL;
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = 'https://' + u;
  }
  return u.replace(/\/+$/, '');
}

export async function getSavedConfig(): Promise<SavedConfig> {
  const [serverUrl, token, username, password, bio, refresh] = await Promise.all([
    SecureStore.getItemAsync(KEY_SERVER),
    SecureStore.getItemAsync(KEY_TOKEN),
    SecureStore.getItemAsync(KEY_USER),
    SecureStore.getItemAsync(KEY_PASS),
    SecureStore.getItemAsync(KEY_BIO),
    SecureStore.getItemAsync(KEY_REFRESH),
  ]);
  return {
    serverUrl: serverUrl || DEFAULT_SERVER_URL,
    token: token || null,
    username: username || null,
    password: password || null,
    biometricEnabled: bio === 'true',
    refreshSeconds: Math.max(1, Number(refresh || '2') || 2),
  };
}

export async function saveAuthSession(
  serverUrl: string,
  token: string,
  username?: string,
  password?: string
): Promise<void> {
  const ops: Promise<void>[] = [
    SecureStore.setItemAsync(KEY_SERVER, cleanServerUrl(serverUrl)),
    SecureStore.setItemAsync(KEY_TOKEN, token),
  ];
  if (username !== undefined) ops.push(SecureStore.setItemAsync(KEY_USER, username));
  if (password !== undefined) ops.push(SecureStore.setItemAsync(KEY_PASS, password));
  await Promise.all(ops);
}

export async function saveBiometricPref(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY_BIO, enabled ? 'true' : 'false');
}

export async function saveRefreshSeconds(sec: number): Promise<void> {
  await SecureStore.setItemAsync(KEY_REFRESH, String(sec));
}

export async function clearAuthSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_TOKEN),
    SecureStore.deleteItemAsync(KEY_PASS),
  ]);
}

export function authHeaders(token: string | null): Record<string, string> {
  if (!token || token === 'NO_AUTH') return {};
  return {
    Cookie: `frigate_token=${token}`,
    Authorization: `Bearer ${token}`,
  };
}

function extractFrigateToken(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/frigate_token=([^;,\s]+)/);
  return match ? match[1] : null;
}

export async function loginFrigate(
  serverUrl: string,
  user: string,
  password: string
): Promise<{ token: string; profile: FrigateProfile }> {
  const base = cleanServerUrl(serverUrl);
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ user, password }),
  });

  if (!res.ok) {
    let msg = `Login gagal (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) msg = data.message;
    } catch {
      // ignore non-json
    }
    throw new Error(msg);
  }

  const cookieHeader = res.headers.get('set-cookie');
  const token = extractFrigateToken(cookieHeader) || 'COOKIE_SESSION';

  let profile: FrigateProfile = { username: user, role: 'admin' };
  try {
    profile = await fetchProfile(base, token);
  } catch {
    // fallback to provided username
  }

  return { token, profile };
}

async function apiFetch(
  serverUrl: string,
  token: string | null,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = cleanServerUrl(serverUrl);
  const headers: Record<string, string> = {
    ...authHeaders(token),
    ...(init?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${base}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (res.status === 401) {
    throw new Error('401 Unauthorized');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res;
}

export async function fetchProfile(
  serverUrl: string,
  token: string | null
): Promise<FrigateProfile> {
  const res = await apiFetch(serverUrl, token, '/api/profile');
  const data = await res.json();
  return {
    username: data?.username || 'user',
    role: data?.role || 'viewer',
  };
}

export async function fetchConfig(
  serverUrl: string,
  token: string | null
): Promise<FrigateConfig> {
  const res = await apiFetch(serverUrl, token, '/api/config');
  return res.json();
}

export async function fetchStats(
  serverUrl: string,
  token: string | null
): Promise<FrigateStats> {
  const res = await apiFetch(serverUrl, token, '/api/stats');
  return res.json();
}

export async function fetchEvents(
  serverUrl: string,
  token: string | null,
  opts?: {
    camera?: string;
    label?: string;
    hasClip?: boolean;
    limit?: number;
    after?: number;
    before?: number;
  }
): Promise<FrigateEvent[]> {
  const params = new URLSearchParams();
  params.set('limit', String(opts?.limit ?? 40));
  if (opts?.camera && opts.camera !== 'all') params.set('cameras', opts.camera);
  if (opts?.label && opts.label !== 'all') params.set('labels', opts.label);
  if (opts?.hasClip) params.set('has_clip', '1');
  if (opts?.after) params.set('after', String(Math.floor(opts.after)));
  if (opts?.before) params.set('before', String(Math.floor(opts.before)));
  const res = await apiFetch(serverUrl, token, `/api/events?${params.toString()}`);
  return res.json();
}

export async function fetchRecordings(
  serverUrl: string,
  token: string | null,
  camera: string,
  afterTs: number,
  beforeTs: number
): Promise<FrigateRecordingSegment[]> {
  const params = new URLSearchParams({
    after: String(Math.floor(afterTs)),
    before: String(Math.floor(beforeTs)),
  });
  const res = await apiFetch(
    serverUrl,
    token,
    `/api/${encodeURIComponent(camera)}/recordings?${params.toString()}`
  );
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function deleteEvent(
  serverUrl: string,
  token: string | null,
  eventId: string
): Promise<void> {
  await apiFetch(serverUrl, token, `/api/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}

export async function toggleCameraFeature(
  serverUrl: string,
  token: string | null,
  camera: string,
  feature: 'recordings' | 'snapshots',
  enable: boolean
): Promise<void> {
  const value = enable ? 'ON' : 'OFF';
  await apiFetch(
    serverUrl,
    token,
    `/api/camera/${encodeURIComponent(camera)}/set/${feature}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }
  );
}

export function getLatestImageUrl(
  serverUrl: string,
  camera: string,
  height = 480,
  ts = Date.now()
): string {
  return `${cleanServerUrl(serverUrl)}/api/${encodeURIComponent(camera)}/latest.jpg?h=${height}&t=${ts}`;
}

export function getEventThumbnailUrl(serverUrl: string, eventId: string): string {
  return `${cleanServerUrl(serverUrl)}/api/events/${encodeURIComponent(eventId)}/thumbnail.jpg`;
}

export function getEventSnapshotUrl(serverUrl: string, eventId: string): string {
  return `${cleanServerUrl(serverUrl)}/api/events/${encodeURIComponent(eventId)}/snapshot.jpg?bbox=1`;
}

export function getEventClipUrl(serverUrl: string, eventId: string): string {
  return `${cleanServerUrl(serverUrl)}/api/events/${encodeURIComponent(eventId)}/clip.mp4`;
}

export function getRangeClipUrl(
  serverUrl: string,
  camera: string,
  startTs: number,
  endTs: number
): string {
  return `${cleanServerUrl(serverUrl)}/api/${encodeURIComponent(camera)}/start/${Math.floor(startTs)}/end/${Math.floor(endTs)}/clip.mp4`;
}

export function getExportVideoUrl(
  serverUrl: string,
  videoPath: string
): string {
  const base = cleanServerUrl(serverUrl);
  const rel = videoPath.replace(/^\/media\/frigate/, '');
  return `${base}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

export async function fetchExports(
  serverUrl: string,
  token: string | null
): Promise<FrigateExport[]> {
  const res = await apiFetch(serverUrl, token, '/api/exports');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function createExport(
  serverUrl: string,
  token: string | null,
  camera: string,
  startTs: number,
  endTs: number,
  name?: string
): Promise<void> {
  await apiFetch(
    serverUrl,
    token,
    `/api/export/${encodeURIComponent(camera)}/start/${Math.floor(startTs)}/end/${Math.floor(endTs)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playback: 'realtime',
        ...(name?.trim() ? { name: name.trim() } : {}),
      }),
    }
  );
}

export async function deleteExport(
  serverUrl: string,
  token: string | null,
  exportId: string
): Promise<void> {
  await apiFetch(
    serverUrl,
    token,
    `/api/export/${encodeURIComponent(exportId)}`,
    { method: 'DELETE' }
  );
}

export async function downloadToPhone(
  url: string,
  fileName: string,
  token: string | null,
  mimeType = 'video/mp4'
): Promise<void> {
  const cookie =
    token && token !== 'COOKIE_SESSION' && token !== 'NO_AUTH'
      ? `frigate_token=${token}`
      : '';
  if (Platform.OS === 'android' && NativeModules.FrigateDownloader) {
    await NativeModules.FrigateDownloader.downloadFile(
      url,
      fileName,
      cookie,
      mimeType
    );
    return;
  }
  await Linking.openURL(url);
}

export function getCameraDisplayName(
  config: FrigateConfig | null,
  cameraKey: string
): string {
  const cam = config?.cameras?.[cameraKey];
  if (cam?.friendly_name) return cam.friendly_name;
  return cameraKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getCameraStreamName(
  config: FrigateConfig | null,
  cameraKey: string
): string {
  const streams = config?.cameras?.[cameraKey]?.live?.streams;
  if (streams) {
    const first = Object.values(streams)[0];
    if (first) return first;
  }
  return cameraKey;
}

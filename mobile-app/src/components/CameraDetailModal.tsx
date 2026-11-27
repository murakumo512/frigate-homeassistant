import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import {
  authHeaders,
  cleanServerUrl,
  downloadToPhone,
  fetchEvents,
  fetchRecordings,
  getCameraDisplayName,
  getCameraStreamName,
  getLatestImageUrl,
  getRangeClipUrl,
  toggleCameraFeature,
} from '../api';
import { LiveSnapshotImage } from './LiveSnapshotImage';
import {
  FrigateConfig,
  FrigateEvent,
  FrigateRecordingSegment,
  FrigateStats,
} from '../types';

interface Props {
  visible: boolean;
  cameraKey: string | null;
  serverUrl: string;
  token: string;
  config: FrigateConfig;
  stats: FrigateStats | null;
  onClose: () => void;
  onRefresh: () => void;
}

interface MergedBlock {
  start_time: number;
  end_time: number;
  hasObjects: boolean;
}

const DAY_SECONDS = 86400;
const SCREEN_W = Dimensions.get('window').width;
const HALF_W = SCREEN_W / 2;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function getDayBounds(dayOffset: number): {
  startTs: number;
  endTs: number;
  label: string;
  shortDate: string;
} {
  const now = new Date();
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    0,
    0,
    0,
    0
  );
  const startTs = Math.floor(d.getTime() / 1000);
  const endTs = startTs + DAY_SECONDS;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
  ];
  const base = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  const label =
    dayOffset === 0
      ? `${base} (Hari Ini)`
      : dayOffset === -1
        ? `${base} (Kemarin)`
        : base;
  const shortDate = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  return { startTs, endTs, label, shortDate };
}

function formatClockSec(secOfDay: number): string {
  const clamped = Math.max(0, Math.min(DAY_SECONDS - 1, Math.floor(secOfDay)));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function formatClockHM(ts: number): string {
  const d = new Date(ts * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDur(sec: number): string {
  if (sec <= 0) return '0 dtk';
  if (sec < 60) return `${sec} dtk`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}d` : `${m} menit`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}j ${rm}m` : `${h} jam`;
}

/**
 * Gabungkan segmen rekaman 10-detikan yang berdekatan (gap <= 15 dtk)
 * agar timeline 24 jam penuh (termasuk rekaman tanpa deteksi/alert) tampil mulus & cepat.
 */
function mergeRecordingSegments(segs: FrigateRecordingSegment[]): MergedBlock[] {
  if (!segs || segs.length === 0) return [];
  const sorted = [...segs].sort((a, b) => a.start_time - b.start_time);
  const out: MergedBlock[] = [];
  for (const s of sorted) {
    const hasObj = (s.objects ?? 0) > 0;
    const prev = out[out.length - 1];
    if (prev && s.start_time - prev.end_time <= 15) {
      prev.end_time = Math.max(prev.end_time, s.end_time);
      prev.hasObjects = prev.hasObjects || hasObj;
    } else {
      out.push({
        start_time: s.start_time,
        end_time: s.end_time,
        hasObjects: hasObj,
      });
    }
  }
  return out;
}

/**
 * Script pinch-to-zoom (1x - 5x), 1-finger pan saat di-zoom, dan double-tap zoom
 * seperti aplikasi EZVIZ. Dipasang di player Live maupun Playback.
 */
const PINCH_ZOOM_CSS = `
  #stage{position:relative;width:100%;height:100%;transform-origin:center center;will-change:transform;touch-action:none;}
  #zoomBadge{position:absolute;top:8px;right:8px;z-index:20;display:none;align-items:center;gap:6px;background:rgba(2,6,23,0.82);color:#f8fafc;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;border:1px solid rgba(59,130,246,0.5);}
  #zoomReset{color:#60a5fa;text-decoration:underline;cursor:pointer;margin-left:4px;}
`;

const PINCH_ZOOM_JS = `
(function(){
  var wrap = document.getElementById('wrap');
  var stage = document.getElementById('stage');
  var badge = document.getElementById('zoomBadge');
  var badgeTxt = document.getElementById('zoomTxt');
  var resetBtn = document.getElementById('zoomReset');

  var scale = 1, tx = 0, ty = 0;
  var startDist = 0, startScale = 1;
  var panStartX = 0, panStartY = 0, startTx = 0, startTy = 0;
  var isPanning = false, lastTap = 0;

  function clampPan() {
    var rect = wrap.getBoundingClientRect();
    var maxX = (rect.width * (scale - 1)) / 2;
    var maxY = (rect.height * (scale - 1)) / 2;
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  }

  function applyTransform() {
    if (scale <= 1.01) { scale = 1; tx = 0; ty = 0; }
    else { clampPan(); }
    stage.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + scale + ')';
    if (scale > 1.02) {
      badgeTxt.textContent = scale.toFixed(1) + 'x';
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function(e){
      e.stopPropagation();
      scale = 1; tx = 0; ty = 0;
      applyTransform();
    });
  }

  function dist(t1, t2) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }

  wrap.addEventListener('touchstart', function(e){
    if (e.touches.length === 2) {
      isPanning = false;
      startDist = dist(e.touches[0], e.touches[1]);
      startScale = scale;
      e.preventDefault();
    } else if (e.touches.length === 1) {
      var now = Date.now();
      // Double tap di area video (bukan di bar controls bawah) untuk toggle zoom 2.5x
      var rect = wrap.getBoundingClientRect();
      var inControls = (e.touches[0].clientY - rect.top) > rect.height - 48;
      if (!inControls && now - lastTap < 280) {
        if (scale > 1.2) { scale = 1; tx = 0; ty = 0; }
        else { scale = 2.5; tx = 0; ty = 0; }
        applyTransform();
        lastTap = 0;
        e.preventDefault();
        return;
      }
      lastTap = now;
      if (scale > 1.02) {
        isPanning = true;
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        startTx = tx;
        startTy = ty;
      }
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', function(e){
    if (e.touches.length === 2 && startDist > 0) {
      var d = dist(e.touches[0], e.touches[1]);
      scale = Math.max(1, Math.min(5, startScale * (d / startDist)));
      applyTransform();
      e.preventDefault();
    } else if (e.touches.length === 1 && isPanning && scale > 1.02) {
      tx = startTx + (e.touches[0].clientX - panStartX);
      ty = startTy + (e.touches[0].clientY - panStartY);
      applyTransform();
      e.preventDefault();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', function(e){
    if (e.touches.length < 2) startDist = 0;
    if (e.touches.length === 0) isPanning = false;
  });
})();
`;

function buildMseHtml(
  serverUrl: string,
  streamName: string,
  cameraKey: string,
  token: string
): string {
  const base = cleanServerUrl(serverUrl);
  const wsProto = base.startsWith('https://') ? 'wss://' : 'ws://';
  const hostPath = base.replace(/^https?:\/\//, '');
  const wsUrl = `${wsProto}${hostPath}/live/mse/api/ws?src=${encodeURIComponent(streamName)}`;
  const mjpegUrl = `${base}/api/go2rtc/api/stream.mjpeg?src=${encodeURIComponent(streamName)}`;
  const snapUrl = `${base}/api/${encodeURIComponent(cameraKey)}/latest.jpg?h=720`;
  const safeToken =
    token && token !== 'COOKIE_SESSION' && token !== 'NO_AUTH'
      ? token.replace(/[^a-zA-Z0-9._-]/g, '')
      : '';

  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden;font-family:-apple-system,sans-serif;}
  #wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden;}
  video,img{width:100%;height:100%;object-fit:contain;background:#000;}
  #fallback{display:none;}
  #status{position:absolute;top:8px;left:8px;z-index:20;background:rgba(2,6,23,0.75);color:#cbd5e1;font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);}
  ${PINCH_ZOOM_CSS}
</style>
</head>
<body>
<div id="wrap">
  <div id="stage">
    <video id="video" autoplay playsinline muted controls></video>
    <img id="fallback" />
  </div>
  <div id="status">Menghubungkan live...</div>
  <div id="zoomBadge"><span id="zoomTxt">1.0x</span><span id="zoomReset">Reset</span></div>
</div>
<script>
${PINCH_ZOOM_JS}
(function(){
  var tok = ${JSON.stringify(safeToken)};
  if (tok) document.cookie = "frigate_token=" + tok + "; path=/; SameSite=Lax";
  var video = document.getElementById('video');
  var fallback = document.getElementById('fallback');
  var statusEl = document.getElementById('status');
  var wsUrl = ${JSON.stringify(wsUrl)};
  var mjpegUrl = ${JSON.stringify(mjpegUrl)};
  var snapUrl = ${JSON.stringify(snapUrl)};

  function setStatus(txt, hideAfter) {
    statusEl.textContent = txt;
    statusEl.style.display = 'block';
    if (hideAfter) setTimeout(function(){ statusEl.style.display = 'none'; }, hideAfter);
  }
  function startFallback() {
    video.style.display = 'none';
    fallback.style.display = 'block';
    setStatus('Live MJPEG', 2000);
    fallback.onerror = function() {
      setStatus('Live Snapshot', 2000);
      setInterval(function(){ fallback.src = snapUrl + '&t=' + Date.now(); }, 1000);
      fallback.src = snapUrl + '&t=' + Date.now();
    };
    fallback.src = mjpegUrl;
  }

  var MS = window.ManagedMediaSource || window.MediaSource;
  if (!MS) { startFallback(); return; }

  var CODECS = ['avc1.640029','avc1.64002A','avc1.640033','avc1.42E01E','hvc1.1.6.L153.B0','mp4a.40.2','mp4a.40.5','flac','opus'];
  var supported = CODECS.filter(function(c){
    try { return MS.isTypeSupported('video/mp4; codecs="' + c + '"'); } catch(e) { return false; }
  }).join(',');

  var ws, ms, sb, queue = [], reconnectTimer = null, started = false;
  function appendNext() {
    if (!sb || sb.updating || queue.length === 0) return;
    try { sb.appendBuffer(queue.shift()); } catch(e) { queue = []; }
  }
  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.close(); } catch(e){} }
    queue = []; sb = null; started = false;
    ms = new MS();
    video.src = URL.createObjectURL(ms);
    ms.addEventListener('sourceopen', function() {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      ws.onopen = function() { ws.send(JSON.stringify({ type: 'mse', value: supported })); };
      ws.onmessage = function(ev) {
        if (typeof ev.data === 'string') {
          try {
            var msg = JSON.parse(ev.data);
            if (msg.type === 'mse' && msg.value) {
              sb = ms.addSourceBuffer(msg.value);
              sb.mode = 'segments';
              sb.addEventListener('updateend', function() {
                if (!started && video.buffered.length > 0) {
                  started = true;
                  setStatus('LIVE · Cubit untuk zoom', 2500);
                  video.play().catch(function(){});
                }
                if (video.buffered.length > 0) {
                  var end = video.buffered.end(video.buffered.length - 1);
                  if (end - video.currentTime > 3) video.currentTime = end - 0.5;
                  if (end - video.buffered.start(0) > 30 && !sb.updating) {
                    try { sb.remove(0, end - 10); } catch(e){}
                  }
                }
                appendNext();
              });
            } else if (msg.type === 'error') { startFallback(); }
          } catch(e){}
        } else if (sb) {
          queue.push(new Uint8Array(ev.data));
          if (queue.length > 30) queue.shift();
          appendNext();
        }
      };
      ws.onclose = function() {
        if (!started) startFallback();
        else { setStatus('Menyambung ulang...'); reconnectTimer = setTimeout(connect, 2000); }
      };
    }, { once: true });
  }
  connect();
})();
</script>
</body>
</html>`;
}

function buildPlaybackHtml(
  clipUrl: string,
  startTs: number,
  token: string
): string {
  const safeToken =
    token && token !== 'COOKIE_SESSION' && token !== 'NO_AUTH'
      ? token.replace(/[^a-zA-Z0-9._-]/g, '')
      : '';
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden;font-family:-apple-system,sans-serif;}
  #wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden;}
  video{width:100%;height:100%;object-fit:contain;background:#000;}
  #msg{position:absolute;z-index:15;color:#94a3b8;font-size:12.5px;text-align:center;padding:16px;display:none;}
  ${PINCH_ZOOM_CSS}
</style>
</head>
<body>
<div id="wrap">
  <div id="stage">
    <video id="v" controls autoplay playsinline></video>
  </div>
  <div id="msg">Tidak ada rekaman pada jam ini.<br/>Geser timeline ke area biru atau oranye.</div>
  <div id="zoomBadge"><span id="zoomTxt">1.0x</span><span id="zoomReset">Reset</span></div>
</div>
<script>
${PINCH_ZOOM_JS}
(function(){
  var tok = ${JSON.stringify(safeToken)};
  if (tok) document.cookie = "frigate_token=" + tok + "; path=/; SameSite=Lax";
  var v = document.getElementById('v');
  var msg = document.getElementById('msg');
  var baseTs = ${Math.floor(startTs)};
  var lastSent = 0;

  v.onerror = function() {
    v.style.display = 'none';
    msg.style.display = 'block';
  };
  v.addEventListener('timeupdate', function() {
    var now = Date.now();
    if (now - lastSent > 1000 && !isNaN(v.currentTime)) {
      lastSent = now;
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'progress',
          ts: baseTs + Math.floor(v.currentTime)
        }));
      }
    }
  });
  v.addEventListener('ended', function() {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ended' }));
    }
  });
  v.src = ${JSON.stringify(clipUrl)};
})();
</script>
</body>
</html>`;
}

export function CameraDetailModal({
  visible,
  cameraKey,
  serverUrl,
  token,
  config,
  stats,
  onClose,
  onRefresh,
}: Props) {
  const [viewMode, setViewMode] = useState<'live' | 'playback'>('live');
  const [liveSubMode, setLiveSubMode] = useState<'stream' | 'hd'>('stream');
  const [hdTick, setHdTick] = useState(() => Date.now());
  const [dayOffset, setDayOffset] = useState(0);
  const [zoom, setZoom] = useState<1 | 3 | 6>(1);
  const [segments, setSegments] = useState<FrigateRecordingSegment[]>([]);
  const [dayEvents, setDayEvents] = useState<FrigateEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // Waktu yang sedang ditunjuk jarum tengah (detik dari 00:00 hari terpilih)
  const [cursorSec, setCursorSec] = useState<number>(0);
  // Timestamp Unix aktual yang sedang diputar di player Rekaman
  const [playbackTs, setPlaybackTs] = useState<number | null>(null);

  // Rentang potong download (Unix timestamp)
  const [clipStartTs, setClipStartTs] = useState<number | null>(null);
  const [clipEndTs, setClipEndTs] = useState<number | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const rulerRef = useRef<any>(null);
  const isProgrammaticScroll = useRef(false);
  const isUserDragging = useRef(false);

  const day = useMemo(() => getDayBounds(dayOffset), [dayOffset]);
  const headers = useMemo(() => authHeaders(token), [token]);

  // Gabungkan segmen rekaman 10-detikan agar seluruh 24 jam tampil cepat & utuh
  const mergedBlocks = useMemo(
    () => mergeRecordingSegments(segments),
    [segments]
  );

  // Ringkasan per jam (00..23): apakah ada rekaman biasa (tanpa deteksi) atau ada deteksi orang
  const hourStatus = useMemo(() => {
    const arr: ('none' | 'rec' | 'event')[] = new Array(24).fill('none');
    for (const b of mergedBlocks) {
      const sh = Math.max(0, Math.min(23, Math.floor((b.start_time - day.startTs) / 3600)));
      const eh = Math.max(0, Math.min(23, Math.floor((b.end_time - day.startTs) / 3600)));
      for (let h = sh; h <= eh; h++) {
        if (arr[h] === 'none') arr[h] = 'rec';
      }
    }
    for (const ev of dayEvents) {
      const h = Math.max(0, Math.min(23, Math.floor((ev.start_time - day.startTs) / 3600)));
      arr[h] = 'event';
    }
    return arr;
  }, [mergedBlocks, dayEvents, day.startTs]);

  // Lebar total penggaris 24 jam dalam pixel (1x = 1440px -> 1px per menit)
  const rulerWidth = 1440 * zoom;
  const pxPerSec = rulerWidth / DAY_SECONDS;

  // Reset saat modal dibuka untuk kamera baru
  useEffect(() => {
    if (visible && cameraKey) {
      setViewMode('live');
      setLiveSubMode('stream');
      setDayOffset(0);
      setZoom(1);
      setClipStartTs(null);
      setClipEndTs(null);
      setPlaybackTs(null);
    }
  }, [visible, cameraKey]);

  // Refresh HD snapshot tiap 2 detik kalau di mode HD
  useEffect(() => {
    if (!visible || viewMode !== 'live' || liveSubMode !== 'hd') return;
    const t = setInterval(() => setHdTick(Date.now()), 2000);
    return () => clearInterval(t);
  }, [visible, viewMode, liveSubMode]);

  const scrollToSec = useCallback(
    (sec: number, animated = true) => {
      const clamped = Math.max(0, Math.min(DAY_SECONDS - 1, sec));
      setCursorSec(clamped);
      isProgrammaticScroll.current = true;
      rulerRef.current?.scrollTo({ x: clamped * pxPerSec, animated });
      setTimeout(() => {
        isProgrammaticScroll.current = false;
      }, 300);
    },
    [pxPerSec]
  );

  // Load SEMUA segmen rekaman 24 jam (termasuk tanpa deteksi/alert) & event untuk hari terpilih
  const loadTimelineData = useCallback(async () => {
    if (!cameraKey || !visible) return;
    setLoadingTimeline(true);
    try {
      const [recs, evs] = await Promise.all([
        fetchRecordings(serverUrl, token, cameraKey, day.startTs, day.endTs).catch(() => []),
        fetchEvents(serverUrl, token, {
          camera: cameraKey,
          after: day.startTs,
          before: day.endTs,
          limit: 200,
        }).catch(() => []),
      ]);
      setSegments(recs);
      setDayEvents(Array.isArray(evs) ? evs : []);

      // Otomatis arahkan jarum ke rekaman terbaru pada hari tersebut
      if (recs.length > 0) {
        const last = recs[recs.length - 1];
        const targetTs = Math.max(day.startTs, Math.floor(last.end_time - 30));
        const sec = targetTs - day.startTs;
        setPlaybackTs(targetTs);
        setTimeout(() => scrollToSec(sec, false), 80);
      } else if (dayOffset === 0) {
        const nowSec = Math.floor(Date.now() / 1000) - day.startTs;
        setPlaybackTs(null);
        setTimeout(() => scrollToSec(nowSec, false), 80);
      } else {
        setPlaybackTs(null);
        setTimeout(() => scrollToSec(12 * 3600, false), 80);
      }
    } finally {
      setLoadingTimeline(false);
    }
  }, [cameraKey, visible, serverUrl, token, day.startTs, day.endTs, dayOffset, scrollToSec]);

  useEffect(() => {
    if (visible && viewMode === 'playback') {
      loadTimelineData();
    }
  }, [visible, viewMode, dayOffset, loadTimelineData]);

  // Pertahankan posisi waktu saat zoom diubah
  useEffect(() => {
    if (viewMode === 'playback') {
      setTimeout(() => {
        rulerRef.current?.scrollTo({ x: cursorSec * pxPerSec, animated: false });
      }, 30);
    }
  }, [zoom]);

  function handleRulerScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const x = e.nativeEvent.contentOffset.x;
    const sec = Math.max(0, Math.min(DAY_SECONDS - 1, Math.round(x / pxPerSec)));
    setCursorSec(sec);
  }

  function handleRulerScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    isUserDragging.current = false;
    if (isProgrammaticScroll.current) return;
    const x = e.nativeEvent.contentOffset.x;
    const sec = Math.max(0, Math.min(DAY_SECONDS - 1, Math.round(x / pxPerSec)));
    setCursorSec(sec);
    const ts = day.startTs + sec;
    setPlaybackTs(ts);
    Haptics.selectionAsync();
  }

  function jumpToTimestamp(ts: number) {
    const sec = Math.max(0, Math.min(DAY_SECONDS - 1, Math.floor(ts - day.startTs)));
    scrollToSec(sec, true);
    setPlaybackTs(Math.floor(ts));
    Haptics.selectionAsync();
  }

  function jumpToHour(hour: number) {
    const hourStart = day.startTs + hour * 3600;
    const hourEnd = hourStart + 3600;
    // Cari segmen rekaman pertama di jam tersebut (termasuk rekaman biasa tanpa deteksi!)
    const firstBlock = mergedBlocks.find(
      (b) => b.end_time > hourStart && b.start_time < hourEnd
    );
    const target = firstBlock ? Math.max(hourStart, firstBlock.start_time) : hourStart;
    jumpToTimestamp(target);
  }

  function nudgePlayback(deltaSec: number) {
    const base = playbackTs ?? day.startTs + cursorSec;
    jumpToTimestamp(base + deltaSec);
  }

  // Sinkronisasi posisi jarum timeline saat video playback berjalan + auto-lanjut ke blok berikutnya
  function handlePlaybackMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'progress' && typeof msg.ts === 'number') {
        if (!isUserDragging.current && !isProgrammaticScroll.current) {
          const sec = Math.max(0, Math.min(DAY_SECONDS - 1, msg.ts - day.startTs));
          setCursorSec(sec);
          isProgrammaticScroll.current = true;
          rulerRef.current?.scrollTo({ x: sec * pxPerSec, animated: false });
          setTimeout(() => {
            isProgrammaticScroll.current = false;
          }, 50);
        }
      } else if (msg.type === 'ended' && playbackTs) {
        // Otomatis lanjut ke segmen rekaman berikutnya dalam 24 jam
        const nextEnd = playbackTs + 1800;
        const nextBlock = mergedBlocks.find((b) => b.start_time >= nextEnd - 5);
        if (nextBlock && nextBlock.start_time < day.endTs) {
          jumpToTimestamp(nextBlock.start_time);
        }
      }
    } catch {
      // ignore non-json
    }
  }

  function handleSetStart() {
    const ts = day.startTs + cursorSec;
    setClipStartTs(ts);
    if (clipEndTs && clipEndTs <= ts) {
      setClipEndTs(ts + 60);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleSetEnd() {
    const ts = day.startTs + cursorSec;
    if (clipStartTs && ts <= clipStartTs) {
      Alert.alert(
        'Waktu Selesai Harus Lebih Besar',
        'Geser timeline ke kanan dari waktu Mulai, lalu tekan Set Selesai.'
      );
      return;
    }
    setClipEndTs(ts);
    if (!clipStartTs) {
      setClipStartTs(Math.max(day.startTs, ts - 300));
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleQuickRange(minutes: number) {
    const start = day.startTs + cursorSec;
    const end = Math.min(day.endTs, start + minutes * 60);
    setClipStartTs(start);
    setClipEndTs(end);
    Haptics.selectionAsync();
  }

  async function handleDownloadRange() {
    if (!cameraKey || !clipStartTs || !clipEndTs || clipEndTs <= clipStartTs) {
      Alert.alert(
        'Pilih Rentang Waktu',
        'Geser timeline lalu tekan "Set Mulai" dan "Set Selesai" (atau pilih +1m / +5m / +15m).'
      );
      return;
    }
    const dur = clipEndTs - clipStartTs;
    if (dur > 6 * 3600) {
      Alert.alert('Terlalu Panjang', 'Maksimal 6 jam sekali download.');
      return;
    }
    const url = getRangeClipUrl(serverUrl, cameraKey, clipStartTs, clipEndTs);
    const sStr = formatClockHM(clipStartTs).replace(':', '');
    const eStr = formatClockHM(clipEndTs).replace(':', '');
    const fileName = `${cameraKey}_${day.shortDate}_${sStr}-${eStr}.mp4`;
    try {
      await downloadToPhone(url, fileName, token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Download Dimulai',
        `File "${fileName}" (${formatDur(dur)}) sedang diunduh ke folder Download/Frigate.`
      );
    } catch (err: any) {
      Alert.alert('Gagal Download', err?.message || 'Coba lagi');
    }
  }

  async function handleToggleFeature(
    feature: 'recordings' | 'snapshots',
    currentVal: boolean
  ) {
    if (!cameraKey) return;
    setToggling(feature);
    try {
      await toggleCameraFeature(serverUrl, token, cameraKey, feature, !currentVal);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onRefresh();
    } catch (err: any) {
      Alert.alert('Gagal mengubah status', err?.message || 'Coba lagi');
    } finally {
      setToggling(null);
    }
  }

  const camCfg = cameraKey ? config.cameras[cameraKey] : null;
  const camStat = cameraKey ? stats?.cameras?.[cameraKey] : null;
  const streamName = cameraKey ? getCameraStreamName(config, cameraKey) : '';

  const liveHtml = useMemo(() => {
    if (!cameraKey) return '';
    return buildMseHtml(serverUrl, streamName, cameraKey, token);
  }, [cameraKey, streamName, serverUrl, token]);

  const playbackHtml = useMemo(() => {
    if (!cameraKey || !playbackTs) return '';
    // Putar blok 30 menit penuh (termasuk semua rekaman tanpa deteksi/alert) dan auto-lanjut
    const endPlay = Math.min(day.endTs, playbackTs + 1800);
    const clipUrl = getRangeClipUrl(serverUrl, cameraKey, playbackTs, endPlay);
    return buildPlaybackHtml(clipUrl, playbackTs, token);
  }, [cameraKey, playbackTs, day.endTs, serverUrl, token]);

  const hourTicks = useMemo(() => {
    const arr: number[] = [];
    for (let h = 0; h <= 24; h++) arr.push(h);
    return arr;
  }, []);

  const clipDur =
    clipStartTs && clipEndTs && clipEndTs > clipStartTs
      ? clipEndTs - clipStartTs
      : 0;

  const activeHour = Math.floor(cursorSec / 3600);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={onClose}>
            <Ionicons name="arrow-back" size={20} color="#f8fafc" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {cameraKey ? getCameraDisplayName(config, cameraKey) : ''}
            </Text>
            <Text style={styles.sub}>
              {viewMode === 'live'
                ? `${(camStat?.camera_fps ?? 0).toFixed(1)} FPS · Cubit video untuk zoom`
                : `Rekaman 24 Jam · ${formatClockSec(cursorSec)}`}
            </Text>
          </View>

          <View style={styles.modeSwitch}>
            <Pressable
              style={[styles.modeBtn, viewMode === 'live' && styles.modeBtnActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setViewMode('live');
              }}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  viewMode === 'live' && styles.modeBtnTextActive,
                ]}
              >
                Live
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.modeBtn,
                viewMode === 'playback' && styles.modeBtnActive,
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setViewMode('playback');
              }}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  viewMode === 'playback' && styles.modeBtnTextActive,
                ]}
              >
                Timeline
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Video Player 16:9 di atas (mendukung pinch-to-zoom 1x-5x & double-tap zoom) */}
        <View style={styles.videoBox}>
          {cameraKey && viewMode === 'live' ? (
            liveSubMode === 'stream' ? (
              <WebView
                key={`live-${cameraKey}`}
                source={{ html: liveHtml, baseUrl: cleanServerUrl(serverUrl) }}
                style={styles.webview}
                mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback
                allowsFullscreenVideo
                javaScriptEnabled
                domStorageEnabled
                thirdPartyCookiesEnabled
                sharedCookiesEnabled
              />
            ) : (
              <LiveSnapshotImage
                uri={getLatestImageUrl(serverUrl, cameraKey, 720, hdTick)}
                headers={headers}
                style={{ flex: 1, width: '100%' }}
                resizeMode="contain"
              />
            )
          ) : cameraKey && viewMode === 'playback' ? (
            playbackTs ? (
              <WebView
                key={`play-${cameraKey}-${playbackTs}`}
                source={{
                  html: playbackHtml,
                  baseUrl: cleanServerUrl(serverUrl),
                }}
                style={styles.webview}
                onMessage={handlePlaybackMessage}
                mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback
                allowsFullscreenVideo
                javaScriptEnabled
                thirdPartyCookiesEnabled
                sharedCookiesEnabled
              />
            ) : (
              <View style={styles.emptyVideo}>
                <Ionicons name="film-outline" size={34} color="#475569" />
                <Text style={styles.emptyVideoTxt}>
                  {loadingTimeline
                    ? 'Memuat timeline 24 jam...'
                    : 'Tidak ada rekaman di tanggal ini'}
                </Text>
              </View>
            )
          ) : null}
        </View>

        {/* Body di bawah video */}
        {viewMode === 'live' ? (
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyPad}
          >
            <Pressable
              style={styles.timelineCta}
              onPress={() => {
                Haptics.selectionAsync();
                setViewMode('playback');
              }}
            >
              <View style={styles.ctaIcon}>
                <Ionicons name="time-outline" size={22} color="#60a5fa" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ctaTitle}>Buka Timeline 24 Jam & Rekaman</Text>
                <Text style={styles.ctaSub}>
                  Lihat semua rekaman (termasuk tanpa deteksi) & potong MP4
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#60a5fa" />
            </Pressable>

            <View style={styles.subCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionLabel}>Mode Tampilan Live</Text>
                <View style={styles.modeSwitch}>
                  <Pressable
                    style={[
                      styles.modeBtn,
                      liveSubMode === 'stream' && styles.modeBtnActive,
                    ]}
                    onPress={() => setLiveSubMode('stream')}
                  >
                    <Text
                      style={[
                        styles.modeBtnText,
                        liveSubMode === 'stream' && styles.modeBtnTextActive,
                      ]}
                    >
                      Video MSE
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.modeBtn,
                      liveSubMode === 'hd' && styles.modeBtnActive,
                    ]}
                    onPress={() => setLiveSubMode('hd')}
                  >
                    <Text
                      style={[
                        styles.modeBtnText,
                        liveSubMode === 'hd' && styles.modeBtnTextActive,
                      ]}
                    >
                      HD Hemat
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {camCfg ? (
              <View style={styles.subCard}>
                <Text style={styles.sectionLabel}>Kontrol Kamera</Text>
                <View style={styles.controlsRow}>
                  {(
                    [
                      {
                        key: 'recordings',
                        label: 'Rekam',
                        icon: 'recording',
                        val: camCfg.record?.enabled ?? true,
                      },
                      {
                        key: 'snapshots',
                        label: 'Snapshot',
                        icon: 'camera',
                        val: camCfg.snapshots?.enabled ?? true,
                      },
                    ] as const
                  ).map((ctrl) => {
                    const busy = toggling === ctrl.key;
                    return (
                      <Pressable
                        key={ctrl.key}
                        style={[styles.ctrlBtn, ctrl.val && styles.ctrlBtnActive]}
                        disabled={busy}
                        onPress={() => handleToggleFeature(ctrl.key, ctrl.val)}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color="#3b82f6" />
                        ) : (
                          <Ionicons
                            name={ctrl.icon}
                            size={20}
                            color={ctrl.val ? '#60a5fa' : '#64748b'}
                          />
                        )}
                        <Text
                          style={[
                            styles.ctrlLabel,
                            ctrl.val && { color: '#f8fafc' },
                          ]}
                        >
                          {ctrl.label}
                        </Text>
                        <Text
                          style={[
                            styles.ctrlState,
                            { color: ctrl.val ? '#34d399' : '#64748b' },
                          ]}
                        >
                          {ctrl.val ? 'AKTIF' : 'MATI'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </ScrollView>
        ) : (
          /* ===================== MODE TIMELINE 24 JAM (EZVIZ STYLE) ===================== */
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.timelineContainer}
          >
            {/* Bar Tanggal */}
            <View style={styles.dateBar}>
              <Pressable
                style={styles.dateStep}
                onPress={() => setDayOffset((d) => d - 1)}
              >
                <Ionicons name="chevron-back" size={18} color="#cbd5e1" />
              </Pressable>
              <View style={{ alignItems: 'center', flex: 1 }}>
                <Text style={styles.dateTitle}>{day.label}</Text>
                <Text style={styles.dateMeta}>
                  {loadingTimeline
                    ? 'Memuat rekaman 24 jam...'
                    : `${mergedBlocks.length} blok rekaman · ${dayEvents.length} deteksi`}
                </Text>
              </View>
              <Pressable
                style={[styles.dateStep, dayOffset >= 0 && { opacity: 0.35 }]}
                disabled={dayOffset >= 0}
                onPress={() => setDayOffset((d) => Math.min(0, d + 1))}
              >
                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
              </Pressable>
            </View>

            {/* Jam Tengah, Geser Cepat & Zoom Penggaris */}
            <View style={styles.clockBar}>
              <View style={styles.nudgeGroup}>
                <Pressable
                  style={styles.nudgeBtn}
                  onPress={() => nudgePlayback(-30)}
                >
                  <Text style={styles.nudgeTxt}>-30d</Text>
                </Pressable>
                <Pressable
                  style={styles.nudgeBtn}
                  onPress={() => nudgePlayback(30)}
                >
                  <Text style={styles.nudgeTxt}>+30d</Text>
                </Pressable>
              </View>

              <View style={styles.clockPill}>
                <View style={styles.needleDot} />
                <Text style={styles.clockBig}>{formatClockSec(cursorSec)}</Text>
              </View>

              <View style={styles.zoomGroup}>
                {([1, 3, 6] as const).map((z) => (
                  <Pressable
                    key={z}
                    style={[styles.zoomBtn, zoom === z && styles.zoomBtnActive]}
                    onPress={() => setZoom(z)}
                  >
                    <Text
                      style={[
                        styles.zoomTxt,
                        zoom === z && styles.zoomTxtActive,
                      ]}
                    >
                      {z}x
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Penggaris Timeline 24 Jam Scrollable (Semua Rekaman + Deteksi) */}
            <View style={styles.rulerBox}>
              <ScrollView
                ref={rulerRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onScrollBeginDrag={() => {
                  isUserDragging.current = true;
                }}
                onScroll={handleRulerScroll}
                onMomentumScrollEnd={handleRulerScrollEnd}
                onScrollEndDrag={handleRulerScrollEnd}
                contentContainerStyle={{
                  paddingHorizontal: HALF_W,
                  height: 76,
                }}
              >
                <View style={{ width: rulerWidth, height: 76 }}>
                  <View style={styles.trackBg} />

                  {/* Semua blok rekaman 24 jam (termasuk tanpa deteksi/alert) */}
                  {mergedBlocks.map((b, i) => {
                    const s = Math.max(0, b.start_time - day.startTs);
                    const e = Math.min(DAY_SECONDS, b.end_time - day.startTs);
                    if (e <= s) return null;
                    const left = s * pxPerSec;
                    const width = Math.max(2, (e - s) * pxPerSec);
                    return (
                      <View
                        key={`blk-${i}`}
                        style={[styles.segBar, { left, width }]}
                      />
                    );
                  })}

                  {/* Penanda deteksi objek / orang (Oranye) */}
                  {dayEvents.map((ev) => {
                    const s = Math.max(0, ev.start_time - day.startTs);
                    const endT = ev.end_time || ev.start_time + 15;
                    const e = Math.min(DAY_SECONDS, endT - day.startTs);
                    const left = s * pxPerSec;
                    const width = Math.max(3, (e - s) * pxPerSec);
                    return (
                      <View
                        key={ev.id}
                        style={[styles.eventBar, { left, width }]}
                      />
                    );
                  })}

                  {/* Overlay Rentang Download Pilihan User (Hijau) */}
                  {clipStartTs && clipEndTs && clipEndTs > clipStartTs ? (
                    <View
                      style={[
                        styles.clipOverlay,
                        {
                          left:
                            Math.max(0, clipStartTs - day.startTs) * pxPerSec,
                          width: Math.max(
                            4,
                            (Math.min(day.endTs, clipEndTs) -
                              Math.max(day.startTs, clipStartTs)) *
                              pxPerSec
                          ),
                        },
                      ]}
                    />
                  ) : null}

                  {/* Garis & label tiap jam 00:00 - 24:00 */}
                  {hourTicks.map((h) => {
                    const left = h * 3600 * pxPerSec;
                    return (
                      <View key={h} style={[styles.tickWrap, { left }]}>
                        <View style={styles.tickMajor} />
                        <Text style={styles.tickLabel}>{pad2(h)}:00</Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>

              <View pointerEvents="none" style={styles.centerNeedle} />
            </View>

            {/* Legend */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
                <Text style={styles.legendTxt}>Rekaman (Tanpa Deteksi)</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
                <Text style={styles.legendTxt}>Deteksi</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                <Text style={styles.legendTxt}>Download</Text>
              </View>
            </View>

            {/* Strip Lompat Cepat Full 24 Jam (00 - 23) */}
            <View style={styles.eventsStripWrap}>
              <Text style={styles.stripTitle}>Pilih Jam (Full 24 Jam)</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingHorizontal: 14 }}
              >
                {hourStatus.map((st, h) => {
                  const selected = activeHour === h;
                  return (
                    <Pressable
                      key={`hr-${h}`}
                      style={[
                        styles.hourChip,
                        selected && styles.hourChipActive,
                      ]}
                      onPress={() => jumpToHour(h)}
                    >
                      <Text
                        style={[
                          styles.hourChipTxt,
                          selected && { color: '#ffffff' },
                          st === 'none' && !selected && { color: '#475569' },
                        ]}
                      >
                        {pad2(h)}:00
                      </Text>
                      <View
                        style={[
                          styles.hourDot,
                          st === 'event'
                            ? { backgroundColor: '#f59e0b' }
                            : st === 'rec'
                              ? { backgroundColor: '#3b82f6' }
                              : { backgroundColor: 'transparent' },
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Lompat Cepat ke Deteksi */}
            {dayEvents.length > 0 ? (
              <View style={styles.eventsStripWrap}>
                <Text style={styles.stripTitle}>
                  Lompat ke Deteksi ({dayEvents.length})
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 7, paddingHorizontal: 14 }}
                >
                  {dayEvents.slice(0, 30).map((ev) => (
                    <Pressable
                      key={ev.id}
                      style={styles.evChip}
                      onPress={() => jumpToTimestamp(ev.start_time)}
                    >
                      <Ionicons name="person" size={11} color="#fbbf24" />
                      <Text style={styles.evChipTxt}>
                        {formatClockHM(ev.start_time)}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* Panel Potong & Download Rentang Waktu */}
            <View style={styles.clipCard}>
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="cut-outline" size={16} color="#10b981" />
                  <Text style={styles.clipTitle}>Potong & Download MP4</Text>
                </View>
                {clipStartTs || clipEndTs ? (
                  <Pressable
                    onPress={() => {
                      setClipStartTs(null);
                      setClipEndTs(null);
                    }}
                  >
                    <Text style={styles.resetTxt}>Reset</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.quickRow}>
                <Text style={styles.quickLabel}>Dari jarum:</Text>
                {[1, 5, 15, 30].map((m) => (
                  <Pressable
                    key={m}
                    style={styles.quickChip}
                    onPress={() => handleQuickRange(m)}
                  >
                    <Text style={styles.quickChipTxt}>+{m}m</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.rangeRow}>
                <Pressable style={styles.markBtn} onPress={handleSetStart}>
                  <Text style={styles.markLabel}>MULAI</Text>
                  <Text style={styles.markVal}>
                    {clipStartTs
                      ? formatClockSec(clipStartTs - day.startTs)
                      : '--:--:--'}
                  </Text>
                  <Text style={styles.markAction}>Set dari Jarum</Text>
                </Pressable>

                <Ionicons name="arrow-forward" size={16} color="#64748b" />

                <Pressable style={styles.markBtn} onPress={handleSetEnd}>
                  <Text style={styles.markLabel}>SELESAI</Text>
                  <Text style={styles.markVal}>
                    {clipEndTs
                      ? formatClockSec(clipEndTs - day.startTs)
                      : '--:--:--'}
                  </Text>
                  <Text style={styles.markAction}>Set dari Jarum</Text>
                </Pressable>
              </View>

              <Pressable
                style={[styles.dlBtn, clipDur <= 0 && { opacity: 0.45 }]}
                onPress={handleDownloadRange}
              >
                <Ionicons name="cloud-download-outline" size={18} color="#ffffff" />
                <Text style={styles.dlBtnTxt}>
                  {clipDur > 0
                    ? `Download MP4 (${formatDur(clipDur)})`
                    : 'Pilih Rentang Waktu Dulu'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#090d16' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    backgroundColor: '#0b1120',
  },
  backBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  title: { color: '#f8fafc', fontSize: 15.5, fontWeight: '700' },
  sub: { color: '#94a3b8', fontSize: 11.5, marginTop: 1 },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  modeBtnActive: { backgroundColor: '#3b82f6' },
  modeBtnText: { color: '#94a3b8', fontSize: 11.5, fontWeight: '700' },
  modeBtnTextActive: { color: '#ffffff' },
  videoBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
  },
  webview: { flex: 1, backgroundColor: '#000000' },
  emptyVideo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#020617',
  },
  emptyVideoTxt: { color: '#64748b', fontSize: 12.5 },
  body: { flex: 1 },
  bodyPad: { padding: 14, gap: 12, paddingBottom: 28 },
  timelineCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
    borderRadius: 16,
    padding: 14,
  },
  ctaIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTitle: { color: '#f8fafc', fontSize: 14.5, fontWeight: '700' },
  ctaSub: { color: '#93c5fd', fontSize: 11.5, marginTop: 2 },
  subCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 10,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  controlsRow: { flexDirection: 'row', gap: 10 },
  ctrlBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 4,
  },
  ctrlBtnActive: {
    borderColor: 'rgba(59, 130, 246, 0.45)',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  ctrlLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  ctrlState: { fontSize: 10, fontWeight: '800' },

  timelineContainer: { paddingBottom: 28, gap: 10 },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 8,
  },
  dateStep: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  dateTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '700' },
  dateMeta: { color: '#64748b', fontSize: 11, marginTop: 1 },
  clockBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  nudgeGroup: { flexDirection: 'row', gap: 5 },
  nudgeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  nudgeTxt: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },
  clockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  needleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  clockBig: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  zoomGroup: { flexDirection: 'row', gap: 4 },
  zoomBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  zoomBtnActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderColor: '#3b82f6',
  },
  zoomTxt: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  zoomTxtActive: { color: '#60a5fa' },

  rulerBox: {
    height: 76,
    backgroundColor: '#0b1120',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1f2937',
    position: 'relative',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 10,
    height: 36,
    backgroundColor: '#111827',
  },
  segBar: {
    position: 'absolute',
    top: 14,
    height: 28,
    backgroundColor: 'rgba(59, 130, 246, 0.78)',
    borderRadius: 2,
  },
  eventBar: {
    position: 'absolute',
    top: 10,
    height: 36,
    backgroundColor: '#f59e0b',
    borderRadius: 2,
  },
  clipOverlay: {
    position: 'absolute',
    top: 6,
    height: 44,
    backgroundColor: 'rgba(16, 185, 129, 0.35)',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: '#10b981',
  },
  tickWrap: {
    position: 'absolute',
    top: 46,
    alignItems: 'center',
    width: 44,
    marginLeft: -22,
  },
  tickMajor: { width: 1, height: 8, backgroundColor: '#475569' },
  tickLabel: { color: '#64748b', fontSize: 10, marginTop: 2 },
  centerNeedle: {
    position: 'absolute',
    left: HALF_W - 1,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#ef4444',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 14,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendTxt: { color: '#94a3b8', fontSize: 11 },

  eventsStripWrap: { gap: 6 },
  stripTitle: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '700',
    paddingHorizontal: 14,
  },
  hourChip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 3,
  },
  hourChipActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#60a5fa',
  },
  hourChipTxt: { color: '#cbd5e1', fontSize: 11.5, fontWeight: '700' },
  hourDot: { width: 6, height: 6, borderRadius: 3 },

  evChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  evChipTxt: { color: '#fde68a', fontSize: 11.5, fontWeight: '700' },

  clipCard: {
    marginHorizontal: 14,
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 10,
  },
  clipTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '700' },
  resetTxt: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickLabel: { color: '#94a3b8', fontSize: 11.5, marginRight: 2 },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  quickChipTxt: { color: '#34d399', fontSize: 11.5, fontWeight: '700' },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  markBtn: {
    flex: 1,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    gap: 2,
  },
  markLabel: { color: '#64748b', fontSize: 10, fontWeight: '700' },
  markVal: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  markAction: { color: '#60a5fa', fontSize: 11, fontWeight: '600', marginTop: 2 },
  dlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 13,
  },
  dlBtnTxt: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  clearAuthSession,
  DEFAULT_SERVER_URL,
  fetchConfig,
  fetchProfile,
  fetchStats,
  getSavedConfig,
  loginFrigate,
  saveAuthSession,
  saveBiometricPref,
  saveRefreshSeconds,
} from './src/api';
import { FrigateConfig, FrigateProfile, FrigateStats } from './src/types';
import { LoginScreen } from './src/screens/LoginScreen';
import { LiveScreen } from './src/screens/LiveScreen';
import { EventsScreen } from './src/screens/EventsScreen';
import { ExportScreen } from './src/screens/ExportScreen';
import { SystemScreen } from './src/screens/SystemScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

type TabKey = 'live' | 'events' | 'export' | 'system' | 'settings';

function MainApp() {
  const [booting, setBooting] = useState(true);
  const [locked, setLocked] = useState(false);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [savedUser, setSavedUser] = useState<string>('');
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<FrigateProfile>({
    username: 'admin',
    role: 'admin',
  });
  const [config, setConfig] = useState<FrigateConfig | null>(null);
  const [stats, setStats] = useState<FrigateStats | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(2);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>('live');
  const [syncError, setSyncError] = useState('');

  const handleUnauthorized = useCallback(async () => {
    // Coba auto-relogin pakai kredensial tersimpan sebelum logout paksa
    try {
      const cfg = await getSavedConfig();
      if (cfg.username && cfg.password) {
        const res = await loginFrigate(cfg.serverUrl, cfg.username, cfg.password);
        await saveAuthSession(cfg.serverUrl, res.token);
        setToken(res.token);
        setProfile(res.profile);
        return true;
      }
    } catch {
      // fall through to logout
    }
    await clearAuthSession();
    setToken(null);
    setConfig(null);
    setStats(null);
    return false;
  }, []);

  const loadData = useCallback(
    async (url: string, tok: string, showSpinner = false) => {
      if (showSpinner) setRefreshing(true);
      try {
        const [cfgData, statData] = await Promise.all([
          fetchConfig(url, tok),
          fetchStats(url, tok).catch(() => null),
        ]);
        setConfig(cfgData);
        if (statData) setStats(statData);
        setSyncError('');
      } catch (err: any) {
        const msg = err?.message || 'Gagal sinkronisasi';
        if (msg.includes('401')) {
          const recovered = await handleUnauthorized();
          if (!recovered) setSyncError('');
        } else {
          setSyncError(msg);
        }
      } finally {
        if (showSpinner) setRefreshing(false);
      }
    },
    [handleUnauthorized]
  );

  const promptBiometric = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Buka Frigate CCTV',
      cancelLabel: 'Batal',
      fallbackLabel: 'Gunakan PIN',
    });
    if (res.success) {
      setLocked(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const cfg = await getSavedConfig();
      setServerUrl(cfg.serverUrl);
      setSavedUser(cfg.username || '');
      setBiometricEnabled(cfg.biometricEnabled);
      setRefreshSeconds(cfg.refreshSeconds);

      if (cfg.token) {
        if (cfg.biometricEnabled) {
          setLocked(true);
          const hasHw = await LocalAuthentication.hasHardwareAsync();
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          if (hasHw && enrolled) {
            const auth = await LocalAuthentication.authenticateAsync({
              promptMessage: 'Buka Frigate CCTV',
              cancelLabel: 'Batal',
            });
            if (auth.success) setLocked(false);
          } else {
            setLocked(false);
          }
        }
        setToken(cfg.token);
        try {
          const p = await fetchProfile(cfg.serverUrl, cfg.token);
          setProfile(p);
        } catch {
          if (cfg.username) {
            setProfile({ username: cfg.username, role: 'admin' });
          }
        }
        await loadData(cfg.serverUrl, cfg.token, false);
      }
      setBooting(false);
    })();
  }, [loadData]);

  // Auto-sync stats setiap 5 detik
  useEffect(() => {
    if (!token || !config || locked) return;
    const timer = setInterval(async () => {
      try {
        const st = await fetchStats(serverUrl, token);
        setStats(st);
        setSyncError('');
      } catch (err: any) {
        if ((err?.message || '').includes('401')) {
          handleUnauthorized();
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [token, config, locked, serverUrl, handleUnauthorized]);

  async function handleLoginSuccess(
    url: string,
    newToken: string,
    newProfile: FrigateProfile
  ) {
    setServerUrl(url);
    setToken(newToken);
    setProfile(newProfile);
    setSavedUser(newProfile.username);
    await loadData(url, newToken, true);
  }

  async function handleLogout() {
    await clearAuthSession();
    setToken(null);
    setConfig(null);
    setStats(null);
    setTab('live');
  }

  async function handleToggleBiometric(val: boolean) {
    setBiometricEnabled(val);
    await saveBiometricPref(val);
  }

  async function handleChangeRefresh(sec: number) {
    setRefreshSeconds(sec);
    await saveRefreshSeconds(sec);
  }

  if (booting) {
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.bootText}>Memuat Frigate CCTV...</Text>
      </View>
    );
  }

  if (locked && token) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <View style={styles.lockIcon}>
          <Ionicons name="finger-print" size={44} color="#3b82f6" />
        </View>
        <Text style={styles.lockTitle}>Frigate CCTV Terkunci</Text>
        <Text style={styles.bootText}>
          Verifikasi biometrik untuk membuka kamera
        </Text>
        <Pressable style={styles.unlockBtn} onPress={promptBiometric}>
          <Text style={styles.unlockText}>Buka Kunci</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!token || !config) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <LoginScreen
          initialServerUrl={serverUrl}
          initialUsername={savedUser}
          onLoginSuccess={handleLoginSuccess}
        />
      </SafeAreaView>
    );
  }

  const pageTitle =
    tab === 'live'
      ? 'Kamera Live'
      : tab === 'events'
        ? 'Riwayat Kejadian'
        : tab === 'export'
          ? 'Download & Export'
          : tab === 'system'
            ? 'Monitor Sistem'
            : 'Pengaturan';

  const activeCams = Object.values(stats?.cameras || {}).filter(
    (c) => (c.camera_fps ?? 0) > 0
  ).length;
  const totalCams = Object.keys(config.cameras || {}).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <View>
          <Text style={styles.topTitle}>{pageTitle}</Text>
          <Text style={styles.topSub}>
            {activeCams}/{totalCams} kamera aktif · {profile.username}
          </Text>
        </View>
        <Pressable
          onPress={() => loadData(serverUrl, token, true)}
          style={styles.refreshBtn}
        >
          <Ionicons name="refresh" size={18} color="#cbd5e1" />
        </Pressable>
      </View>

      {syncError ? (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>Koneksi tertunda: {syncError}</Text>
        </View>
      ) : null}

      <View style={styles.body}>
        {tab === 'live' ? (
          <LiveScreen
            serverUrl={serverUrl}
            token={token}
            config={config}
            stats={stats}
            refreshSeconds={refreshSeconds}
            refreshing={refreshing}
            onRefresh={() => loadData(serverUrl, token, true)}
          />
        ) : tab === 'events' ? (
          <EventsScreen
            serverUrl={serverUrl}
            token={token}
            config={config}
            onUnauthorized={handleUnauthorized}
          />
        ) : tab === 'export' ? (
          <ExportScreen
            serverUrl={serverUrl}
            token={token}
            config={config}
            onUnauthorized={handleUnauthorized}
          />
        ) : tab === 'system' ? (
          <SystemScreen
            config={config}
            stats={stats}
            refreshing={refreshing}
            onRefresh={() => loadData(serverUrl, token, true)}
          />
        ) : (
          <SettingsScreen
            serverUrl={serverUrl}
            token={token}
            profile={profile}
            biometricEnabled={biometricEnabled}
            refreshSeconds={refreshSeconds}
            onToggleBiometric={handleToggleBiometric}
            onChangeRefresh={handleChangeRefresh}
            onLogout={handleLogout}
          />
        )}
      </View>

      <View style={styles.tabBar}>
        {(
          [
            { key: 'live', label: 'Live', icon: 'videocam-outline' },
            { key: 'events', label: 'Kejadian', icon: 'film-outline' },
            { key: 'export', label: 'Unduh', icon: 'download-outline' },
            { key: 'system', label: 'Sistem', icon: 'pulse-outline' },
            { key: 'settings', label: 'Atur', icon: 'settings-outline' },
          ] as const
        ).map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={styles.tabItem}
            >
              <Ionicons
                name={item.icon}
                size={21}
                color={active ? '#3b82f6' : '#64748b'}
              />
              <Text
                style={[
                  styles.tabLabel,
                  active && { color: '#3b82f6', fontWeight: '700' },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#090d16' },
  center: {
    flex: 1,
    backgroundColor: '#090d16',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  bootText: { color: '#94a3b8', fontSize: 13 },
  lockIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(59, 130, 246, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockTitle: { color: '#f8fafc', fontSize: 19, fontWeight: '800' },
  unlockBtn: {
    marginTop: 8,
    backgroundColor: '#3b82f6',
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 12,
  },
  unlockText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    backgroundColor: '#0b1120',
  },
  topTitle: { fontSize: 18, fontWeight: '700', color: '#f8fafc' },
  topSub: { fontSize: 11.5, color: '#94a3b8', marginTop: 1 },
  refreshBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  warnBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  warnText: { color: '#fbbf24', fontSize: 12 },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    backgroundColor: '#0b1120',
    paddingVertical: 8,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabLabel: { fontSize: 11, color: '#64748b' },
});

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { authHeaders, cleanServerUrl } from '../api';
import { FrigateProfile } from '../types';

interface Props {
  serverUrl: string;
  token: string;
  profile: FrigateProfile;
  biometricEnabled: boolean;
  refreshSeconds: number;
  onToggleBiometric: (val: boolean) => void;
  onChangeRefresh: (sec: number) => void;
  onLogout: () => void;
}

const REFRESH_OPTIONS = [1, 2, 3, 5];

export function SettingsScreen({
  serverUrl,
  token,
  profile,
  biometricEnabled,
  refreshSeconds,
  onToggleBiometric,
  onChangeRefresh,
  onLogout,
}: Props) {
  const [webModalOpen, setWebModalOpen] = useState(false);
  const headers = useMemo(() => authHeaders(token), [token]);

  function confirmLogout() {
    Alert.alert('Keluar dari Akun?', 'Sesi login Frigate akan dihapus dari HP.', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Keluar', style: 'destructive', onPress: onLogout },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Akun & Server */}
      <View style={styles.card}>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={26} color="#60a5fa" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{profile.username}</Text>
            <Text style={styles.userRole}>Role: {profile.role}</Text>
          </View>
        </View>
        <View style={styles.serverBox}>
          <Ionicons name="globe-outline" size={16} color="#94a3b8" />
          <Text style={styles.serverText} numberOfLines={1}>
            {serverUrl}
          </Text>
        </View>
      </View>

      {/* Interval Refresh Live */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Interval Refresh Preview Live</Text>
        <Text style={styles.sectionDesc}>
          Lebih cepat membuat preview lebih mulus, lebih lambat menghemat kuota.
        </Text>
        <View style={styles.optRow}>
          {REFRESH_OPTIONS.map((sec) => {
            const active = refreshSeconds === sec;
            return (
              <Pressable
                key={sec}
                style={[styles.optBtn, active && styles.optBtnActive]}
                onPress={() => onChangeRefresh(sec)}
              >
                <Text
                  style={[styles.optText, active && styles.optTextActive]}
                >
                  {sec} dtk
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Keamanan Biometrik */}
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Kunci Biometrik</Text>
            <Text style={styles.sectionDesc}>
              Minta sidik jari / Face Unlock saat membuka aplikasi.
            </Text>
          </View>
          <Switch
            value={biometricEnabled}
            onValueChange={onToggleBiometric}
            trackColor={{ false: '#1f2937', true: '#2563eb' }}
            thumbColor="#f8fafc"
          />
        </View>
      </View>

      {/* Web UI Lanjutan */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Fitur Web Lanjutan</Text>
        <Text style={styles.sectionDesc}>
          Buka tampilan web Frigate penuh (Config Editor, Mask, Export, Face
          Library) dengan layar yang aman dari notch & bar navigasi.
        </Text>
        <Pressable
          style={styles.webBtn}
          onPress={() => setWebModalOpen(true)}
        >
          <Ionicons name="browsers-outline" size={18} color="#60a5fa" />
          <Text style={styles.webBtnText}>Buka Web UI Frigate Penuh</Text>
        </Pressable>
      </View>

      {/* Logout */}
      <Pressable style={styles.logoutBtn} onPress={confirmLogout}>
        <Ionicons name="log-out-outline" size={18} color="#fca5a5" />
        <Text style={styles.logoutText}>Keluar & Ganti Server</Text>
      </Pressable>

      <Text style={styles.versionText}>Frigate CCTV Monitor v2.3.1</Text>

      {/* Full Web UI Modal with SafeArea */}
      <Modal
        visible={webModalOpen}
        animationType="slide"
        onRequestClose={() => setWebModalOpen(false)}
      >
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Pressable
              style={styles.closeBtn}
              onPress={() => setWebModalOpen(false)}
            >
              <Ionicons name="arrow-back" size={20} color="#f8fafc" />
            </Pressable>
            <Text style={styles.modalTitle}>Frigate Web UI</Text>
          </View>
          <WebView
            source={{ uri: cleanServerUrl(serverUrl), headers }}
            style={{ flex: 1, backgroundColor: '#090d16' }}
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            allowsFullscreenVideo
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
          />
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 14, paddingBottom: 32, gap: 12 },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 10,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(59, 130, 246, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  userRole: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  serverBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#090d16',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  serverText: { color: '#cbd5e1', fontSize: 12.5, flex: 1 },
  sectionTitle: { color: '#f8fafc', fontSize: 14.5, fontWeight: '700' },
  sectionDesc: { color: '#94a3b8', fontSize: 12, lineHeight: 17 },
  optRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  optBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  optBtnActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderColor: '#3b82f6',
  },
  optText: { color: '#94a3b8', fontSize: 12.5, fontWeight: '700' },
  optTextActive: { color: '#60a5fa' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  webBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
    marginTop: 4,
  },
  webBtnText: { color: '#60a5fa', fontSize: 13.5, fontWeight: '700' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    marginTop: 4,
  },
  logoutText: { color: '#fca5a5', fontSize: 14, fontWeight: '700' },
  versionText: {
    color: '#475569',
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 8,
  },
  modalSafe: { flex: 1, backgroundColor: '#090d16' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    backgroundColor: '#0b1120',
  },
  closeBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modalTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
});

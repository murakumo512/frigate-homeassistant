import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  cleanServerUrl,
  DEFAULT_SERVER_URL,
  loginFrigate,
  saveAuthSession,
} from '../api';
import { FrigateProfile } from '../types';

interface Props {
  initialServerUrl?: string;
  initialUsername?: string;
  onLoginSuccess: (
    serverUrl: string,
    token: string,
    profile: FrigateProfile
  ) => void;
}

export function LoginScreen({
  initialServerUrl,
  initialUsername,
  onLoginSuccess,
}: Props) {
  const [serverUrl, setServerUrl] = useState(
    initialServerUrl || DEFAULT_SERVER_URL
  );
  const [username, setUsername] = useState(initialUsername || '');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    if (!serverUrl.trim() || !username.trim() || !password) {
      setError('Server URL, username, dan password wajib diisi.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const cleanUrl = cleanServerUrl(serverUrl);
      const { token, profile } = await loginFrigate(
        cleanUrl,
        username.trim(),
        password
      );
      await saveAuthSession(cleanUrl, token, username.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onLoginSuccess(cleanUrl, token, profile);
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err?.message || 'Gagal terhubung ke server Frigate.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Ionicons name="videocam" size={36} color="#3b82f6" />
          </View>
          <Text style={styles.title}>Frigate CCTV</Text>
          <Text style={styles.subtitle}>
            Monitoring Kamera AI, Rekaman & Deteksi Real-Time
          </Text>
        </View>

        <View style={styles.card}>
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color="#fca5a5" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>URL Server Frigate</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://frigate.labjaringanukdw.my.id"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="admin"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passRow}>
            <TextInput
              style={[styles.input, styles.passInput]}
              value={password}
              onChangeText={setPassword}
              placeholder="Masukkan password Frigate"
              placeholderTextColor="#64748b"
              secureTextEntry={!showPass}
              autoCapitalize="none"
            />
            <Pressable
              onPress={() => setShowPass(!showPass)}
              style={styles.eyeBtn}
            >
              <Ionicons
                name={showPass ? 'eye-off' : 'eye'}
                size={20}
                color="#94a3b8"
              />
            </Pressable>
          </View>

          <Pressable
            style={[styles.loginBtn, loading && { opacity: 0.7 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="log-in-outline" size={20} color="#ffffff" />
                <Text style={styles.loginText}>Masuk ke Frigate</Text>
              </>
            )}
          </Pressable>
        </View>

        <Text style={styles.footer}>
          Lab Jaringan UKDW · Multi-Site CCTV Monitor
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#090d16' },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  logoWrap: { alignItems: 'center', marginBottom: 24 },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: 'rgba(59, 130, 246, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 24, fontWeight: '800', color: '#f8fafc' },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  errorText: { color: '#fca5a5', fontSize: 12.5, flex: 1 },
  label: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f8fafc',
    fontSize: 14,
  },
  passRow: { position: 'relative', justifyContent: 'center' },
  passInput: { paddingRight: 46 },
  eyeBtn: { position: 'absolute', right: 12, padding: 6 },
  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
  },
  loginText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  footer: {
    color: '#475569',
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 24,
  },
});

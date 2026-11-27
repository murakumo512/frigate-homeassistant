import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import {
  cleanServerUrl,
  createExport,
  deleteExport,
  downloadToPhone,
  fetchExports,
  getCameraDisplayName,
  getExportVideoUrl,
  getRangeClipUrl,
} from '../api';
import { FrigateConfig, FrigateExport } from '../types';

interface Props {
  serverUrl: string;
  token: string;
  config: FrigateConfig;
  onUnauthorized: () => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toTimeStr(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseDateTime(dateStr: string, timeStr: string): Date | null {
  const dm = dateStr.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const tm = timeStr.trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!dm || !tm) return null;
  const d = new Date(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    tm[3] ? Number(tm[3]) : 0
  );
  return isNaN(d.getTime()) ? null : d;
}

function formatDurationHuman(seconds: number): string {
  if (seconds <= 0) return 'Rentang tidak valid';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m} mnt ${s} dtk` : `${m} menit`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h} jam ${rm} mnt` : `${h} jam`;
}

function formatExportDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function ExportScreen({
  serverUrl,
  token,
  config,
  onUnauthorized,
}: Props) {
  const cameraKeys = useMemo(
    () =>
      Object.entries(config.cameras || {})
        .filter(([, cam]) => cam.enabled !== false)
        .map(([key]) => key),
    [config]
  );

  const [selectedCam, setSelectedCam] = useState<string>(cameraKeys[0] || '');
  const [dateStr, setDateStr] = useState<string>(() => toDateStr(new Date()));
  const [startTime, setStartTime] = useState<string>(() =>
    toTimeStr(new Date(Date.now() - 15 * 60 * 1000))
  );
  const [endTime, setEndTime] = useState<string>(() => toTimeStr(new Date()));
  const [customName, setCustomName] = useState<string>('');
  const [exportsList, setExportsList] = useState<FrigateExport[]>([]);
  const [loadingExports, setLoadingExports] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<{
    title: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!selectedCam && cameraKeys.length > 0) {
      setSelectedCam(cameraKeys[0]);
    }
  }, [cameraKeys, selectedCam]);

  const loadExports = useCallback(async () => {
    setLoadingExports(true);
    try {
      const list = await fetchExports(serverUrl, token);
      setExportsList(list);
    } catch (err: any) {
      if ((err?.message || '').includes('401')) onUnauthorized();
    } finally {
      setLoadingExports(false);
    }
  }, [serverUrl, token, onUnauthorized]);

  useEffect(() => {
    loadExports();
  }, [loadExports]);

  function applyPreset(minutesAgo: number) {
    Haptics.selectionAsync();
    const now = new Date();
    const start = new Date(now.getTime() - minutesAgo * 60 * 1000);
    setDateStr(toDateStr(start));
    setStartTime(toTimeStr(start));
    setEndTime(toTimeStr(now));
  }

  function shiftDate(days: number) {
    const base = parseDateTime(dateStr, '12:00') || new Date();
    base.setDate(base.getDate() + days);
    setDateStr(toDateStr(base));
  }

  function shiftTime(which: 'start' | 'end', deltaMin: number) {
    const current = which === 'start' ? startTime : endTime;
    const dt = parseDateTime(dateStr, current);
    if (!dt) return;
    dt.setMinutes(dt.getMinutes() + deltaMin);
    if (which === 'start') setStartTime(toTimeStr(dt));
    else setEndTime(toTimeStr(dt));
  }

  const parsedRange = useMemo(() => {
    const start = parseDateTime(dateStr, startTime);
    const end = parseDateTime(dateStr, endTime);
    if (!start || !end) return null;
    // Jika jam selesai lebih kecil dari jam mulai (mis. 23:50 -> 00:10), anggap lewat tengah malam
    let endAdj = new Date(end.getTime());
    if (endAdj.getTime() <= start.getTime()) {
      endAdj.setDate(endAdj.getDate() + 1);
    }
    const durSec = Math.round((endAdj.getTime() - start.getTime()) / 1000);
    return {
      startTs: Math.floor(start.getTime() / 1000),
      endTs: Math.floor(endAdj.getTime() / 1000),
      durSec,
    };
  }, [dateStr, startTime, endTime]);

  function validateRange(): { startTs: number; endTs: number } | null {
    if (!selectedCam) {
      Alert.alert('Pilih Kamera', 'Pilih kamera terlebih dahulu.');
      return null;
    }
    if (!parsedRange || parsedRange.durSec <= 0) {
      Alert.alert(
        'Format Waktu Salah',
        'Pastikan tanggal (YYYY-MM-DD) dan jam (HH:MM) valid.'
      );
      return null;
    }
    if (parsedRange.durSec > 6 * 3600) {
      Alert.alert(
        'Rentang Terlalu Panjang',
        'Maksimal 6 jam per download agar file tidak terlalu besar.'
      );
      return null;
    }
    return { startTs: parsedRange.startTs, endTs: parsedRange.endTs };
  }

  function buildFileName(): string {
    if (customName.trim()) {
      const clean = customName.trim().replace(/\.mp4$/i, '');
      return `${clean}.mp4`;
    }
    const cleanDate = dateStr.replace(/-/g, '');
    const s = startTime.replace(/:/g, '');
    const e = endTime.replace(/:/g, '');
    return `${selectedCam}_${cleanDate}_${s}-${e}.mp4`;
  }

  async function handleDirectDownload() {
    const range = validateRange();
    if (!range) return;
    const url = getRangeClipUrl(
      serverUrl,
      selectedCam,
      range.startTs,
      range.endTs
    );
    const fileName = buildFileName();
    try {
      await downloadToPhone(url, fileName, token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Download Dimulai',
        `File "${fileName}" sedang diunduh ke folder Download/Frigate. Cek notifikasi HP untuk progress-nya.`
      );
    } catch (err: any) {
      Alert.alert('Gagal Download', err?.message || 'Coba lagi');
    }
  }

  function handlePreviewRange() {
    const range = validateRange();
    if (!range) return;
    const url = getRangeClipUrl(
      serverUrl,
      selectedCam,
      range.startTs,
      range.endTs
    );
    setPreviewUrl({
      title: `${getCameraDisplayName(config, selectedCam)} (${startTime}–${endTime})`,
      url,
    });
  }

  async function handleSaveServerExport() {
    const range = validateRange();
    if (!range) return;
    setSubmitting(true);
    try {
      await createExport(
        serverUrl,
        token,
        selectedCam,
        range.startTs,
        range.endTs,
        customName.trim() || undefined
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCustomName('');
      Alert.alert(
        'Export Diproses',
        'Rekaman sedang disimpan ke daftar Export server Frigate.'
      );
      loadExports();
    } catch (err: any) {
      Alert.alert('Gagal Export', err?.message || 'Coba lagi');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownloadExport(exp: FrigateExport) {
    const url = getExportVideoUrl(serverUrl, exp.video_path);
    const fileName = `${exp.name || exp.camera}_${exp.id}.mp4`;
    try {
      await downloadToPhone(url, fileName, token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Download Dimulai',
        `Mengunduh "${fileName}" ke folder Download/Frigate.`
      );
    } catch (err: any) {
      Alert.alert('Gagal Download', err?.message || 'Coba lagi');
    }
  }

  function handleDeleteExport(exp: FrigateExport) {
    Alert.alert('Hapus Export?', `Hapus "${exp.name || exp.id}" dari server?`, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExport(serverUrl, token, exp.id);
            setExportsList((prev) => prev.filter((item) => item.id !== exp.id));
          } catch (err: any) {
            Alert.alert('Gagal menghapus', err?.message || 'Coba lagi');
          }
        },
      },
    ]);
  }

  const previewHtml = useMemo(() => {
    if (!previewUrl) return '';
    const safeToken =
      token && token !== 'COOKIE_SESSION' && token !== 'NO_AUTH'
        ? token.replace(/[^a-zA-Z0-9._-]/g, '')
        : '';
    return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;}
  video{width:100%;height:100%;object-fit:contain;background:#000;}
</style>
</head>
<body>
  <video id="v" controls autoplay playsinline></video>
  <script>
    var tok = ${JSON.stringify(safeToken)};
    if (tok) document.cookie = "frigate_token=" + tok + "; path=/; SameSite=Lax";
    document.getElementById('v').src = ${JSON.stringify(previewUrl.url)};
  </script>
</body>
</html>`;
  }, [previewUrl, token]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={loadingExports}
          onRefresh={loadExports}
          tintColor="#3b82f6"
        />
      }
    >
      {/* Card 1: Pilih Kamera & Rentang Waktu */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Ionicons name="download-outline" size={18} color="#3b82f6" />
          <Text style={styles.cardTitle}>Download Rekaman</Text>
        </View>

        <Text style={styles.label}>1. Pilih Kamera</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {cameraKeys.map((key) => {
            const active = selectedCam === key;
            return (
              <Pressable
                key={key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelectedCam(key);
                }}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {getCameraDisplayName(config, key)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.label}>2. Preset Cepat</Text>
        <View style={styles.presetRow}>
          {[
            { label: '5 Mnt', min: 5 },
            { label: '15 Mnt', min: 15 },
            { label: '30 Mnt', min: 30 },
            { label: '1 Jam', min: 60 },
          ].map((p) => (
            <Pressable
              key={p.min}
              style={styles.presetBtn}
              onPress={() => applyPreset(p.min)}
            >
              <Text style={styles.presetText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>3. Tanggal (YYYY-MM-DD)</Text>
        <View style={styles.dateRow}>
          <Pressable style={styles.stepBtn} onPress={() => shiftDate(-1)}>
            <Ionicons name="chevron-back" size={18} color="#cbd5e1" />
          </Pressable>
          <TextInput
            style={[styles.input, { flex: 1, textAlign: 'center' }]}
            value={dateStr}
            onChangeText={setDateStr}
            placeholder="2026-11-24"
            placeholderTextColor="#64748b"
            keyboardType="numbers-and-punctuation"
          />
          <Pressable style={styles.stepBtn} onPress={() => shiftDate(1)}>
            <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
          </Pressable>
          <Pressable
            style={styles.todayBtn}
            onPress={() => setDateStr(toDateStr(new Date()))}
          >
            <Text style={styles.todayText}>Hari Ini</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>4. Rentang Jam (HH:MM)</Text>
        <View style={styles.timeGrid}>
          <View style={styles.timeCol}>
            <Text style={styles.timeSub}>Mulai</Text>
            <View style={styles.timeInputRow}>
              <Pressable
                style={styles.miniStep}
                onPress={() => shiftTime('start', -5)}
              >
                <Text style={styles.miniStepTxt}>-5</Text>
              </Pressable>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={startTime}
                onChangeText={setStartTime}
                placeholder="17:00"
                placeholderTextColor="#64748b"
                keyboardType="numbers-and-punctuation"
              />
              <Pressable
                style={styles.miniStep}
                onPress={() => shiftTime('start', 5)}
              >
                <Text style={styles.miniStepTxt}>+5</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.timeCol}>
            <Text style={styles.timeSub}>Selesai</Text>
            <View style={styles.timeInputRow}>
              <Pressable
                style={styles.miniStep}
                onPress={() => shiftTime('end', -5)}
              >
                <Text style={styles.miniStepTxt}>-5</Text>
              </Pressable>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={endTime}
                onChangeText={setEndTime}
                placeholder="17:15"
                placeholderTextColor="#64748b"
                keyboardType="numbers-and-punctuation"
              />
              <Pressable
                style={styles.miniStep}
                onPress={() => shiftTime('end', 5)}
              >
                <Text style={styles.miniStepTxt}>+5</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {parsedRange ? (
          <View style={styles.durBanner}>
            <Ionicons name="time-outline" size={15} color="#60a5fa" />
            <Text style={styles.durText}>
              Durasi: {formatDurationHuman(parsedRange.durSec)}
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>Nama File / Label (opsional)</Text>
        <TextInput
          style={styles.input}
          value={customName}
          onChangeText={setCustomName}
          placeholder="Contoh: Kurir_Paket_Sore"
          placeholderTextColor="#64748b"
        />

        {/* Tombol Aksi */}
        <Pressable style={styles.primaryBtn} onPress={handleDirectDownload}>
          <Ionicons name="cloud-download-outline" size={19} color="#ffffff" />
          <Text style={styles.primaryBtnText}>Download MP4 ke HP</Text>
        </Pressable>

        <View style={styles.secondaryRow}>
          <Pressable style={styles.secBtn} onPress={handlePreviewRange}>
            <Ionicons name="play-circle-outline" size={17} color="#60a5fa" />
            <Text style={styles.secBtnText}>Preview</Text>
          </Pressable>
          <Pressable
            style={[styles.secBtn, submitting && { opacity: 0.6 }]}
            disabled={submitting}
            onPress={handleSaveServerExport}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#34d399" />
            ) : (
              <Ionicons name="server-outline" size={16} color="#34d399" />
            )}
            <Text style={[styles.secBtnText, { color: '#34d399' }]}>
              Simpan di Server
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Card 2: Daftar Export Tersimpan di Server */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={styles.cardHead}>
            <Ionicons name="folder-open-outline" size={18} color="#10b981" />
            <Text style={styles.cardTitle}>
              Export di Server ({exportsList.length})
            </Text>
          </View>
          <Pressable onPress={loadExports} style={styles.miniRefresh}>
            <Ionicons name="refresh" size={15} color="#94a3b8" />
          </Pressable>
        </View>

        {exportsList.length === 0 ? (
          <Text style={styles.emptyText}>
            Belum ada file export tersimpan di server Frigate.
          </Text>
        ) : (
          exportsList.map((exp) => (
            <View key={exp.id} style={styles.expItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.expName} numberOfLines={1}>
                  {exp.name || getCameraDisplayName(config, exp.camera)}
                </Text>
                <Text style={styles.expMeta}>
                  {getCameraDisplayName(config, exp.camera)} ·{' '}
                  {formatExportDate(exp.date)}
                  {exp.in_progress ? ' · Memproses...' : ''}
                </Text>
              </View>
              {!exp.in_progress ? (
                <View style={styles.expActions}>
                  <Pressable
                    style={styles.iconBtn}
                    onPress={() =>
                      setPreviewUrl({
                        title: exp.name || exp.camera,
                        url: getExportVideoUrl(serverUrl, exp.video_path),
                      })
                    }
                  >
                    <Ionicons name="play" size={15} color="#60a5fa" />
                  </Pressable>
                  <Pressable
                    style={styles.iconBtn}
                    onPress={() => handleDownloadExport(exp)}
                  >
                    <Ionicons name="download" size={15} color="#34d399" />
                  </Pressable>
                  <Pressable
                    style={styles.iconBtn}
                    onPress={() => handleDeleteExport(exp)}
                  >
                    <Ionicons name="trash-outline" size={15} color="#fca5a5" />
                  </Pressable>
                </View>
              ) : (
                <ActivityIndicator size="small" color="#3b82f6" />
              )}
            </View>
          ))
        )}
      </View>

      {/* Preview Video Modal */}
      <Modal
        visible={!!previewUrl}
        animationType="slide"
        onRequestClose={() => setPreviewUrl(null)}
      >
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Pressable
              style={styles.closeBtn}
              onPress={() => setPreviewUrl(null)}
            >
              <Ionicons name="arrow-back" size={20} color="#f8fafc" />
            </Pressable>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {previewUrl?.title || 'Preview Rekaman'}
            </Text>
          </View>
          {previewUrl ? (
            <WebView
              source={{
                html: previewHtml,
                baseUrl: cleanServerUrl(serverUrl),
              }}
              style={{ flex: 1, backgroundColor: '#000000' }}
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback
              allowsFullscreenVideo
              javaScriptEnabled
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
            />
          ) : null}
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
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  chipsRow: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  chipActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderColor: '#3b82f6',
  },
  chipText: { color: '#94a3b8', fontSize: 12.5, fontWeight: '600' },
  chipTextActive: { color: '#60a5fa' },
  presetRow: { flexDirection: 'row', gap: 8 },
  presetBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  presetText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  todayBtn: {
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
  },
  todayText: { color: '#60a5fa', fontSize: 11.5, fontWeight: '700' },
  input: {
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 13.5,
  },
  timeGrid: { flexDirection: 'row', gap: 10 },
  timeCol: { flex: 1, gap: 4 },
  timeSub: { color: '#94a3b8', fontSize: 11 },
  timeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeInput: { flex: 1, textAlign: 'center', paddingHorizontal: 6 },
  miniStep: {
    paddingHorizontal: 7,
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  miniStepTxt: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  durBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
  },
  durText: { color: '#93c5fd', fontSize: 12.5, fontWeight: '600' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 6,
  },
  primaryBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  secondaryRow: { flexDirection: 'row', gap: 8 },
  secBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  secBtnText: { color: '#60a5fa', fontSize: 12.5, fontWeight: '700' },
  miniRefresh: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  emptyText: { color: '#64748b', fontSize: 12.5 },
  expItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  expName: { color: '#f8fafc', fontSize: 13.5, fontWeight: '700' },
  expMeta: { color: '#64748b', fontSize: 11, marginTop: 2 },
  expActions: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    padding: 8,
    borderRadius: 9,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#1f2937',
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
  modalTitle: { color: '#f8fafc', fontSize: 15.5, fontWeight: '700', flex: 1 },
});

import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getCameraDisplayName } from '../api';
import { FrigateConfig, FrigateStats } from '../types';

interface Props {
  config: FrigateConfig;
  stats: FrigateStats | null;
  refreshing: boolean;
  onRefresh: () => void;
}

function formatUptime(sec?: number): string {
  if (!sec) return '-';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}h ${h}j ${m}m`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m} mnt`;
}

function formatGB(mb?: number): string {
  if (typeof mb !== 'number') return '-';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export function SystemScreen({
  config,
  stats,
  refreshing,
  onRefresh,
}: Props) {
  const detectors = Object.entries(stats?.detectors || {});
  const storages = Object.entries(stats?.service?.storage || {});
  const camStats = Object.entries(stats?.cameras || {});

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#3b82f6"
        />
      }
    >
      {/* Server Overview */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Ionicons name="server-outline" size={18} color="#3b82f6" />
          <Text style={styles.cardTitle}>Status Server NVR</Text>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Versi Frigate</Text>
            <Text style={styles.kpiVal}>
              {stats?.service?.version || '0.18'}
            </Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Uptime</Text>
            <Text style={styles.kpiVal}>
              {formatUptime(stats?.service?.uptime)}
            </Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Kamera Aktif</Text>
            <Text style={[styles.kpiVal, { color: '#34d399' }]}>
              {camStats.filter(([, c]) => (c.camera_fps ?? 0) > 0).length}/
              {camStats.length}
            </Text>
          </View>
        </View>
      </View>

      {/* CPU Detectors */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Ionicons name="hardware-chip-outline" size={18} color="#10b981" />
          <Text style={styles.cardTitle}>
            Detektor AI ({detectors.length} Worker)
          </Text>
        </View>
        {detectors.length === 0 ? (
          <Text style={styles.muted}>Data detektor belum tersedia.</Text>
        ) : (
          detectors.map(([name, det]) => {
            const ms = det.inference_speed ?? 0;
            const color =
              ms < 80 ? '#10b981' : ms < 160 ? '#f59e0b' : '#ef4444';
            const pct = Math.min(100, Math.round((ms / 200) * 100));
            return (
              <View key={name} style={styles.metricRow}>
                <View style={styles.rowBetween}>
                  <Text style={styles.metricName}>{name.toUpperCase()}</Text>
                  <Text style={[styles.metricVal, { color }]}>
                    {ms.toFixed(1)} ms
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${pct}%`, backgroundColor: color },
                    ]}
                  />
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Storage */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Ionicons name="disc-outline" size={18} color="#a855f7" />
          <Text style={styles.cardTitle}>Penyimpanan (NFS & Cache)</Text>
        </View>
        {storages.length === 0 ? (
          <Text style={styles.muted}>Data penyimpanan belum tersedia.</Text>
        ) : (
          storages.map(([mount, info]) => {
            const total = info.total || 1;
            const used = info.used || 0;
            const pct = Math.min(100, Math.round((used / total) * 100));
            const color =
              pct < 75 ? '#3b82f6' : pct < 90 ? '#f59e0b' : '#ef4444';
            return (
              <View key={mount} style={styles.metricRow}>
                <View style={styles.rowBetween}>
                  <Text style={styles.metricName} numberOfLines={1}>
                    {mount}
                  </Text>
                  <Text style={styles.metricSub}>
                    {formatGB(used)} / {formatGB(total)} ({pct}%)
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${pct}%`, backgroundColor: color },
                    ]}
                  />
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Per-Camera FPS */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Ionicons name="pulse-outline" size={18} color="#f59e0b" />
          <Text style={styles.cardTitle}>Performa Per Kamera</Text>
        </View>
        {camStats.map(([key, c]) => (
          <View key={key} style={styles.camStatRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.camStatName} numberOfLines={1}>
                {getCameraDisplayName(config, key)}
              </Text>
              <Text style={styles.camStatKey}>{key}</Text>
            </View>
            <View style={styles.fpsGroup}>
              <View style={styles.fpsBox}>
                <Text style={styles.fpsLabel}>CAM</Text>
                <Text style={styles.fpsVal}>
                  {(c.camera_fps ?? 0).toFixed(1)}
                </Text>
              </View>
              <View style={styles.fpsBox}>
                <Text style={styles.fpsLabel}>DET</Text>
                <Text style={[styles.fpsVal, { color: '#60a5fa' }]}>
                  {(c.detection_fps ?? 0).toFixed(1)}
                </Text>
              </View>
              <View style={styles.fpsBox}>
                <Text style={styles.fpsLabel}>SKIP</Text>
                <Text
                  style={[
                    styles.fpsVal,
                    {
                      color:
                        (c.skipped_fps ?? 0) > 0.5 ? '#ef4444' : '#34d399',
                    },
                  ]}
                >
                  {(c.skipped_fps ?? 0).toFixed(1)}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 14, paddingBottom: 28, gap: 12 },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  muted: { color: '#64748b', fontSize: 12.5 },
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpiBox: {
    flex: 1,
    backgroundColor: '#090d16',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  kpiLabel: { color: '#64748b', fontSize: 10.5 },
  kpiVal: { color: '#f8fafc', fontSize: 15, fontWeight: '800', marginTop: 2 },
  metricRow: { gap: 5 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  metricName: { color: '#e2e8f0', fontSize: 12.5, fontWeight: '600', flex: 1 },
  metricVal: { fontSize: 12.5, fontWeight: '800' },
  metricSub: { color: '#94a3b8', fontSize: 11.5 },
  barTrack: {
    height: 7,
    backgroundColor: '#090d16',
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 999 },
  camStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    gap: 8,
  },
  camStatName: { color: '#f8fafc', fontSize: 13.5, fontWeight: '600' },
  camStatKey: { color: '#64748b', fontSize: 11 },
  fpsGroup: { flexDirection: 'row', gap: 10 },
  fpsBox: { alignItems: 'center', minWidth: 36 },
  fpsLabel: { color: '#64748b', fontSize: 9.5, fontWeight: '700' },
  fpsVal: { color: '#e2e8f0', fontSize: 13, fontWeight: '800' },
});

import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  authHeaders,
  getCameraDisplayName,
  getLatestImageUrl,
} from '../api';
import { CameraDetailModal } from '../components/CameraDetailModal';
import { LiveSnapshotImage } from '../components/LiveSnapshotImage';
import { FrigateConfig, FrigateStats } from '../types';

interface Props {
  serverUrl: string;
  token: string;
  config: FrigateConfig;
  stats: FrigateStats | null;
  refreshSeconds: number;
  refreshing: boolean;
  onRefresh: () => void;
}

export function LiveScreen({
  serverUrl,
  token,
  config,
  stats,
  refreshSeconds,
  refreshing,
  onRefresh,
}: Props) {
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [columns, setColumns] = useState<1 | 2>(1);
  const [tick, setTick] = useState<number>(() => Date.now());
  const [activeCam, setActiveCam] = useState<string | null>(null);

  // Auto-refresh snapshot preview sesuai interval pilihan user
  // Dijeda otomatis ketika modal kamera sedang terbuka agar hemat kuota
  useEffect(() => {
    if (activeCam) return;
    const timer = setInterval(() => {
      setTick(Date.now());
    }, refreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [refreshSeconds, activeCam]);

  const groups = useMemo(() => {
    const raw = config.camera_groups || {};
    return Object.entries(raw)
      .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99))
      .map(([name, grp]) => ({ name, cameras: grp.cameras || [] }));
  }, [config]);

  const allCameraKeys = useMemo(() => {
    return Object.entries(config.cameras || {})
      .filter(([, cam]) => cam.enabled !== false)
      .map(([key]) => key);
  }, [config]);

  const visibleCameras = useMemo(() => {
    if (selectedGroup === 'ALL') return allCameraKeys;
    const found = groups.find((g) => g.name === selectedGroup);
    if (!found) return allCameraKeys;
    return found.cameras.filter((c) => allCameraKeys.includes(c));
  }, [selectedGroup, groups, allCameraKeys]);

  const headers = useMemo(() => authHeaders(token), [token]);

  function renderCameraCard({ item: camKey }: { item: string }) {
    const camCfg = config.cameras[camKey];
    const camStat = stats?.cameras?.[camKey];
    const title = getCameraDisplayName(config, camKey);
    const fps = camStat?.camera_fps ?? 0;
    const isOnline = fps > 0;
    const detectOn = camStat?.detection_enabled ?? camCfg?.detect?.enabled ?? true;
    const imgUrl = getLatestImageUrl(
      serverUrl,
      camKey,
      columns === 1 ? 540 : 320,
      tick
    );

    return (
      <Pressable
        style={[styles.card, columns === 2 && styles.cardGrid]}
        onPress={() => {
          Haptics.selectionAsync();
          setActiveCam(camKey);
        }}
      >
        <View style={styles.previewWrap}>
          <LiveSnapshotImage
            uri={imgUrl}
            headers={headers}
            style={styles.previewImg}
            resizeMode="cover"
          />
          <View style={styles.liveBadge}>
            <View
              style={[
                styles.dot,
                { backgroundColor: isOnline ? '#10b981' : '#ef4444' },
              ]}
            />
            <Text style={styles.liveBadgeText}>
              {isOnline ? `${fps.toFixed(1)} FPS` : 'OFFLINE'}
            </Text>
          </View>
          <View style={styles.expandBadge}>
            <Ionicons name="time-outline" size={13} color="#f8fafc" />
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={{ flex: 1 }}>
            <Text style={styles.camTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.camSub} numberOfLines={1}>
              Tap untuk Live & Timeline
            </Text>
          </View>
          <View
            style={[
              styles.statusPill,
              detectOn ? styles.pillGreen : styles.pillMuted,
            ]}
          >
            <Ionicons
              name={detectOn ? 'scan' : 'pause-circle-outline'}
              size={12}
              color={detectOn ? '#34d399' : '#94a3b8'}
            />
            <Text
              style={[
                styles.statusPillText,
                { color: detectOn ? '#34d399' : '#94a3b8' },
              ]}
            >
              {detectOn ? 'AI Aktif' : 'Pause'}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      {/* Filter bar: Camera Groups + Grid Toggle */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <Pressable
            style={[
              styles.chip,
              selectedGroup === 'ALL' && styles.chipActive,
            ]}
            onPress={() => setSelectedGroup('ALL')}
          >
            <Text
              style={[
                styles.chipText,
                selectedGroup === 'ALL' && styles.chipTextActive,
              ]}
            >
              Semua ({allCameraKeys.length})
            </Text>
          </Pressable>

          {groups.map((grp) => {
            const active = selectedGroup === grp.name;
            return (
              <Pressable
                key={grp.name}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedGroup(grp.name)}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {grp.name} ({grp.cameras.length})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          style={styles.gridBtn}
          onPress={() => {
            Haptics.selectionAsync();
            setColumns(columns === 1 ? 2 : 1);
          }}
        >
          <Ionicons
            name={columns === 1 ? 'grid-outline' : 'list-outline'}
            size={18}
            color="#cbd5e1"
          />
        </Pressable>
      </View>

      <FlatList
        key={`cols-${columns}`}
        data={visibleCameras}
        keyExtractor={(item) => item}
        numColumns={columns}
        renderItem={renderCameraCard}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={columns === 2 ? styles.columnWrap : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setTick(Date.now());
              onRefresh();
            }}
            tintColor="#3b82f6"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="videocam-off-outline" size={40} color="#475569" />
            <Text style={styles.emptyText}>Tidak ada kamera di grup ini.</Text>
          </View>
        }
      />

      {/* EZVIZ-Style Camera Live + 24h Visual Timeline + Range Download Modal */}
      <CameraDetailModal
        visible={!!activeCam}
        cameraKey={activeCam}
        serverUrl={serverUrl}
        token={token}
        config={config}
        stats={stats}
        onClose={() => setActiveCam(null)}
        onRefresh={onRefresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  chipsRow: { gap: 8, paddingRight: 6 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  chipActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderColor: '#3b82f6',
  },
  chipText: { color: '#94a3b8', fontSize: 12.5, fontWeight: '600' },
  chipTextActive: { color: '#60a5fa' },
  gridBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  listContent: { paddingHorizontal: 14, paddingBottom: 24, gap: 12 },
  columnWrap: { gap: 10 },
  card: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  cardGrid: { maxWidth: '49%' },
  previewWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#020617',
    position: 'relative',
  },
  previewImg: { width: '100%', height: '100%' },
  liveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  liveBadgeText: { color: '#f8fafc', fontSize: 10.5, fontWeight: '700' },
  expandBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    padding: 5,
    borderRadius: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  camTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '700' },
  camSub: { color: '#64748b', fontSize: 11, marginTop: 2 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillGreen: { backgroundColor: 'rgba(16, 185, 129, 0.14)' },
  pillMuted: { backgroundColor: 'rgba(100, 116, 139, 0.16)' },
  statusPillText: { fontSize: 10.5, fontWeight: '700' },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { color: '#64748b', fontSize: 13.5 },
});

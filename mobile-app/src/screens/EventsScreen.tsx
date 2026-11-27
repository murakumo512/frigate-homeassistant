import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import {
  authHeaders,
  cleanServerUrl,
  deleteEvent,
  downloadToPhone,
  fetchEvents,
  getCameraDisplayName,
  getEventClipUrl,
  getEventSnapshotUrl,
  getEventThumbnailUrl,
} from '../api';
import { FrigateConfig, FrigateEvent } from '../types';

interface Props {
  serverUrl: string;
  token: string;
  config: FrigateConfig;
  onUnauthorized: () => void;
}

function formatRelative(ts: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (diff < 60) return `${diff} dtk lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

function formatClock(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(start: number, end: number | null): string {
  if (!end) return 'Berlangsung';
  const dur = Math.max(1, Math.round(end - start));
  if (dur < 60) return `${dur} dtk`;
  const m = Math.floor(dur / 60);
  const s = dur % 60;
  return `${m}m ${String(s).padStart(2, '0')}d`;
}

function getScorePercent(ev: FrigateEvent): number | null {
  const s = ev.top_score ?? ev.data?.top_score ?? ev.data?.score ?? ev.score;
  if (typeof s !== 'number' || s <= 0) return null;
  return Math.round(s * 100);
}

export function EventsScreen({
  serverUrl,
  token,
  config,
  onUnauthorized,
}: Props) {
  const [events, setEvents] = useState<FrigateEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cameraFilter, setCameraFilter] = useState<string>('all');
  const [onlyClips, setOnlyClips] = useState<boolean>(false);
  const [selectedEvent, setSelectedEvent] = useState<FrigateEvent | null>(null);
  const [mediaTab, setMediaTab] = useState<'clip' | 'snapshot'>('clip');
  const [deleting, setDeleting] = useState(false);

  const headers = useMemo(() => authHeaders(token), [token]);

  const cameraKeys = useMemo(
    () => Object.keys(config.cameras || {}),
    [config]
  );

  const loadEvents = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const list = await fetchEvents(serverUrl, token, {
          camera: cameraFilter,
          hasClip: onlyClips,
          limit: 50,
        });
        setEvents(Array.isArray(list) ? list : []);
      } catch (err: any) {
        if ((err?.message || '').includes('401')) {
          onUnauthorized();
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [serverUrl, token, cameraFilter, onlyClips, onUnauthorized]
  );

  useEffect(() => {
    loadEvents(false);
  }, [loadEvents]);

  async function handleDelete(ev: FrigateEvent) {
    Alert.alert(
      'Hapus Kejadian?',
      'Rekaman snapshot & metadata kejadian ini akan dihapus dari Frigate.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteEvent(serverUrl, token, ev.id);
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
              setSelectedEvent(null);
              setEvents((prev) => prev.filter((item) => item.id !== ev.id));
            } catch (err: any) {
              Alert.alert('Gagal menghapus', err?.message || 'Coba lagi');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  }

  function renderEvent({ item }: { item: FrigateEvent }) {
    const camName = getCameraDisplayName(config, item.camera);
    const score = getScorePercent(item);
    const thumb = getEventThumbnailUrl(serverUrl, item.id);

    return (
      <Pressable
        style={styles.card}
        onPress={() => {
          Haptics.selectionAsync();
          setMediaTab(item.has_clip ? 'clip' : 'snapshot');
          setSelectedEvent(item);
        }}
      >
        <Image
          source={{ uri: thumb, headers }}
          style={styles.thumb}
          resizeMode="cover"
        />
        <View style={styles.cardBody}>
          <View style={styles.rowBetween}>
            <Text style={styles.camName} numberOfLines={1}>
              {camName}
            </Text>
            <Text style={styles.relTime}>
              {formatRelative(item.start_time)}
            </Text>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.labelBadge}>
              <Ionicons name="person" size={11} color="#60a5fa" />
              <Text style={styles.labelBadgeText}>
                {item.label}
                {score ? ` ${score}%` : ''}
              </Text>
            </View>
            <Text style={styles.durText}>
              {formatDuration(item.start_time, item.end_time)}
            </Text>
          </View>

          <View style={styles.rowBetween}>
            <Text style={styles.clockText}>{formatClock(item.start_time)}</Text>
            <View style={styles.iconsRow}>
              {item.has_clip ? (
                <Ionicons name="videocam" size={14} color="#34d399" />
              ) : null}
              {item.has_snapshot ? (
                <Ionicons name="image" size={14} color="#94a3b8" />
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    );
  }

  const clipHtml = useMemo(() => {
    if (!selectedEvent) return '';
    const clipUrl = getEventClipUrl(serverUrl, selectedEvent.id);
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
  #stage{position:relative;width:100%;height:100%;transform-origin:center center;will-change:transform;touch-action:none;}
  video{width:100%;height:100%;object-fit:contain;background:#000;}
  #zoomBadge{position:absolute;top:10px;right:10px;z-index:20;display:none;align-items:center;gap:6px;background:rgba(2,6,23,0.82);color:#f8fafc;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;border:1px solid rgba(59,130,246,0.5);}
  #zoomReset{color:#60a5fa;text-decoration:underline;cursor:pointer;margin-left:4px;}
</style>
</head>
<body>
  <div id="wrap">
    <div id="stage"><video id="v" controls autoplay playsinline></video></div>
    <div id="zoomBadge"><span id="zoomTxt">1.0x</span><span id="zoomReset">Reset</span></div>
  </div>
  <script>
    var tok = ${JSON.stringify(safeToken)};
    if (tok) document.cookie = "frigate_token=" + tok + "; path=/; SameSite=Lax";
    document.getElementById('v').src = ${JSON.stringify(clipUrl)};
    (function(){
      var wrap=document.getElementById('wrap'),stage=document.getElementById('stage'),badge=document.getElementById('zoomBadge'),badgeTxt=document.getElementById('zoomTxt'),resetBtn=document.getElementById('zoomReset');
      var scale=1,tx=0,ty=0,startDist=0,startScale=1,panX=0,panY=0,stx=0,sty=0,panning=false,lastTap=0;
      function apply(){
        if(scale<=1.01){scale=1;tx=0;ty=0;}else{var r=wrap.getBoundingClientRect(),mx=(r.width*(scale-1))/2,my=(r.height*(scale-1))/2;tx=Math.max(-mx,Math.min(mx,tx));ty=Math.max(-my,Math.min(my,ty));}
        stage.style.transform='translate3d('+tx+'px,'+ty+'px,0) scale('+scale+')';
        if(scale>1.02){badgeTxt.textContent=scale.toFixed(1)+'x';badge.style.display='flex';}else{badge.style.display='none';}
      }
      resetBtn.addEventListener('click',function(e){e.stopPropagation();scale=1;tx=0;ty=0;apply();});
      wrap.addEventListener('touchstart',function(e){
        if(e.touches.length===2){panning=false;startDist=Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY);startScale=scale;e.preventDefault();}
        else if(e.touches.length===1){
          var now=Date.now(),r=wrap.getBoundingClientRect();
          if((e.touches[0].clientY-r.top)<=r.height-48 && now-lastTap<280){scale=scale>1.2?1:2.5;tx=0;ty=0;apply();lastTap=0;e.preventDefault();return;}
          lastTap=now;
          if(scale>1.02){panning=true;panX=e.touches[0].clientX;panY=e.touches[0].clientY;stx=tx;sty=ty;}
        }
      },{passive:false});
      wrap.addEventListener('touchmove',function(e){
        if(e.touches.length===2&&startDist>0){scale=Math.max(1,Math.min(5,startScale*(Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY)/startDist)));apply();e.preventDefault();}
        else if(e.touches.length===1&&panning&&scale>1.02){tx=stx+(e.touches[0].clientX-panX);ty=sty+(e.touches[0].clientY-panY);apply();e.preventDefault();}
      },{passive:false});
      wrap.addEventListener('touchend',function(e){if(e.touches.length<2)startDist=0;if(e.touches.length===0)panning=false;});
    })();
  </script>
</body>
</html>`;
  }, [selectedEvent, serverUrl, token]);

  return (
    <View style={styles.container}>
      {/* Filter bar */}
      <View style={styles.filterWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <Pressable
            style={[styles.chip, onlyClips && styles.chipGreen]}
            onPress={() => setOnlyClips(!onlyClips)}
          >
            <Ionicons
              name="videocam"
              size={13}
              color={onlyClips ? '#34d399' : '#94a3b8'}
            />
            <Text
              style={[
                styles.chipText,
                onlyClips && { color: '#34d399' },
              ]}
            >
              Ada Klip
            </Text>
          </Pressable>

          <Pressable
            style={[styles.chip, cameraFilter === 'all' && styles.chipActive]}
            onPress={() => setCameraFilter('all')}
          >
            <Text
              style={[
                styles.chipText,
                cameraFilter === 'all' && styles.chipTextActive,
              ]}
            >
              Semua Kamera
            </Text>
          </Pressable>

          {cameraKeys.map((key) => {
            const active = cameraFilter === key;
            return (
              <Pressable
                key={key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setCameraFilter(key)}
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
      </View>

      {loading && events.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Memuat riwayat deteksi...</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={renderEvent}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadEvents(true)}
              tintColor="#3b82f6"
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="film-outline" size={42} color="#475569" />
              <Text style={styles.loadingText}>
                Belum ada kejadian terdeteksi.
              </Text>
            </View>
          }
        />
      )}

      {/* Event Detail Modal */}
      <Modal
        visible={!!selectedEvent}
        animationType="slide"
        onRequestClose={() => setSelectedEvent(null)}
      >
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Pressable
              style={styles.closeBtn}
              onPress={() => setSelectedEvent(null)}
            >
              <Ionicons name="arrow-back" size={20} color="#f8fafc" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {selectedEvent
                  ? getCameraDisplayName(config, selectedEvent.camera)
                  : ''}
              </Text>
              <Text style={styles.modalSub}>
                {selectedEvent ? formatClock(selectedEvent.start_time) : ''}
              </Text>
            </View>
            {selectedEvent?.has_clip ? (
              <View style={styles.modeSwitch}>
                <Pressable
                  style={[
                    styles.modeBtn,
                    mediaTab === 'clip' && styles.modeBtnActive,
                  ]}
                  onPress={() => setMediaTab('clip')}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      mediaTab === 'clip' && styles.modeBtnTextActive,
                    ]}
                  >
                    Klip
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modeBtn,
                    mediaTab === 'snapshot' && styles.modeBtnActive,
                  ]}
                  onPress={() => setMediaTab('snapshot')}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      mediaTab === 'snapshot' && styles.modeBtnTextActive,
                    ]}
                  >
                    Foto
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.mediaBox}>
            {selectedEvent && mediaTab === 'clip' && selectedEvent.has_clip ? (
              <WebView
                source={{
                  html: clipHtml,
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
            ) : selectedEvent ? (
              <Image
                source={{
                  uri: getEventSnapshotUrl(serverUrl, selectedEvent.id),
                  headers,
                }}
                style={{ flex: 1, width: '100%' }}
                resizeMode="contain"
              />
            ) : null}
          </View>

          {selectedEvent ? (
            <View style={styles.detailCard}>
              <View style={styles.detailGrid}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Objek</Text>
                  <Text style={styles.detailValue}>
                    {selectedEvent.label}
                    {getScorePercent(selectedEvent)
                      ? ` (${getScorePercent(selectedEvent)}%)`
                      : ''}
                  </Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Durasi</Text>
                  <Text style={styles.detailValue}>
                    {formatDuration(
                      selectedEvent.start_time,
                      selectedEvent.end_time
                    )}
                  </Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                {selectedEvent.has_clip ? (
                  <Pressable
                    style={styles.downloadBtn}
                    onPress={async () => {
                      try {
                        const url = getEventClipUrl(serverUrl, selectedEvent.id);
                        const name = `${selectedEvent.camera}_${selectedEvent.label}_${Math.floor(selectedEvent.start_time)}.mp4`;
                        await downloadToPhone(url, name, token);
                        Haptics.notificationAsync(
                          Haptics.NotificationFeedbackType.Success
                        );
                        Alert.alert(
                          'Download Dimulai',
                          `Klip "${name}" diunduh ke Download/Frigate.`
                        );
                      } catch (err: any) {
                        Alert.alert('Gagal Download', err?.message || 'Coba lagi');
                      }
                    }}
                  >
                    <Ionicons name="download-outline" size={16} color="#ffffff" />
                    <Text style={styles.downloadText}>Download MP4</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={[styles.deleteBtn, { flex: 1 }, deleting && { opacity: 0.6 }]}
                  disabled={deleting}
                  onPress={() => handleDelete(selectedEvent)}
                >
                  <Ionicons name="trash-outline" size={16} color="#fca5a5" />
                  <Text style={styles.deleteText}>
                    {deleting ? 'Menghapus...' : 'Hapus'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterWrap: { paddingVertical: 10 },
  chipsRow: { paddingHorizontal: 14, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
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
  chipGreen: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  chipText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#60a5fa' },
  listContent: { paddingHorizontal: 14, paddingBottom: 24, gap: 10 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 10,
  },
  loadingText: { color: '#64748b', fontSize: 13 },
  card: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  thumb: { width: 108, height: 84, backgroundColor: '#020617' },
  cardBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    justifyContent: 'space-between',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  camName: { color: '#f8fafc', fontSize: 14, fontWeight: '700', flex: 1 },
  relTime: { color: '#94a3b8', fontSize: 11 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(59, 130, 246, 0.14)',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  labelBadgeText: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  durText: { color: '#cbd5e1', fontSize: 11.5, fontWeight: '600' },
  clockText: { color: '#64748b', fontSize: 11 },
  iconsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  modalSub: { color: '#94a3b8', fontSize: 11.5, marginTop: 1 },
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
  mediaBox: { flex: 1, backgroundColor: '#000000' },
  detailCard: {
    padding: 16,
    backgroundColor: '#0b1120',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    gap: 12,
  },
  detailGrid: { flexDirection: 'row', gap: 12 },
  detailItem: {
    flex: 1,
    backgroundColor: '#111827',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  detailLabel: { color: '#64748b', fontSize: 11 },
  detailValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  actionRow: { flexDirection: 'row', gap: 10 },
  downloadBtn: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#3b82f6',
  },
  downloadText: { color: '#ffffff', fontSize: 13.5, fontWeight: '700' },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  deleteText: { color: '#fca5a5', fontSize: 13.5, fontWeight: '700' },
});

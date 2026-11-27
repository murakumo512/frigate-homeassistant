export interface FrigateProfile {
  username: string;
  role: string;
}

export interface FrigateCameraConfig {
  name: string;
  friendly_name?: string | null;
  enabled: boolean;
  detect?: {
    enabled?: boolean;
    width?: number;
    height?: number;
    fps?: number;
  };
  record?: {
    enabled?: boolean;
  };
  snapshots?: {
    enabled?: boolean;
  };
  live?: {
    streams?: Record<string, string>;
  };
}

export interface FrigateCameraGroup {
  order?: number;
  icon?: string;
  cameras: string[];
}

export interface FrigateConfig {
  cameras: Record<string, FrigateCameraConfig>;
  camera_groups?: Record<string, FrigateCameraGroup>;
  go2rtc?: {
    streams?: Record<string, unknown>;
  };
}

export interface FrigateCameraStats {
  camera_fps?: number;
  detection_fps?: number;
  process_fps?: number;
  skipped_fps?: number;
  detection_enabled?: boolean;
  pid?: number;
  ffmpeg_pid?: number;
  capture_pid?: number;
}

export interface FrigateDetectorStats {
  inference_speed?: number;
  pid?: number;
  detection_start?: number;
}

export interface FrigateStorageInfo {
  total?: number;
  used?: number;
  free?: number;
  mount_type?: string;
}

export interface FrigateStats {
  cameras?: Record<string, FrigateCameraStats>;
  detectors?: Record<string, FrigateDetectorStats>;
  service?: {
    uptime?: number;
    version?: string;
    latest_version?: string;
    storage?: Record<string, FrigateStorageInfo>;
  };
  cpu_usages?: Record<string, { cpu?: string; mem?: string }>;
}

export interface FrigateEvent {
  id: string;
  camera: string;
  label: string;
  sub_label?: string | null;
  top_score?: number;
  score?: number;
  data?: {
    score?: number;
    top_score?: number;
  };
  start_time: number;
  end_time: number | null;
  has_clip: boolean;
  has_snapshot: boolean;
  zones?: string[];
  retain_indefinitely?: boolean;
}

export interface FrigateRecordingSegment {
  id: string;
  start_time: number;
  end_time: number;
  duration: number;
  motion?: number;
  objects?: number;
}

export interface FrigateExport {
  id: string;
  camera: string;
  name: string;
  date: number;
  video_path: string;
  thumb_path?: string;
  in_progress?: boolean;
}

export interface SavedConfig {
  serverUrl: string;
  token: string | null;
  username: string | null;
  password: string | null;
  biometricEnabled: boolean;
  refreshSeconds: number;
}

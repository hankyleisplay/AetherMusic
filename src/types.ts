export interface Track {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationText: string;
  durationSeconds: number;
  thumbnailUrl: string;
  isAutoRecommended?: boolean;
  localFileUrl?: string;
  isLosslessLocal?: boolean;
}

export interface SongMetadata {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationText: string;
  durationSeconds: number;
  thumbnailUrl: string;
  viewCountText: string;
  lyricsBrowseId: string | null;
  relatedBrowseId: string | null;
  radioPlaylistId: string | null;
  relatedTracks: Track[];
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResponse {
  videoId: string;
  syncedLines: LyricLine[];
  plainText: string;
  source: string;
  hasSynced: boolean;
}

export interface StreamInfo {
  videoId: string;
  proxyUrl: string;
  directUrl: string;
  mimeType: string;
  acodec: string;
  abr: string;
  sampleRate: string;
  bitDepth: string;
  qualityLabel: string;
  engineUsed: string;
}

export interface HomeSection {
  title: string;
  subtitle: string;
  tracks: Track[];
}

export interface EngineStatus {
  ytdlpAvailable: boolean;
  ytdlpVersion: string;
  ytdlpPath: string;
  ytmapiReady: boolean;
  proxyPort: number;
  platform: string;
  arch: string;
  innertubeFallbackReady: boolean;
}

export interface UpdateStatus {
  currentAppVersion: string;
  latestAppVersion: string;
  appUpdateAvailable: boolean;
  releaseUrl: string;
  releaseNotes: string;
  ytdlpCurrentVersion: string;
  ytdlpLatestVersion: string;
  ytdlpUpdateAvailable: boolean;
  lastChecked: string;
}

export interface UpdateActionResult {
  success: boolean;
  message: string;
  updatedYtdlpVersion: string;
  releaseUrl: string;
}

export interface DownloadResult {
  filePath: string;
  sizeBytes: number;
  format: string;
  hasCoverArt: boolean;
  hasMetadataTags: boolean;
}

export interface CacheStats {
  cacheDir: string;
  entryCount: number;
  totalBytes: number;
  maxBytes: number;
}

export interface PersistedSettings {
  volume: number;
  autoRadio: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  audioQuality: AudioQuality;
  glassMode: GlassMode;
  crossfadeSec: number;
  djVoiceEnabled: boolean;
  djVibe: DjVibeId;
  eq: EqSettings;
  closeToTray: boolean;
}

export interface UserStore {
  favorites: Track[];
  history: Track[];
  lastQueue: Track[];
  lastIndex: number;
  lastPositionSec: number;
  settings: PersistedSettings;
}

export type NavTab = "home" | "search" | "dj" | "lyrics" | "queue" | "library" | "settings";
export type SidePanelTab = "queue" | "lyrics" | "info";
export type RepeatMode = "off" | "all" | "one";
export type SearchFilter = "songs" | "videos" | "all";
export type LyricsSourcePreference = "auto" | "lrclib" | "ytmapi" | "ytdlp";
export type AudioQuality = "lossless" | "high" | "standard";
export type GlassMode = "acrylic" | "lite";
export type DjVibeId = "club" | "chill" | "mandopop" | "anime" | "focus";
export type EqPreset = "hires" | "flat" | "bass" | "club" | "vocal";
export interface EqSettings {
  low: number;
  mid: number;
  high: number;
  preset: EqPreset;
}

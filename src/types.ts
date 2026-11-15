export interface Track {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationText: string;
  durationSeconds: number;
  thumbnailUrl: string;
  isAutoRecommended?: boolean;
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
}

export type NavTab = "home" | "search" | "lyrics" | "queue" | "library" | "settings";
export type SidePanelTab = "queue" | "lyrics" | "info";
export type RepeatMode = "off" | "all" | "one";
export type SearchFilter = "songs" | "videos" | "all";
export type LyricsSourcePreference = "auto" | "lrclib" | "ytmapi" | "ytdlp";

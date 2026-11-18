import { invoke } from "@tauri-apps/api/core";
import type {
  AudioQuality,
  CacheStats,
  CustomPlaylist,
  DownloadResult,
  EngineStatus,
  EntityDetail,
  HomeSection,
  ListeningStats,
  LyricsResponse,
  LyricsSourcePreference,
  PersistedSettings,
  SearchFilter,
  SongMetadata,
  StreamInfo,
  Track,
  UpdateActionResult,
  UpdateStatus,
  UserStore,
} from "./types";

export async function searchMusic(
  query: string,
  filter: SearchFilter = "songs"
): Promise<Track[]> {
  return invoke<Track[]>("search_music", { query, filter });
}

export async function getSearchSuggestions(query: string): Promise<string[]> {
  return invoke<string[]>("get_search_suggestions_cmd", { query });
}

export async function getEntityDetail(kind: string, name: string): Promise<EntityDetail> {
  return invoke<EntityDetail>("get_entity_detail_cmd", { kind, name });
}

export async function importYoutubePlaylist(urlOrId: string): Promise<[string, Track[]]> {
  return invoke<[string, Track[]]>("import_youtube_playlist_cmd", { urlOrId });
}

export async function scanLocalMusic(folderPath?: string): Promise<[string, Track[]]> {
  return invoke<[string, Track[]]>("scan_local_music_cmd", { folderPath });
}

export async function setMiniPlayerMode(mini: boolean): Promise<void> {
  return invoke<void>("set_mini_player_mode", { mini });
}

export async function getSongDetail(videoId: string): Promise<SongMetadata> {
  return invoke<SongMetadata>("get_song_detail", { videoId });
}

export async function getLyrics(
  videoId: string,
  title: string,
  artist: string,
  durationSeconds: number,
  preferSource: LyricsSourcePreference = "auto"
): Promise<LyricsResponse> {
  return invoke<LyricsResponse>("get_lyrics", {
    videoId,
    title,
    artist,
    durationSeconds,
    preferSource,
  });
}

export async function getStreamUrl(
  videoId: string,
  quality: AudioQuality = "lossless"
): Promise<StreamInfo> {
  return invoke<StreamInfo>("get_stream_url", { videoId, quality });
}

export async function prefetchStream(
  videoId: string,
  quality: AudioQuality = "lossless"
): Promise<void> {
  return invoke<void>("prefetch_stream", { videoId, quality });
}

export async function getRecommendations(videoId: string): Promise<Track[]> {
  return invoke<Track[]>("get_recommendations", { videoId });
}

export async function getHomeDiscovery(seedArtist?: string): Promise<HomeSection[]> {
  return invoke<HomeSection[]>("get_home_discovery", { seedArtist });
}

export async function getEngineStatus(forceRedetect = false): Promise<EngineStatus> {
  return invoke<EngineStatus>("get_engine_status", { forceRedetect });
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("check_for_updates");
}

export async function runCoreUpdate(): Promise<UpdateActionResult> {
  return invoke<UpdateActionResult>("run_core_update");
}

export async function runAppUpdate(): Promise<UpdateActionResult> {
  return invoke<UpdateActionResult>("run_app_update");
}

export async function openExternalUrl(url: string): Promise<void> {
  return invoke<void>("open_external_url", { url });
}

export async function triggerAudioCache(
  videoId: string,
  quality: AudioQuality = "lossless"
): Promise<boolean> {
  return invoke<boolean>("trigger_audio_cache", { videoId, quality });
}

export async function getCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>("get_cache_stats");
}

export async function clearAudioCache(): Promise<void> {
  return invoke<void>("clear_audio_cache");
}

export async function downloadTrack(
  track: Track,
  quality: AudioQuality = "high"
): Promise<DownloadResult> {
  return invoke<DownloadResult>("download_track", { track, quality });
}

export async function setCloseToTray(enabled: boolean): Promise<void> {
  return invoke<void>("set_close_to_tray", { enabled });
}

export async function updateMediaSession(params: {
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  durationSecs: number;
  positionSecs: number;
  isPlaying: boolean;
}): Promise<void> {
  return invoke<void>("update_media_session", params);
}

export async function loadUserStore(): Promise<UserStore> {
  return invoke<UserStore>("load_user_store");
}

export async function toggleFavoriteDb(track: Track): Promise<Track[]> {
  return invoke<Track[]>("toggle_favorite_db", { track });
}

export async function recordPlayHistoryDb(track: Track): Promise<Track[]> {
  return invoke<Track[]>("record_play_history_db", { track });
}

export async function clearPlayHistoryDb(): Promise<void> {
  return invoke<void>("clear_play_history_db");
}

export async function savePlaybackSnapshot(params: {
  queue: Track[];
  currentIndex: number;
  positionSec: number;
  settings: PersistedSettings;
}): Promise<void> {
  return invoke<void>("save_playback_snapshot", params);
}

export async function savePlaylistsDb(playlists: CustomPlaylist[]): Promise<CustomPlaylist[]> {
  return invoke<CustomPlaylist[]>("save_playlists_db", { playlists });
}

export async function saveLyricsOffsetDb(videoId: string, offsetSec: number): Promise<void> {
  return invoke<void>("save_lyrics_offset_db", { videoId, offsetSec });
}

export async function recordListeningStatDb(
  track: Track,
  listenedSeconds: number,
  monthKey: string
): Promise<ListeningStats> {
  return invoke<ListeningStats>("record_listening_stat_db", {
    track,
    listenedSeconds,
    monthKey,
  });
}

export async function saveSearchHistoryDb(history: string[]): Promise<string[]> {
  return invoke<string[]>("save_search_history_db", { history });
}

export async function exportPlaylistFile(
  playlist: CustomPlaylist,
  format: "json" | "m3u"
): Promise<string> {
  return invoke<string>("export_playlist_file", { playlist, format });
}

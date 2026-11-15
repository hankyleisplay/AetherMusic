import { invoke } from "@tauri-apps/api/core";
import type {
  AudioQuality,
  EngineStatus,
  HomeSection,
  LyricsResponse,
  LyricsSourcePreference,
  SearchFilter,
  SongMetadata,
  StreamInfo,
  Track,
  UpdateActionResult,
  UpdateStatus,
} from "./types";

export async function searchMusic(
  query: string,
  filter: SearchFilter = "songs"
): Promise<Track[]> {
  return invoke<Track[]>("search_music", { query, filter });
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

export async function getHomeDiscovery(): Promise<HomeSection[]> {
  return invoke<HomeSection[]>("get_home_discovery");
}

export async function getEngineStatus(): Promise<EngineStatus> {
  return invoke<EngineStatus>("get_engine_status");
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("check_for_updates");
}

export async function runCoreUpdate(): Promise<UpdateActionResult> {
  return invoke<UpdateActionResult>("run_core_update");
}

import { invoke } from "@tauri-apps/api/core";
import type {
  EngineStatus,
  HomeSection,
  LyricsResponse,
  LyricsSourcePreference,
  SearchFilter,
  SongMetadata,
  StreamInfo,
  Track,
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

export async function getStreamUrl(videoId: string): Promise<StreamInfo> {
  return invoke<StreamInfo>("get_stream_url", { videoId });
}

export async function prefetchStream(videoId: string): Promise<void> {
  return invoke<void>("prefetch_stream", { videoId });
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

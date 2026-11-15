use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{Mutex, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_text: String,
    pub duration_seconds: u64,
    pub thumbnail_url: String,
    #[serde(default)]
    pub is_auto_recommended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongMetadata {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_text: String,
    pub duration_seconds: u64,
    pub thumbnail_url: String,
    pub view_count_text: String,
    pub lyrics_browse_id: Option<String>,
    pub related_browse_id: Option<String>,
    pub radio_playlist_id: Option<String>,
    pub related_tracks: Vec<Track>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub time_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResponse {
    pub video_id: String,
    pub synced_lines: Vec<LyricLine>,
    pub plain_text: String,
    pub source: String,
    pub has_synced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub video_id: String,
    pub proxy_url: String,
    pub direct_url: String,
    pub mime_type: String,
    pub acodec: String,
    pub abr: String,
    pub sample_rate: String,
    pub bit_depth: String,
    pub quality_label: String,
    pub engine_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeSection {
    pub title: String,
    pub subtitle: String,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub ytdlp_available: bool,
    pub ytdlp_version: String,
    pub ytdlp_path: String,
    pub ytmapi_ready: bool,
    pub proxy_port: u16,
    pub platform: String,
    pub arch: String,
    pub innertube_fallback_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_app_version: String,
    pub latest_app_version: String,
    pub app_update_available: bool,
    pub release_url: String,
    pub release_notes: String,
    pub ytdlp_current_version: String,
    pub ytdlp_latest_version: String,
    pub ytdlp_update_available: bool,
    pub last_checked: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateActionResult {
    pub success: bool,
    pub message: String,
    pub updated_ytdlp_version: String,
    pub release_url: String,
}

#[derive(Debug, Clone)]
pub struct CachedStream {
    pub direct_url: String,
    pub mime_type: String,
    pub acodec: String,
    pub abr: String,
    pub sample_rate: String,
    pub bit_depth: String,
    pub quality_label: String,
    pub engine_used: String,
    pub fetched_at: Instant,
}

#[derive(Clone)]
pub struct AppState {
    pub http_client: reqwest::Client,
    pub stream_cache: Arc<RwLock<HashMap<String, CachedStream>>>,
    pub extract_locks: Arc<RwLock<HashMap<String, Arc<Mutex<()>>>>>,
    pub proxy_port: Arc<RwLock<u16>>,
    pub ytdlp_cmd: Arc<RwLock<Option<YtDlpRunner>>>,
    pub app_data_dir: Arc<RwLock<Option<std::path::PathBuf>>>,
}

#[derive(Debug, Clone)]
pub enum YtDlpRunner {
    Executable(String),
    PythonModule(String),
}

impl AppState {
    pub fn new() -> Self {
        let http_client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            http_client,
            stream_cache: Arc::new(RwLock::new(HashMap::new())),
            extract_locks: Arc::new(RwLock::new(HashMap::new())),
            proxy_port: Arc::new(RwLock::new(0)),
            ytdlp_cmd: Arc::new(RwLock::new(None)),
            app_data_dir: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn lock_for_video(&self, video_id: &str) -> Arc<Mutex<()>> {
        {
            let map = self.extract_locks.read().await;
            if let Some(lock) = map.get(video_id) {
                return lock.clone();
            }
        }
        let mut map = self.extract_locks.write().await;
        map.entry(video_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, Mutex, RwLock};

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
    #[serde(default)]
    pub local_file_path: Option<String>,
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
    pub installer_url: Option<String>,
    pub installer_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateActionResult {
    pub success: bool,
    pub message: String,
    pub updated_ytdlp_version: String,
    pub release_url: String,
    #[serde(default)]
    pub app_update_launched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub file_path: String,
    pub size_bytes: u64,
    pub format: String,
    pub has_cover_art: bool,
    pub has_metadata_tags: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub cache_dir: String,
    pub entry_count: usize,
    pub total_bytes: u64,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedEntity {
    pub name: String,
    pub subtitle: String,
    pub thumbnail_url: String,
    pub kind: String,
    pub browse_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityDetail {
    pub kind: String,
    pub name: String,
    pub subtitle: String,
    pub description: String,
    pub thumbnail_url: String,
    pub tracks: Vec<Track>,
    pub albums: Vec<RelatedEntity>,
    pub related_artists: Vec<RelatedEntity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPlaylist {
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
    pub created_at_ms: u64,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningStats {
    pub total_listen_seconds: u64,
    pub monthly_listen_seconds: HashMap<String, u64>,
    pub track_play_counts: HashMap<String, u32>,
    pub artist_play_counts: HashMap<String, u32>,
}

fn default_eq_bands() -> Vec<f64> {
    vec![0.0; 10]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqSettings {
    pub low: f64,
    pub mid: f64,
    pub high: f64,
    pub preset: String,
    #[serde(default = "default_eq_bands")]
    pub bands: Vec<f64>,
    #[serde(default = "default_eq_bands")]
    pub custom_bands: Vec<f64>,
}

impl Default for EqSettings {
    fn default() -> Self {
        Self {
            low: 0.0,
            mid: 0.0,
            high: 0.0,
            preset: "flat".to_string(),
            bands: vec![0.0; 10],
            custom_bands: vec![0.0; 10],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSettings {
    pub volume: f64,
    pub auto_radio: bool,
    pub repeat_mode: String,
    pub shuffle: bool,
    pub audio_quality: String,
    pub glass_mode: String,
    pub crossfade_sec: u64,
    pub dj_voice_enabled: bool,
    pub dj_vibe: String,
    pub eq: EqSettings,
    #[serde(default = "default_close_to_tray")]
    pub close_to_tray: bool,
    #[serde(default)]
    pub loudness_norm: bool,
    #[serde(default = "default_visualizer_style")]
    pub visualizer_style: String,
}

fn default_close_to_tray() -> bool {
    true
}

fn default_visualizer_style() -> String {
    "bars".to_string()
}

impl Default for PersistedSettings {
    fn default() -> Self {
        Self {
            volume: 0.85,
            auto_radio: true,
            repeat_mode: "off".to_string(),
            shuffle: false,
            audio_quality: "lossless".to_string(),
            glass_mode: "acrylic".to_string(),
            crossfade_sec: 5,
            dj_voice_enabled: true,
            dj_vibe: "club".to_string(),
            eq: EqSettings::default(),
            close_to_tray: true,
            loudness_norm: false,
            visualizer_style: "bars".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserStore {
    pub favorites: Vec<Track>,
    pub history: Vec<Track>,
    pub last_queue: Vec<Track>,
    pub last_index: i32,
    pub last_position_sec: f64,
    pub settings: PersistedSettings,
    #[serde(default)]
    pub playlists: Vec<CustomPlaylist>,
    #[serde(default)]
    pub search_history: Vec<String>,
    #[serde(default)]
    pub lyrics_offsets: HashMap<String, f64>,
    #[serde(default)]
    pub listening_stats: ListeningStats,
    #[serde(default)]
    pub local_folder_path: Option<String>,
    #[serde(default)]
    pub local_tracks: Vec<Track>,
}

impl Default for UserStore {
    fn default() -> Self {
        Self {
            favorites: Vec::new(),
            history: Vec::new(),
            last_queue: Vec::new(),
            last_index: -1,
            last_position_sec: 0.0,
            settings: PersistedSettings::default(),
            playlists: Vec::new(),
            search_history: Vec::new(),
            lyrics_offsets: HashMap::new(),
            listening_stats: ListeningStats::default(),
            local_folder_path: None,
            local_tracks: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum SmtcCommand {
    Update {
        title: String,
        artist: String,
        album: String,
        cover_url: Option<String>,
        duration_secs: f64,
        position_secs: f64,
        is_playing: bool,
    },
    Shutdown,
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

#[derive(Debug, Clone)]
pub enum YtDlpRunner {
    Executable(String),
    PythonModule(String),
}

#[derive(Clone)]
pub struct AppState {
    pub http_client: reqwest::Client,
    pub stream_cache: Arc<RwLock<HashMap<String, CachedStream>>>,
    pub extract_locks: Arc<RwLock<HashMap<String, Arc<Mutex<()>>>>>,
    pub proxy_port: Arc<RwLock<u16>>,
    pub ytdlp_cmd: Arc<RwLock<Option<YtDlpRunner>>>,
    pub app_data_dir: Arc<RwLock<Option<std::path::PathBuf>>>,
    pub app_cache_dir: Arc<RwLock<Option<std::path::PathBuf>>>,
    pub focus_tx: Arc<RwLock<Option<mpsc::UnboundedSender<()>>>>,
    pub base_data_dir_override: Arc<RwLock<Option<std::path::PathBuf>>>,
    pub cache_in_flight: Arc<Mutex<HashSet<String>>>,
    pub cache_index_lock: Arc<Mutex<()>>,
    pub store_lock: Arc<Mutex<()>>,
    pub close_to_tray: Arc<AtomicBool>,
    pub is_quitting: Arc<AtomicBool>,
    pub smtc_tx: Arc<RwLock<Option<mpsc::UnboundedSender<SmtcCommand>>>>,
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
            app_cache_dir: Arc::new(RwLock::new(None)),
            focus_tx: Arc::new(RwLock::new(None)),
            base_data_dir_override: Arc::new(RwLock::new(None)),
            cache_in_flight: Arc::new(Mutex::new(HashSet::new())),
            cache_index_lock: Arc::new(Mutex::new(())),
            store_lock: Arc::new(Mutex::new(())),
            close_to_tray: Arc::new(AtomicBool::new(true)),
            is_quitting: Arc::new(AtomicBool::new(false)),
            smtc_tx: Arc::new(RwLock::new(None)),
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

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

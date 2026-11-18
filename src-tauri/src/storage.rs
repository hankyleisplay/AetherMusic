use crate::cache;
use crate::models::{AppState, CustomPlaylist, ListeningStats, PersistedSettings, Track, UserStore};
use std::path::{Path, PathBuf};
use tauri::State;

fn store_paths(base_dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
    let db_dir = base_dir.join("db");
    let main_file = db_dir.join("aethermusic_store.json");
    let tmp_file = db_dir.join("aethermusic_store.json.tmp");
    let bak_file = db_dir.join("aethermusic_store.json.bak");
    (main_file, tmp_file, bak_file)
}

pub fn load_store_in_dir(base_dir: &Path) -> UserStore {
    let (main_file, _, bak_file) = store_paths(base_dir);

    for path in [&main_file, &bak_file] {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(parsed) = serde_json::from_slice::<UserStore>(&bytes) {
                return parsed;
            }
        }
    }

    UserStore::default()
}

pub fn save_store_in_dir(base_dir: &Path, store: &UserStore) -> Result<(), String> {
    let db_dir = base_dir.join("db");
    std::fs::create_dir_all(&db_dir).map_err(|e| format!("建立資料庫目錄失敗: {e}"))?;

    let (main_file, tmp_file, bak_file) = store_paths(base_dir);
    let data = serde_json::to_vec_pretty(store).map_err(|e| format!("序列化資料庫失敗: {e}"))?;

    std::fs::write(&tmp_file, &data).map_err(|e| format!("寫入暫存資料庫失敗: {e}"))?;
    if main_file.exists() {
        let _ = std::fs::copy(&main_file, &bak_file);
    }
    std::fs::rename(&tmp_file, &main_file).map_err(|e| format!("原子替換資料庫失敗: {e}"))?;
    Ok(())
}

pub fn toggle_favorite_in_dir(base_dir: &Path, track: Track) -> Result<Vec<Track>, String> {
    let mut store = load_store_in_dir(base_dir);
    if store.favorites.iter().any(|t| t.video_id == track.video_id) {
        store.favorites.retain(|t| t.video_id != track.video_id);
    } else {
        let mut clean = track;
        clean.is_auto_recommended = false;
        store.favorites.insert(0, clean);
    }
    save_store_in_dir(base_dir, &store)?;
    Ok(store.favorites)
}

pub fn record_history_in_dir(base_dir: &Path, track: Track) -> Result<Vec<Track>, String> {
    let mut store = load_store_in_dir(base_dir);
    store.history.retain(|t| t.video_id != track.video_id);
    store.history.insert(0, track);
    if store.history.len() > 100 {
        store.history.truncate(100);
    }
    save_store_in_dir(base_dir, &store)?;
    Ok(store.history)
}

#[tauri::command]
pub async fn load_user_store(state: State<'_, AppState>) -> Result<UserStore, String> {
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let _guard = state.store_lock.lock().await;
    let store = load_store_in_dir(&base_dir);
    state
        .close_to_tray
        .store(store.settings.close_to_tray, std::sync::atomic::Ordering::Relaxed);
    Ok(store)
}

#[tauri::command]
pub async fn toggle_favorite_db(
    state: State<'_, AppState>,
    track: Track,
) -> Result<Vec<Track>, String> {
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let _guard = state.store_lock.lock().await;
    toggle_favorite_in_dir(&base_dir, track)
}

#[tauri::command]
pub async fn record_play_history_db(
    state: State<'_, AppState>,
    track: Track,
) -> Result<Vec<Track>, String> {
    if track.video_id.starts_with("local-") && track.local_file_path.is_none() {
        let base_dir = cache::resolve_base_data_dir(&state).await;
        let _guard = state.store_lock.lock().await;
        return Ok(load_store_in_dir(&base_dir).history);
    }
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let _guard = state.store_lock.lock().await;
    record_history_in_dir(&base_dir, track)
}

#[tauri::command]
pub async fn clear_play_history_db(state: State<'_, AppState>) -> Result<(), String> {
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let _guard = state.store_lock.lock().await;
    let mut store = load_store_in_dir(&base_dir);
    store.history.clear();
    save_store_in_dir(&base_dir, &store)
}

#[tauri::command]
pub async fn save_playback_snapshot(
    state: State<'_, AppState>,
    queue: Vec<Track>,
    current_index: i32,
    position_sec: f64,
    settings: PersistedSettings,
) -> Result<(), String> {
    state
        .close_to_tray
        .store(settings.close_to_tray, std::sync::atomic::Ordering::Relaxed);
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let _guard = state.store_lock.lock().await;
    let mut store = load_store_in_dir(&base_dir);
    store.last_queue = queue
        .into_iter()
        .filter(|t| !t.video_id.starts_with("local-") || t.local_file_path.is_some())
        .take(120)
        .collect();
    store.last_index = if store.last_queue.is_empty() {
        -1
    } else {
        current_index.clamp(0, (store.last_queue.len() as i32) - 1)
    };
    store.last_position_sec = position_sec.max(0.0);
    store.settings = settings;
    save_store_in_dir(&base_dir, &store)
}

#[tauri::command]
pub async fn save_playlists_db(
    state: State<'_, AppState>,
    playlists: Vec<CustomPlaylist>,
) -> Result<Vec<CustomPlaylist>, String> {
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let _guard = state.store_lock.lock().await;
    let mut store = load_store_in_dir(&base_dir);
    store.playlists = playlists;
    save_store_in_dir(&base_dir, &store)?;
    Ok(store.playlists)
}

#[tauri::command]
pub async fn save_lyrics_offset_db(
    state: State<'_, AppState>,
    video_id: String,
    offset_sec: f64,
) -> Result<(), String> {
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let _guard = state.store_lock.lock().await;
    let mut store = load_store_in_dir(&base_dir);
    if offset_sec.abs() < 0.01 {
        store.lyrics_offsets.remove(&video_id);
    } else {
        store.lyrics_offsets.insert(video_id, offset_sec);
    }
    save_store_in_dir(&base_dir, &store)
}

#[tauri::command]
pub async fn record_listening_stat_db(
    state: State<'_, AppState>,
    track: Track,
    listened_seconds: u64,
    month_key: String,
) -> Result<ListeningStats, String> {
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let _guard = state.store_lock.lock().await;
    let mut store = load_store_in_dir(&base_dir);
    if listened_seconds > 0 {
        store.listening_stats.total_listen_seconds = store
            .listening_stats
            .total_listen_seconds
            .saturating_add(listened_seconds);
        let entry = store
            .listening_stats
            .monthly_listen_seconds
            .entry(month_key)
            .or_insert(0);
        *entry = entry.saturating_add(listened_seconds);
    }
    if !track.video_id.is_empty() {
        *store
            .listening_stats
            .track_play_counts
            .entry(track.video_id.clone())
            .or_insert(0) += 1;
    }
    let artist = track.artist.trim();
    if !artist.is_empty() && artist != "未知藝人" {
        *store
            .listening_stats
            .artist_play_counts
            .entry(artist.to_string())
            .or_insert(0) += 1;
    }
    save_store_in_dir(&base_dir, &store)?;
    Ok(store.listening_stats)
}

#[tauri::command]
pub async fn save_search_history_db(
    state: State<'_, AppState>,
    history: Vec<String>,
) -> Result<Vec<String>, String> {
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let _guard = state.store_lock.lock().await;
    let mut store = load_store_in_dir(&base_dir);
    store.search_history = history.into_iter().take(20).collect();
    save_store_in_dir(&base_dir, &store)?;
    Ok(store.search_history)
}

#[tauri::command]
pub async fn export_playlist_file(
    state: State<'_, AppState>,
    playlist: CustomPlaylist,
    format: String,
) -> Result<String, String> {
    let base_dir = cache::resolve_base_data_dir(&state).await;
    let exports_dir = cache::resolve_downloads_dir(&state)
        .await
        .join("Playlists");
    let target_dir = if std::fs::create_dir_all(&exports_dir).is_ok() {
        exports_dir
    } else {
        let fallback = base_dir.join("exports");
        std::fs::create_dir_all(&fallback).map_err(|e| format!("建立匯出目錄失敗: {e}"))?;
        fallback
    };

    let safe_name = cache::sanitize_filename(&playlist.name);
    let fmt = format.to_lowercase();
    if fmt == "m3u" || fmt == "m3u8" {
        let file_path = target_dir.join(format!("{safe_name}.m3u8"));
        let mut lines = vec!["#EXTM3U".to_string(), format!("#PLAYLIST:{}", playlist.name)];
        for t in &playlist.tracks {
            lines.push(format!("#EXTINF:{},{} - {}", t.duration_seconds, t.artist, t.title));
            if let Some(ref lp) = t.local_file_path {
                lines.push(lp.clone());
            } else {
                lines.push(format!("https://music.youtube.com/watch?v={}", t.video_id));
            }
        }
        std::fs::write(&file_path, lines.join("\n"))
            .map_err(|e| format!("寫入 M3U 播放清單失敗: {e}"))?;
        Ok(file_path.to_string_lossy().to_string())
    } else {
        let file_path = target_dir.join(format!("{safe_name}.json"));
        let json = serde_json::to_vec_pretty(&playlist)
            .map_err(|e| format!("序列化歌單 JSON 失敗: {e}"))?;
        std::fs::write(&file_path, json).map_err(|e| format!("寫入歌單 JSON 失敗: {e}"))?;
        Ok(file_path.to_string_lossy().to_string())
    }
}

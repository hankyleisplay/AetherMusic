use crate::cache;
use crate::models::{AppState, PersistedSettings, Track, UserStore};
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
    if track.video_id.starts_with("local-") {
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
        .filter(|t| !t.video_id.starts_with("local-"))
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

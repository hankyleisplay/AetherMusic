pub mod cache;
pub mod models;
pub mod proxy;
pub mod smtc;
pub mod storage;
pub mod updater;
pub mod ytdlp;
pub mod ytmapi;

use models::{
    AppState, CacheStats, DownloadResult, EngineStatus, HomeSection, LyricsResponse, SongMetadata,
    StreamInfo, Track, UpdateActionResult, UpdateStatus,
};
use std::sync::atomic::Ordering;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Emitter;
use tauri::{Manager, State};

#[tauri::command]
async fn search_music(
    state: State<'_, AppState>,
    query: String,
    filter: Option<String>,
) -> Result<Vec<Track>, String> {
    ytmapi::search_tracks(&state, &query, filter.as_deref()).await
}

#[tauri::command]
async fn get_song_detail(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<SongMetadata, String> {
    ytmapi::get_song_metadata(&state, &video_id).await
}

#[tauri::command]
async fn get_lyrics(
    state: State<'_, AppState>,
    video_id: String,
    title: String,
    artist: String,
    duration_seconds: u64,
    prefer_source: Option<String>,
) -> Result<LyricsResponse, String> {
    Ok(ytmapi::get_lyrics(
        &state,
        &video_id,
        &title,
        &artist,
        duration_seconds,
        prefer_source.as_deref(),
    )
    .await)
}

#[tauri::command]
async fn get_stream_url(
    state: State<'_, AppState>,
    video_id: String,
    quality: Option<String>,
) -> Result<StreamInfo, String> {
    ytdlp::build_stream_info(&state, &video_id, quality.as_deref()).await
}

#[tauri::command]
async fn prefetch_stream(
    state: State<'_, AppState>,
    video_id: String,
    quality: Option<String>,
) -> Result<(), String> {
    let st = state.inner().clone();
    let q = quality.unwrap_or_else(|| "lossless".to_string());
    tokio::spawn(async move {
        let _ = ytdlp::get_or_extract_stream(&st, &video_id, &q).await;
    });
    Ok(())
}

#[tauri::command]
async fn get_recommendations(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<Vec<Track>, String> {
    ytmapi::get_radio_recommendations(&state, &video_id).await
}

#[tauri::command]
async fn get_home_discovery(state: State<'_, AppState>) -> Result<Vec<HomeSection>, String> {
    ytmapi::get_home_sections(&state).await
}

#[tauri::command]
async fn get_engine_status(
    state: State<'_, AppState>,
    force_redetect: Option<bool>,
) -> Result<EngineStatus, String> {
    if force_redetect.unwrap_or(false) {
        *state.ytdlp_cmd.write().await = None;
    }
    let (ytdlp_available, ytdlp_version, ytdlp_path) = ytdlp::get_ytdlp_status(&state).await;
    let proxy_port = *state.proxy_port.read().await;
    Ok(EngineStatus {
        ytdlp_available,
        ytdlp_version,
        ytdlp_path,
        ytmapi_ready: true,
        proxy_port,
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        innertube_fallback_ready: true,
    })
}

#[tauri::command]
async fn check_for_updates(state: State<'_, AppState>) -> Result<UpdateStatus, String> {
    updater::check_updates(&state).await
}

#[tauri::command]
async fn run_core_update(state: State<'_, AppState>) -> Result<UpdateActionResult, String> {
    updater::perform_core_update(&state).await
}

#[tauri::command]
async fn trigger_audio_cache(
    state: State<'_, AppState>,
    video_id: String,
    quality: Option<String>,
) -> Result<bool, String> {
    if video_id.starts_with("local-") || video_id.trim().is_empty() {
        return Ok(false);
    }
    if cache::get_cached_audio(&state, &video_id).await.is_some() {
        return Ok(true);
    }
    let st = state.inner().clone();
    let q = quality.unwrap_or_else(|| "lossless".to_string());
    tokio::spawn(async move {
        let _ = cache::cache_audio_stream(&st, &video_id, &q).await;
    });
    Ok(false)
}

#[tauri::command]
async fn get_cache_stats(state: State<'_, AppState>) -> Result<CacheStats, String> {
    Ok(cache::get_cache_stats(&state).await)
}

#[tauri::command]
async fn clear_audio_cache(state: State<'_, AppState>) -> Result<(), String> {
    cache::clear_audio_cache(&state).await
}

#[tauri::command]
async fn download_track(
    state: State<'_, AppState>,
    track: Track,
    quality: Option<String>,
) -> Result<DownloadResult, String> {
    cache::download_track_offline(&state, track, quality).await
}

#[tauri::command]
async fn set_close_to_tray(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[cfg(target_os = "windows")]
fn configure_windows_webview_data_dir() {
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        return;
    }

    let Some(local_base) = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("TEMP"))
        .map(std::path::PathBuf::from)
    else {
        return;
    };

    let base_dir = local_base.join("com.hankyleisplay.aethermusic");
    let preferred_name = if cfg!(debug_assertions) {
        "webview-dev"
    } else {
        "webview-release"
    };
    let default_folder = base_dir.join(preferred_name);

    let lock_candidates = [
        default_folder.join("EBWebView").join("Default").join("LOCK"),
        default_folder.join("EBWebView").join("lockfile"),
    ];
    let is_locked = lock_candidates.iter().any(|lock_path| {
        lock_path.exists()
            && std::fs::OpenOptions::new()
                .write(true)
                .open(lock_path)
                .is_err()
    });

    let chosen_dir = if is_locked {
        base_dir.join(format!("webview-instance-{}", std::process::id()))
    } else {
        default_folder
    };

    let _ = std::fs::create_dir_all(&chosen_dir);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", chosen_dir);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        if let Ok(path_val) = std::env::var("PATH") {
            if path_val.contains('"') {
                std::env::set_var("PATH", path_val.replace('"', ""));
            }
        }
        configure_windows_webview_data_dir();
    }

    let app_state = AppState::new();

    tauri::Builder::default()
        .manage(app_state)
        .setup(|app| {
            let state = app.state::<AppState>().inner().clone();
            let maybe_data_dir = app.path().app_data_dir().ok();

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let toggle_i = MenuItem::with_id(app, "tray_toggle", "播放/暫停", true, None::<&str>)?;
                let next_i = MenuItem::with_id(app, "tray_next", "下一首", true, None::<&str>)?;
                let show_i = MenuItem::with_id(app, "tray_show", "顯示主視窗", true, None::<&str>)?;
                let sep = PredefinedMenuItem::separator(app)?;
                let quit_i = MenuItem::with_id(app, "tray_quit", "完全退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&toggle_i, &next_i, &show_i, &sep, &quit_i])?;

                let mut tray_builder = TrayIconBuilder::with_id("aether-tray")
                    .tooltip("AetherMusic · 雲端無損音樂播放器")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "tray_toggle" => {
                            let _ = app.emit("smtc-action", "toggle");
                        }
                        "tray_next" => {
                            let _ = app.emit("smtc-action", "next");
                        }
                        "tray_show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.unminimize();
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "tray_quit" => {
                            let st = app.state::<AppState>();
                            st.is_quitting.store(true, Ordering::Relaxed);
                            let _ = app.emit("app-will-close", ());
                            if let Ok(guard) = st.smtc_tx.try_read() {
                                if let Some(tx) = guard.as_ref() {
                                    let _ = tx.send(models::SmtcCommand::Shutdown);
                                }
                            }
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.unminimize();
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }
                let _ = tray_builder.build(app)?;

                #[cfg(target_os = "windows")]
                if let Some(main_win) = app.get_webview_window("main") {
                    if let Some(tx) = smtc::init_smtc(app.handle().clone(), &main_win) {
                        if let Ok(mut guard) = state.smtc_tx.try_write() {
                            *guard = Some(tx);
                        }
                    }
                }
            }

            tauri::async_runtime::spawn(async move {
                if let Some(data_dir) = maybe_data_dir {
                    *state.app_data_dir.write().await = Some(data_dir);
                }

                // Sync persisted close_to_tray preference at startup
                let base_dir = cache::resolve_base_data_dir(&state).await;
                let persisted = storage::load_store_in_dir(&base_dir);
                state
                    .close_to_tray
                    .store(persisted.settings.close_to_tray, Ordering::Relaxed);

                let state_proxy = state.clone();
                let state_detect = state;
                let (proxy_res, _) = tokio::join!(
                    proxy::start_proxy_server(state_proxy),
                    ytdlp::detect_or_setup_ytdlp(&state_detect, false)
                );
                if let Err(e) = proxy_res {
                    eprintln!("Warning: could not start local audio proxy: {e}");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.emit("app-will-close", ());
                let st = window.state::<AppState>();
                if st.close_to_tray.load(Ordering::Relaxed)
                    && !st.is_quitting.load(Ordering::Relaxed)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            search_music,
            get_song_detail,
            get_lyrics,
            get_stream_url,
            prefetch_stream,
            get_recommendations,
            get_home_discovery,
            get_engine_status,
            check_for_updates,
            run_core_update,
            trigger_audio_cache,
            get_cache_stats,
            clear_audio_cache,
            download_track,
            set_close_to_tray,
            smtc::update_media_session,
            storage::load_user_store,
            storage::toggle_favorite_db,
            storage::record_play_history_db,
            storage::clear_play_history_db,
            storage::save_playback_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AetherMusic tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lrc_and_duration() {
        assert_eq!(ytmapi::parse_duration_seconds("4:30"), Some(270));
        assert_eq!(ytmapi::parse_duration_seconds("1:02:03"), Some(3723));
        assert_eq!(ytmapi::parse_duration_seconds("invalid"), None);

        let lrc = "[ti:晴天]\n[00:29.39] 故事的小黃花\n[00:32.64][01:10.00] 從出生那年就飄著\n";
        let lines = ytmapi::parse_lrc(lrc);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].time_ms, 29390);
        assert_eq!(lines[0].text, "故事的小黃花");
        assert_eq!(lines[1].time_ms, 32640);
        assert_eq!(lines[2].time_ms, 70000);
    }

    #[test]
    fn test_upgrade_thumbnail_url() {
        let small = "https://yt3.googleusercontent.com/abc=w120-h120-s-l90-rj";
        let big = ytmapi::upgrade_thumbnail_url(small);
        assert_eq!(big, "https://yt3.googleusercontent.com/abc=w544-h544-l90-rj");
        assert_eq!(
            ytmapi::pick_best_thumbnail_with_fallback(None, "dQw4w9WgXcQ"),
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
        );
    }

    #[tokio::test]
    async fn test_live_backend_pipeline() {
        let tmp_dir = std::env::temp_dir().join(format!("aethermusic_test_live_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_dir);

        let state = AppState::new();
        *state.base_data_dir_override.write().await = Some(tmp_dir.clone());
        let port = proxy::start_proxy_server(state.clone())
            .await
            .expect("proxy server starts");
        assert!(port > 0);

        let tracks = ytmapi::search_tracks(&state, "周杰倫 晴天", Some("songs"))
            .await
            .expect("search tracks");
        assert!(!tracks.is_empty(), "search returned no tracks");
        let first = &tracks[0];
        assert!(!first.video_id.is_empty());

        let meta = ytmapi::get_song_metadata(&state, &first.video_id)
            .await
            .expect("song metadata");
        assert!(!meta.title.is_empty());

        let recs = ytmapi::get_radio_recommendations(&state, &first.video_id)
            .await
            .expect("radio recommendations");
        assert!(!recs.is_empty(), "recommendations should not be empty");
        assert!(recs.iter().all(|r| r.is_auto_recommended));

        let lyr = ytmapi::get_lyrics(
            &state,
            &first.video_id,
            &first.title,
            &first.artist,
            first.duration_seconds,
            Some("auto"),
        )
        .await;
        assert!(
            !lyr.plain_text.is_empty() || !lyr.synced_lines.is_empty(),
            "lyrics should be found"
        );

        let stream = ytdlp::build_stream_info(&state, &first.video_id, Some("lossless"))
            .await
            .expect("yt-dlp stream extraction");
        assert!(stream.proxy_url.starts_with(&format!("http://127.0.0.1:{port}/stream/")));
        assert!(!stream.sample_rate.is_empty());

        // Verify pure-Rust InnerTube VISIONOS fallback (used on Android & Linux/Windows fallback)
        let it_stream = ytdlp::extract_stream_innertube(&state, &first.video_id, "lossless")
            .await
            .expect("pure-Rust innertube stream extraction");
        assert!(!it_stream.direct_url.is_empty());
        assert_eq!(it_stream.engine_used, "rust-innertube");

        // Verify updater check works
        let upd = updater::check_updates(&state)
            .await
            .expect("update status check");
        assert_eq!(upd.current_app_version, env!("CARGO_PKG_VERSION"));

        // Verify local HTTP proxy supports Range requests with 206 Partial Content & CORS
        let resp = state
            .http_client
            .get(&stream.proxy_url)
            .header("Range", "bytes=0-1023")
            .send()
            .await
            .expect("proxy range fetch");
        assert!(
            resp.status().as_u16() == 206 || resp.status().as_u16() == 200,
            "unexpected proxy status: {}",
            resp.status()
        );
        assert_eq!(
            resp.headers()
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok()),
            Some("*")
        );

        // Verify hybrid YTMAPI search finds official releases even outside pure Songs filter (e.g., "Looks Can Kill")
        let lck = ytmapi::search_tracks(&state, "Looks Can Kill", Some("songs"))
            .await
            .expect("Looks Can Kill search");
        assert!(
            lck.iter().any(|t| t.title.to_lowercase().contains("looks can kill")),
            "expected 'Looks Can Kill' in hybrid search results"
        );
        let bytes = resp.bytes().await.expect("proxy body bytes");
        assert!(!bytes.is_empty(), "proxy returned empty body");
    }

    #[tokio::test]
    async fn test_audio_cache_hit_proxy_and_lru_eviction() {
        let tmp_dir = std::env::temp_dir().join(format!("aethermusic_test_cache_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_dir);

        let state = AppState::new();
        *state.base_data_dir_override.write().await = Some(tmp_dir.clone());
        let port = proxy::start_proxy_server(state.clone())
            .await
            .expect("proxy starts");

        let meta = models::CachedStream {
            direct_url: "https://invalid.example.local/should-not-hit".to_string(),
            mime_type: "audio/mp4".to_string(),
            acodec: "mp4a.40.2".to_string(),
            abr: "256 kbps".to_string(),
            sample_rate: "48 kHz".to_string(),
            bit_depth: "24-bit Float DSP".to_string(),
            quality_label: "Hi-Res".to_string(),
            engine_used: "rust-innertube".to_string(),
            fetched_at: std::time::Instant::now(),
        };

        // Store 2 tracks (2000 bytes + 2000 bytes)
        let payload_a = vec![b'A'; 2000];
        let payload_b = vec![b'B'; 2000];
        cache::register_cached_bytes_in_dir(&tmp_dir, "vidA", &meta, &payload_a, 10_000)
            .expect("cache A");
        std::thread::sleep(std::time::Duration::from_millis(15));
        cache::register_cached_bytes_in_dir(&tmp_dir, "vidB", &meta, &payload_b, 10_000)
            .expect("cache B");

        // Cache Hit for vidA makes vidA newest accessed, leaving vidB oldest
        let extracted = ytdlp::get_or_extract_stream(&state, "vidA", "lossless")
            .await
            .expect("cache hit for vidA");
        assert!(extracted.engine_used.contains("Cache Hit"));

        // Verify proxy serves vidA directly from disk with 206 Partial Content & X-Aether-Cache: HIT
        let proxy_url = format!("http://127.0.0.1:{port}/stream/vidA");
        let resp = state
            .http_client
            .get(&proxy_url)
            .header("Range", "bytes=0-127")
            .send()
            .await
            .expect("cached proxy fetch");
        assert_eq!(resp.status().as_u16(), 206);
        assert_eq!(
            resp.headers()
                .get("x-aether-cache")
                .and_then(|v| v.to_str().ok()),
            Some("HIT")
        );
        let chunk = resp.bytes().await.expect("cached bytes");
        assert_eq!(chunk.len(), 128);
        assert!(chunk.iter().all(|&b| b == b'A'));

        // Verify cache log explicitly records "Cache Hit"
        let log_content =
            std::fs::read_to_string(tmp_dir.join("logs").join("cache.log")).expect("cache.log");
        assert!(log_content.contains("Cache Hit"));

        // Enforce 2500-byte LRU limit: vidB (oldest) must be evicted, vidA stays
        let remaining = cache::enforce_lru_limit_in_dir(&tmp_dir, 2500).expect("lru enforce");
        assert!(remaining <= 2500);
        assert!(cache::audio_cache_dir(&tmp_dir).join("vidA.m4a").exists());
        assert!(!cache::audio_cache_dir(&tmp_dir).join("vidB.m4a").exists());

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_id3_and_mp4_metadata_embedding() {
        let fake_jpg = [0xFFu8, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        let id3 = cache::build_id3v23_tag(
            "晴天",
            "周杰倫",
            "葉惠美",
            Some((&fake_jpg, "image/jpeg")),
        );
        assert_eq!(&id3[0..5], b"ID3\x03\x00");
        assert!(id3.windows(4).any(|w| w == b"TIT2"));
        assert!(id3.windows(4).any(|w| w == b"TPE1"));
        assert!(id3.windows(4).any(|w| w == b"TALB"));
        assert!(id3.windows(4).any(|w| w == b"APIC"));

        // Minimal valid MP4: ftyp + moov(mvhd) + mdat
        let mut mp4 = Vec::new();
        mp4.extend_from_slice(&16u32.to_be_bytes());
        mp4.extend_from_slice(b"ftyp");
        mp4.extend_from_slice(b"M4A \x00\x00\x00\x00");

        let mut mvhd = Vec::new();
        mvhd.extend_from_slice(&16u32.to_be_bytes());
        mvhd.extend_from_slice(b"mvhd");
        mvhd.extend_from_slice(&[0u8; 8]);
        mp4.extend_from_slice(&((8 + mvhd.len()) as u32).to_be_bytes());
        mp4.extend_from_slice(b"moov");
        mp4.extend_from_slice(&mvhd);

        mp4.extend_from_slice(&16u32.to_be_bytes());
        mp4.extend_from_slice(b"mdat");
        mp4.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);

        let tagged = cache::embed_mp4_metadata(
            &mp4,
            "晴天",
            "周杰倫",
            "葉惠美",
            Some((&fake_jpg, false)),
        )
        .expect("mp4 metadata inject");
        // Verify mdat stayed at exact original offset and new moov contains iTunes atoms
        let orig_mdat_pos = mp4.windows(4).position(|w| w == b"mdat").unwrap();
        let new_mdat_pos = tagged.windows(4).position(|w| w == b"mdat").unwrap();
        assert_eq!(orig_mdat_pos, new_mdat_pos);
        assert!(tagged.windows(4).any(|w| w == b"covr"));
        assert!(tagged.windows(4).any(|w| w == b"\xa9nam"));
        assert!(tagged.windows(4).any(|w| w == b"\xa9ART"));
    }

    #[test]
    fn test_storage_atomic_favorites_history_and_snapshot() {
        let tmp_dir = std::env::temp_dir().join(format!("aethermusic_test_db_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_dir);

        let track = Track {
            video_id: "abc123XYZ".to_string(),
            title: "晴天".to_string(),
            artist: "周杰倫".to_string(),
            album: "葉惠美".to_string(),
            duration_text: "4:29".to_string(),
            duration_seconds: 269,
            thumbnail_url: "https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg".to_string(),
            is_auto_recommended: false,
        };

        let favs = storage::toggle_favorite_in_dir(&tmp_dir, track.clone()).expect("add fav");
        assert_eq!(favs.len(), 1);
        let hist = storage::record_history_in_dir(&tmp_dir, track.clone()).expect("add history");
        assert_eq!(hist.len(), 1);

        let mut store = storage::load_store_in_dir(&tmp_dir);
        store.settings.volume = 0.42;
        store.settings.glass_mode = "lite".to_string();
        store.last_queue = vec![track.clone()];
        store.last_index = 0;
        storage::save_store_in_dir(&tmp_dir, &store).expect("save snapshot");

        // Reload and verify all persisted fields survived
        let reloaded = storage::load_store_in_dir(&tmp_dir);
        assert_eq!(reloaded.favorites.len(), 1);
        assert_eq!(reloaded.favorites[0].video_id, "abc123XYZ");
        assert_eq!(reloaded.history.len(), 1);
        assert!((reloaded.settings.volume - 0.42).abs() < 1e-6);
        assert_eq!(reloaded.settings.glass_mode, "lite");
        assert_eq!(reloaded.last_queue.len(), 1);

        // Toggle removes favorite cleanly
        let favs_after = storage::toggle_favorite_in_dir(&tmp_dir, track).expect("remove fav");
        assert!(favs_after.is_empty());

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}

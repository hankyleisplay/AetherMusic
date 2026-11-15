pub mod models;
pub mod proxy;
pub mod updater;
pub mod ytdlp;
pub mod ytmapi;

use models::{
    AppState, EngineStatus, HomeSection, LyricsResponse, SongMetadata, StreamInfo, Track,
    UpdateActionResult, UpdateStatus,
};
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
async fn get_engine_status(state: State<'_, AppState>) -> Result<EngineStatus, String> {
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

            tauri::async_runtime::spawn(async move {
                if let Some(data_dir) = maybe_data_dir {
                    *state.app_data_dir.write().await = Some(data_dir);
                }

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
        let state = AppState::new();
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
}

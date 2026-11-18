use crate::models::{AppState, SmtcCommand};
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::sync::mpsc::UnboundedSender;

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use tauri::Emitter;

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
pub fn init_smtc(
    app_handle: AppHandle,
    window: &tauri::WebviewWindow,
) -> Option<UnboundedSender<SmtcCommand>> {
    #[cfg(target_os = "windows")]
    let hwnd_opt = match window.hwnd() {
        Ok(h) => Some(h.0),
        Err(e) => {
            eprintln!("[SMTC] Failed to retrieve window HWND: {e}");
            return None;
        }
    };
    #[cfg(not(target_os = "windows"))]
    let hwnd_opt: Option<*mut std::ffi::c_void> = {
        let _ = window;
        None
    };

    let config = PlatformConfig {
        display_name: "AetherMusic",
        dbus_name: "aethermusic",
        hwnd: hwnd_opt,
    };

    let mut controls = match MediaControls::new(config) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[SMTC] Failed to initialize Windows SMTC: {e}");
            return None;
        }
    };

    let handle_for_events = app_handle.clone();
    if let Err(e) = controls.attach(move |event| match event {
        MediaControlEvent::Play => {
            let _ = handle_for_events.emit("smtc-action", "play");
        }
        MediaControlEvent::Pause | MediaControlEvent::Stop => {
            let _ = handle_for_events.emit("smtc-action", "pause");
        }
        MediaControlEvent::Toggle => {
            let _ = handle_for_events.emit("smtc-action", "toggle");
        }
        MediaControlEvent::Next => {
            let _ = handle_for_events.emit("smtc-action", "next");
        }
        MediaControlEvent::Previous => {
            let _ = handle_for_events.emit("smtc-action", "prev");
        }
        MediaControlEvent::SetPosition(MediaPosition(dur)) => {
            let _ = handle_for_events.emit("smtc-seek", dur.as_secs_f64());
        }
        MediaControlEvent::Seek(dir) => {
            let delta = match dir {
                SeekDirection::Forward => 10.0,
                SeekDirection::Backward => -10.0,
            };
            let _ = handle_for_events.emit("smtc-seek-relative", delta);
        }
        MediaControlEvent::SeekBy(dir, dur) => {
            let secs = dur.as_secs_f64();
            let delta = match dir {
                SeekDirection::Forward => secs,
                SeekDirection::Backward => -secs,
            };
            let _ = handle_for_events.emit("smtc-seek-relative", delta);
        }
        _ => {}
    }) {
        eprintln!("[SMTC] Failed to attach media key events: {e}");
        return None;
    }

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<SmtcCommand>();

    std::thread::Builder::new()
        .name("aether-smtc".to_string())
        .spawn(move || {
            let mut last_meta_key = String::new();
            while let Some(cmd) = rx.blocking_recv() {
                match cmd {
                    SmtcCommand::Shutdown => {
                        let _ = controls.detach();
                        break;
                    }
                    SmtcCommand::Update {
                        title,
                        artist,
                        album,
                        cover_url,
                        duration_secs,
                        position_secs,
                        is_playing,
                    } => {
                        let clean_cover = cover_url
                            .as_deref()
                            .map(str::trim)
                            .filter(|u| u.starts_with("http://") || u.starts_with("https://") || u.starts_with("file://"));

                        let meta_key = format!(
                            "{title}|{artist}|{album}|{}|{:.0}",
                            clean_cover.unwrap_or(""),
                            duration_secs
                        );

                        if meta_key != last_meta_key {
                            let dur = if duration_secs > 0.0 {
                                Some(Duration::from_secs_f64(duration_secs))
                            } else {
                                None
                            };
                            let album_opt = if album.trim().is_empty() {
                                None
                            } else {
                                Some(album.as_str())
                            };

                            let res = controls.set_metadata(MediaMetadata {
                                title: Some(title.as_str()),
                                artist: Some(artist.as_str()),
                                album: album_opt,
                                cover_url: clean_cover,
                                duration: dur,
                            });

                            if res.is_err() && clean_cover.is_some() {
                                // Retry without thumbnail URI so title/artist/album always appear
                                let _ = controls.set_metadata(MediaMetadata {
                                    title: Some(title.as_str()),
                                    artist: Some(artist.as_str()),
                                    album: album_opt,
                                    cover_url: None,
                                    duration: dur,
                                });
                            }
                            last_meta_key = meta_key;
                        }

                        let progress = Some(MediaPosition(Duration::from_secs_f64(
                            position_secs.max(0.0),
                        )));
                        let playback = if is_playing {
                            MediaPlayback::Playing { progress }
                        } else {
                            MediaPlayback::Paused { progress }
                        };
                        let _ = controls.set_playback(playback);
                    }
                }
            }
        })
        .ok()?;

    println!("[MediaControls] Cross-platform OS media controls registered cleanly");
    Some(tx)
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn init_smtc(
    _app_handle: AppHandle,
    _window: &tauri::WebviewWindow,
) -> Option<UnboundedSender<SmtcCommand>> {
    None
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_media_session(
    state: State<'_, AppState>,
    title: String,
    artist: String,
    album: String,
    cover_url: Option<String>,
    duration_secs: f64,
    position_secs: f64,
    is_playing: bool,
) -> Result<(), String> {
    if let Some(tx) = state.smtc_tx.read().await.as_ref() {
        let _ = tx.send(SmtcCommand::Update {
            title,
            artist,
            album,
            cover_url,
            duration_secs,
            position_secs,
            is_playing,
        });
    }
    Ok(())
}

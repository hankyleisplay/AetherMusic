use crate::models::{AppState, CachedStream, LyricLine, StreamInfo, YtDlpRunner};
use serde_json::Value;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::process::Command;

const STREAM_TTL_SECS: u64 = 1500; // 25 minutes

fn apply_no_window(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn build_ytdlp_command(runner: &YtDlpRunner, args: &[&str]) -> Command {
    let mut cmd = match runner {
        YtDlpRunner::Executable(exe) => {
            let mut c = Command::new(exe);
            c.args(args);
            c
        }
        YtDlpRunner::PythonModule(py) => {
            let mut c = Command::new(py);
            c.arg("-m").arg("yt_dlp");
            c.args(args);
            c
        }
    };
    apply_no_window(&mut cmd);
    cmd
}

async fn test_runner(runner: &YtDlpRunner) -> Option<String> {
    let mut cmd = build_ytdlp_command(runner, &["--version"]);
    let output = tokio::time::timeout(Duration::from_secs(6), cmd.output())
        .await
        .ok()?
        .ok()?;
    if output.status.success() {
        let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !ver.is_empty() {
            return Some(ver);
        }
    }
    None
}

fn candidate_paths(app_data_dir: Option<&PathBuf>) -> Vec<YtDlpRunner> {
    let mut candidates = Vec::new();

    if let Some(dir) = app_data_dir {
        #[cfg(target_os = "windows")]
        let local_bin = dir.join("bin").join("yt-dlp.exe");
        #[cfg(not(target_os = "windows"))]
        let local_bin = dir.join("bin").join("yt-dlp");
        if local_bin.exists() {
            candidates.push(YtDlpRunner::Executable(local_bin.to_string_lossy().to_string()));
        }
    }

    candidates.push(YtDlpRunner::Executable("yt-dlp".to_string()));

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            let py_root = PathBuf::from(local_app).join("Programs").join("Python");
            if let Ok(entries) = std::fs::read_dir(&py_root) {
                for entry in entries.flatten() {
                    let exe = entry.path().join("Scripts").join("yt-dlp.exe");
                    if exe.exists() {
                        candidates.push(YtDlpRunner::Executable(exe.to_string_lossy().to_string()));
                    }
                }
            }
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let roaming_py = PathBuf::from(user_profile)
                .join("AppData")
                .join("Roaming")
                .join("Python");
            if let Ok(entries) = std::fs::read_dir(&roaming_py) {
                for entry in entries.flatten() {
                    let exe = entry.path().join("Scripts").join("yt-dlp.exe");
                    if exe.exists() {
                        candidates.push(YtDlpRunner::Executable(exe.to_string_lossy().to_string()));
                    }
                }
            }
        }
    }

    candidates.push(YtDlpRunner::PythonModule("python".to_string()));
    candidates.push(YtDlpRunner::PythonModule("python3".to_string()));
    #[cfg(target_os = "windows")]
    candidates.push(YtDlpRunner::PythonModule("py".to_string()));

    candidates
}

pub async fn detect_or_setup_ytdlp(
    state: &AppState,
    allow_download: bool,
) -> Result<(YtDlpRunner, String), String> {
    if let Some(existing) = state.ytdlp_cmd.read().await.clone() {
        if let Some(ver) = test_runner(&existing).await {
            return Ok((existing, ver));
        }
    }

    let app_dir = state.app_data_dir.read().await.clone();
    let candidates = candidate_paths(app_dir.as_ref());
    for candidate in candidates {
        if let Some(ver) = test_runner(&candidate).await {
            *state.ytdlp_cmd.write().await = Some(candidate.clone());
            return Ok((candidate, ver));
        }
    }

    if allow_download {
        if let Some(dir) = app_dir {
            let bin_dir = dir.join("bin");
            tokio::fs::create_dir_all(&bin_dir)
                .await
                .map_err(|e| format!("Failed to create bin dir: {e}"))?;

            #[cfg(target_os = "windows")]
            let (url, filename) = (
                "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
                "yt-dlp.exe",
            );
            #[cfg(not(target_os = "windows"))]
            let (url, filename) = (
                "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
                "yt-dlp",
            );

            let dest = bin_dir.join(filename);
            let resp = state
                .http_client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("Failed to download yt-dlp: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("Failed to download yt-dlp: HTTP {}", resp.status()));
            }
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| format!("Failed reading yt-dlp binary: {e}"))?;
            tokio::fs::write(&dest, &bytes)
                .await
                .map_err(|e| format!("Failed saving yt-dlp: {e}"))?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = tokio::fs::metadata(&dest)
                    .await
                    .map_err(|e| e.to_string())?
                    .permissions();
                perms.set_mode(0o755);
                tokio::fs::set_permissions(&dest, perms)
                    .await
                    .map_err(|e| e.to_string())?;
            }

            let runner = YtDlpRunner::Executable(dest.to_string_lossy().to_string());
            if let Some(ver) = test_runner(&runner).await {
                *state.ytdlp_cmd.write().await = Some(runner.clone());
                return Ok((runner, ver));
            }
        }
    }

    Err("找不到 yt-dlp，請安裝 yt-dlp (pip install yt-dlp) 或確認網路連線。".to_string())
}

pub async fn get_ytdlp_status(state: &AppState) -> (bool, String, String) {
    match detect_or_setup_ytdlp(state, false).await {
        Ok((runner, ver)) => {
            let path = match runner {
                YtDlpRunner::Executable(p) => p,
                YtDlpRunner::PythonModule(py) => format!("{py} -m yt_dlp"),
            };
            (true, ver, path)
        }
        Err(_) => (false, String::new(), String::new()),
    }
}

fn infer_mime_type(ext: &str, acodec: &str) -> String {
    let e = ext.to_lowercase();
    let c = acodec.to_lowercase();
    if e == "m4a" || e == "mp4" || c.starts_with("mp4a") || c.contains("aac") {
        "audio/mp4".to_string()
    } else if e == "webm" || c.contains("opus") || c.contains("vorbis") {
        "audio/webm".to_string()
    } else if e == "mp3" || c.contains("mp3") {
        "audio/mpeg".to_string()
    } else if e == "ogg" {
        "audio/ogg".to_string()
    } else {
        "audio/mp4".to_string()
    }
}

pub async fn invalidate_stream_cache(state: &AppState, video_id: &str) {
    state.stream_cache.write().await.remove(video_id);
}

pub async fn get_or_extract_stream(
    state: &AppState,
    video_id: &str,
) -> Result<CachedStream, String> {
    {
        let cache = state.stream_cache.read().await;
        if let Some(entry) = cache.get(video_id) {
            if entry.fetched_at.elapsed() < Duration::from_secs(STREAM_TTL_SECS) {
                return Ok(entry.clone());
            }
        }
    }

    let lock = state.lock_for_video(video_id).await;
    let _guard = lock.lock().await;

    {
        let cache = state.stream_cache.read().await;
        if let Some(entry) = cache.get(video_id) {
            if entry.fetched_at.elapsed() < Duration::from_secs(STREAM_TTL_SECS) {
                return Ok(entry.clone());
            }
        }
    }

    let (runner, _) = detect_or_setup_ytdlp(state, true).await?;
    let watch_url = format!("https://www.youtube.com/watch?v={video_id}");

    let mut cmd = build_ytdlp_command(
        &runner,
        &[
            "--no-playlist",
            "--no-warnings",
            "--no-check-certificates",
            "-f",
            "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio",
            "--print",
            "%(acodec)s|%(abr)s|%(ext)s|%(url)s",
            &watch_url,
        ],
    );

    let output = tokio::time::timeout(Duration::from_secs(25), cmd.output())
        .await
        .map_err(|_| "yt-dlp 解析串流逾時".to_string())?
        .map_err(|e| format!("執行 yt-dlp 失敗: {e}"))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("yt-dlp 解析音訊失敗: {err_msg}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .find(|l| !l.trim().is_empty())
        .ok_or_else(|| "yt-dlp 未回傳有效的串流網址".to_string())?
        .trim();

    let parts: Vec<&str> = line.splitn(4, '|').collect();
    let (acodec, abr, ext, direct_url) = if parts.len() == 4 && parts[3].starts_with("http") {
        let abr_raw = parts[1].trim();
        let abr_fmt = if abr_raw == "NA" || abr_raw.is_empty() {
            "128 kbps".to_string()
        } else if let Ok(num) = abr_raw.parse::<f64>() {
            format!("{} kbps", num.round() as u64)
        } else {
            abr_raw.to_string()
        };
        (
            parts[0].trim().to_string(),
            abr_fmt,
            parts[2].trim().to_string(),
            parts[3].trim().to_string(),
        )
    } else if line.starts_with("http") {
        (
            "mp4a.40.2".to_string(),
            "128 kbps".to_string(),
            "m4a".to_string(),
            line.to_string(),
        )
    } else {
        return Err(format!("無法解析 yt-dlp 輸出格式: {line}"));
    };

    let mime_type = infer_mime_type(&ext, &acodec);
    let cached = CachedStream {
        direct_url,
        mime_type,
        acodec,
        abr,
        fetched_at: Instant::now(),
    };

    state
        .stream_cache
        .write()
        .await
        .insert(video_id.to_string(), cached.clone());

    Ok(cached)
}

pub async fn build_stream_info(state: &AppState, video_id: &str) -> Result<StreamInfo, String> {
    let cached = get_or_extract_stream(state, video_id).await?;
    let port = *state.proxy_port.read().await;
    let proxy_url = if port > 0 {
        format!("http://127.0.0.1:{port}/stream/{video_id}")
    } else {
        cached.direct_url.clone()
    };

    Ok(StreamInfo {
        video_id: video_id.to_string(),
        proxy_url,
        direct_url: cached.direct_url,
        mime_type: cached.mime_type,
        acodec: cached.acodec,
        abr: cached.abr,
    })
}

pub async fn extract_cc_lyrics(
    state: &AppState,
    video_id: &str,
) -> Result<(Vec<LyricLine>, String), String> {
    let (runner, _) = detect_or_setup_ytdlp(state, false).await?;
    let watch_url = format!("https://www.youtube.com/watch?v={video_id}");

    let mut cmd = build_ytdlp_command(
        &runner,
        &[
            "--dump-json",
            "--no-playlist",
            "--skip-download",
            "--no-warnings",
            &watch_url,
        ],
    );

    let output = tokio::time::timeout(Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| "yt-dlp 讀取字幕逾時".to_string())?
        .map_err(|e| format!("yt-dlp 執行失敗: {e}"))?;

    if !output.status.success() {
        return Err("無法從 yt-dlp 取得影片字幕資訊".to_string());
    }

    let json: Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("解析字幕 JSON 失敗: {e}"))?;

    let preferred_langs = [
        "zh-Hant", "zh-TW", "zh-HK", "zh-Hans", "zh-CN", "zh", "en", "ja", "ko",
    ];

    let pick_json3_url = |map_val: Option<&Value>| -> Option<String> {
        let obj = map_val?.as_object()?;
        for lang in preferred_langs {
            if let Some(arr) = obj.get(lang).and_then(|v| v.as_array()) {
                for fmt in arr {
                    if fmt.get("ext").and_then(|e| e.as_str()) == Some("json3") {
                        if let Some(u) = fmt.get("url").and_then(|u| u.as_str()) {
                            return Some(u.to_string());
                        }
                    }
                }
            }
        }
        for (_lang, val) in obj {
            if let Some(arr) = val.as_array() {
                for fmt in arr {
                    if fmt.get("ext").and_then(|e| e.as_str()) == Some("json3") {
                        if let Some(u) = fmt.get("url").and_then(|u| u.as_str()) {
                            return Some(u.to_string());
                        }
                    }
                }
            }
        }
        None
    };

    let sub_url = pick_json3_url(json.get("subtitles"))
        .or_else(|| pick_json3_url(json.get("automatic_captions")))
        .ok_or_else(|| "此曲目未提供雲端字幕".to_string())?;

    let sub_resp = state
        .http_client
        .get(&sub_url)
        .send()
        .await
        .map_err(|e| format!("下載字幕失敗: {e}"))?;
    let sub_json: Value = sub_resp
        .json()
        .await
        .map_err(|e| format!("解析 json3 字幕失敗: {e}"))?;

    let mut lines = Vec::new();
    if let Some(events) = sub_json.get("events").and_then(|v| v.as_array()) {
        for ev in events {
            let t_ms = ev.get("tStartMs").and_then(|v| v.as_u64()).unwrap_or(0);
            let mut text = String::new();
            if let Some(segs) = ev.get("segs").and_then(|v| v.as_array()) {
                for seg in segs {
                    if let Some(u) = seg.get("utf8").and_then(|v| v.as_str()) {
                        text.push_str(u);
                    }
                }
            }
            let cleaned = text.replace('\n', " ").trim().to_string();
            if !cleaned.is_empty() && cleaned != "\n" {
                lines.push(LyricLine {
                    time_ms: t_ms,
                    text: cleaned,
                });
            }
        }
    }

    if lines.is_empty() {
        return Err("字幕內容為空".to_string());
    }

    let plain_text = lines
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    Ok((lines, plain_text))
}

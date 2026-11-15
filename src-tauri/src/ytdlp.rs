#![allow(dead_code)]

use crate::models::{AppState, CachedStream, LyricLine, StreamInfo, YtDlpRunner};
use serde_json::{json, Value};
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

pub fn build_ytdlp_command(runner: &YtDlpRunner, args: &[&str]) -> Command {
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
    if let Ok(path_val) = std::env::var("PATH") {
        if path_val.contains('"') {
            cmd.env("PATH", path_val.replace('"', ""));
        }
    }
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

async fn has_node_runtime() -> bool {
    let mut cmd = Command::new("node");
    cmd.arg("-v");
    apply_no_window(&mut cmd);
    matches!(
        tokio::time::timeout(Duration::from_secs(2), cmd.output()).await,
        Ok(Ok(out)) if out.status.success()
    )
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

    #[cfg(target_os = "linux")]
    {
        for sys_path in ["/usr/bin/yt-dlp", "/usr/local/bin/yt-dlp"] {
            if PathBuf::from(sys_path).exists() {
                candidates.push(YtDlpRunner::Executable(sys_path.to_string()));
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            let user_bin = PathBuf::from(home).join(".local").join("bin").join("yt-dlp");
            if user_bin.exists() {
                candidates.push(YtDlpRunner::Executable(user_bin.to_string_lossy().to_string()));
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
    #[cfg(target_os = "android")]
    {
        let _ = (state, allow_download);
        return Err("Android 環境使用內建純 Rust InnerTube 音訊串流引擎".to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
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
                #[cfg(target_os = "linux")]
                let (url, filename) = (
                    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
                    "yt-dlp",
                );
                #[cfg(not(any(target_os = "windows", target_os = "linux")))]
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

        Err("找不到 yt-dlp，將改用內建純 Rust InnerTube 串流引擎。".to_string())
    }
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
    if e == "flac" || c.contains("flac") {
        "audio/flac".to_string()
    } else if e == "wav" {
        "audio/wav".to_string()
    } else if e == "m4a" || e == "mp4" || c.starts_with("mp4a") || c.contains("aac") || c.contains("alac") {
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

fn format_sample_rate(asr_raw: &str) -> String {
    let trimmed = asr_raw.trim();
    if let Ok(hz) = trimmed.parse::<f64>() {
        if hz >= 1000.0 {
            let khz = hz / 1000.0;
            if (khz - khz.round()).abs() < 0.05 {
                return format!("{} kHz", khz.round() as u64);
            }
            return format!("{khz:.1} kHz");
        }
    }
    "48 kHz".to_string()
}

fn build_quality_metadata(quality: &str, acodec: &str, sample_rate: &str) -> (String, String) {
    let lower_codec = acodec.to_lowercase();
    if lower_codec.contains("flac") || lower_codec.contains("alac") || lower_codec.contains("pcm") {
        return (
            "24-bit Lossless".to_string(),
            format!("Native Lossless · {sample_rate}"),
        );
    }
    match quality {
        "lossless" => (
            "32-bit Float Hi-Res DSP".to_string(),
            format!("Hi-Res Master DSP · {sample_rate}"),
        ),
        "standard" => ("16-bit Standard".to_string(), format!("標準省流 · {sample_rate}")),
        _ => ("24-bit Float DSP".to_string(), format!("高解析串流 · {sample_rate}")),
    }
}

pub async fn invalidate_stream_cache(state: &AppState, video_id: &str) {
    let prefix = format!("{video_id}:");
    let mut cache = state.stream_cache.write().await;
    cache.retain(|k, _| k != video_id && !k.starts_with(&prefix));
}

pub async fn extract_stream_innertube(
    state: &AppState,
    video_id: &str,
    quality: &str,
) -> Result<CachedStream, String> {
    // 1. Obtain visitorData from YTMusic next
    let next_resp = state
        .http_client
        .post("https://music.youtube.com/youtubei/v1/next?prettyPrint=false")
        .header("Origin", "https://music.youtube.com")
        .header("Referer", "https://music.youtube.com/")
        .json(&json!({
            "context": {
                "client": {
                    "clientName": "WEB_REMIX",
                    "clientVersion": "1.20240501.01.00",
                    "hl": "zh-TW",
                    "gl": "TW"
                }
            },
            "videoId": video_id
        }))
        .send()
        .await
        .map_err(|e| format!("InnerTube visitorData request failed: {e}"))?;

    let next_json: Value = next_resp
        .json()
        .await
        .map_err(|e| format!("InnerTube next JSON parse error: {e}"))?;
    let visitor_data = next_json
        .pointer("/responseContext/visitorData")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 2. Request player adaptiveFormats via VISIONOS client (works cross-platform in pure Rust)
    let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
    let mut player_req = state
        .http_client
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("User-Agent", ua)
        .header("Origin", "https://www.youtube.com");

    if !visitor_data.is_empty() {
        player_req = player_req.header("X-Goog-Visitor-Id", &visitor_data);
    }

    let player_resp = player_req
        .json(&json!({
            "context": {
                "client": {
                    "clientName": "VISIONOS",
                    "clientVersion": "1.02",
                    "deviceMake": "Apple",
                    "deviceModel": "RealityDevice17,1",
                    "userAgent": ua,
                    "osName": "visionOS",
                    "osVersion": "26.5.23O471",
                    "hl": "en",
                    "visitorData": visitor_data
                }
            },
            "videoId": video_id
        }))
        .send()
        .await
        .map_err(|e| format!("InnerTube player request failed: {e}"))?;

    let player_json: Value = player_resp
        .json()
        .await
        .map_err(|e| format!("InnerTube player JSON parse error: {e}"))?;

    let formats = player_json
        .pointer("/streamingData/adaptiveFormats")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "InnerTube 未回傳音訊串流格式".to_string())?;

    let mut audio_candidates: Vec<&Value> = formats
        .iter()
        .filter(|f| {
            let mime = f.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
            let url = f.get("url").and_then(|v| v.as_str()).unwrap_or("");
            mime.starts_with("audio/") && !url.is_empty()
        })
        .collect();

    if audio_candidates.is_empty() {
        return Err("InnerTube 找不到直接可串流的音訊軌道".to_string());
    }

    audio_candidates.sort_by_key(|f| {
        let mime = f.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
        let bitrate = f.get("bitrate").and_then(|v| v.as_u64()).unwrap_or(0);
        let asr = f
            .get("audioSampleRate")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(44100);

        match quality {
            "standard" => {
                let cap_bonus = if bitrate <= 150_000 { 1_000_000 } else { 0 };
                cap_bonus + bitrate
            }
            "lossless" => {
                let opus_bonus = if mime.contains("opus") { 500_000 } else { 0 };
                let sr_bonus = if asr >= 48000 { 300_000 } else { 0 };
                opus_bonus + sr_bonus + bitrate
            }
            _ => {
                let m4a_bonus = if mime.contains("mp4a") { 200_000 } else { 0 };
                m4a_bonus + bitrate
            }
        }
    });

    let best = audio_candidates
        .last()
        .ok_or_else(|| "無法選擇最佳音訊格式".to_string())?;

    let direct_url = best
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let full_mime = best
        .get("mimeType")
        .and_then(|v| v.as_str())
        .unwrap_or("audio/mp4");
    let base_mime = full_mime.split(';').next().unwrap_or("audio/mp4").trim().to_string();
    let acodec = if full_mime.contains("opus") {
        "opus".to_string()
    } else if full_mime.contains("mp4a.40.2") {
        "mp4a.40.2".to_string()
    } else if full_mime.contains("mp4a.40.5") {
        "mp4a.40.5".to_string()
    } else {
        "aac".to_string()
    };
    let bitrate = best.get("bitrate").and_then(|v| v.as_u64()).unwrap_or(128000);
    let abr = format!("{} kbps", (bitrate as f64 / 1000.0).round() as u64);
    let asr_str = best
        .get("audioSampleRate")
        .and_then(|v| v.as_str())
        .unwrap_or("48000");
    let sample_rate = format_sample_rate(asr_str);
    let (bit_depth, quality_label) = build_quality_metadata(quality, &acodec, &sample_rate);

    Ok(CachedStream {
        direct_url,
        mime_type: base_mime,
        acodec,
        abr,
        sample_rate,
        bit_depth,
        quality_label,
        engine_used: "rust-innertube".to_string(),
        fetched_at: Instant::now(),
    })
}

async fn extract_stream_ytdlp(
    state: &AppState,
    video_id: &str,
    quality: &str,
) -> Result<CachedStream, String> {
    let (runner, _) = detect_or_setup_ytdlp(state, true).await?;
    let watch_url = format!("https://www.youtube.com/watch?v={video_id}");

    let format_selector = match quality {
        "lossless" => {
            "bestaudio[acodec=flac]/bestaudio[ext=flac]/bestaudio[ext=wav]/bestaudio[ext=alac]/bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio"
        }
        "standard" => "bestaudio[abr<=135]/bestaudio[ext=m4a]/bestaudio",
        _ => "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio",
    };

    let mut args = vec![
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "-f",
        format_selector,
        "--print",
        "%(acodec)s|%(abr)s|%(asr)s|%(ext)s|%(url)s",
    ];
    if has_node_runtime().await {
        args.push("--js-runtimes");
        args.push("node");
    }
    args.push(&watch_url);

    let mut cmd = build_ytdlp_command(&runner, &args);
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

    let parts: Vec<&str> = line.splitn(5, '|').collect();
    let (acodec, abr, sample_rate, ext, direct_url) = if parts.len() == 5 && parts[4].starts_with("http") {
        let abr_raw = parts[1].trim();
        let abr_fmt = if abr_raw == "NA" || abr_raw.is_empty() {
            "148 kbps".to_string()
        } else if let Ok(num) = abr_raw.parse::<f64>() {
            format!("{} kbps", num.round() as u64)
        } else {
            abr_raw.to_string()
        };
        (
            parts[0].trim().to_string(),
            abr_fmt,
            format_sample_rate(parts[2]),
            parts[3].trim().to_string(),
            parts[4].trim().to_string(),
        )
    } else if line.starts_with("http") {
        (
            "opus".to_string(),
            "148 kbps".to_string(),
            "48 kHz".to_string(),
            "webm".to_string(),
            line.to_string(),
        )
    } else {
        return Err(format!("無法解析 yt-dlp 輸出格式: {line}"));
    };

    let mime_type = infer_mime_type(&ext, &acodec);
    let (bit_depth, quality_label) = build_quality_metadata(quality, &acodec, &sample_rate);

    Ok(CachedStream {
        direct_url,
        mime_type,
        acodec,
        abr,
        sample_rate,
        bit_depth,
        quality_label,
        engine_used: "yt-dlp".to_string(),
        fetched_at: Instant::now(),
    })
}

pub async fn extract_stream_network(
    state: &AppState,
    video_id: &str,
    quality: &str,
) -> Result<CachedStream, String> {
    let norm_quality = match quality {
        "standard" | "high" | "lossless" => quality,
        _ => "lossless",
    };
    let cache_key = format!("{video_id}:{norm_quality}");

    {
        let cache = state.stream_cache.read().await;
        if let Some(entry) = cache.get(&cache_key) {
            if entry.fetched_at.elapsed() < Duration::from_secs(STREAM_TTL_SECS)
                && !entry.direct_url.starts_with("file://")
            {
                return Ok(entry.clone());
            }
        }
    }

    let lock = state.lock_for_video(&cache_key).await;
    let _guard = lock.lock().await;

    {
        let cache = state.stream_cache.read().await;
        if let Some(entry) = cache.get(&cache_key) {
            if entry.fetched_at.elapsed() < Duration::from_secs(STREAM_TTL_SECS)
                && !entry.direct_url.starts_with("file://")
            {
                return Ok(entry.clone());
            }
        }
    }

    let extracted = match extract_stream_ytdlp(state, video_id, norm_quality).await {
        Ok(res) => res,
        Err(_ytdlp_err) => extract_stream_innertube(state, video_id, norm_quality).await?,
    };

    state
        .stream_cache
        .write()
        .await
        .insert(cache_key, extracted.clone());

    Ok(extracted)
}

pub async fn get_or_extract_stream(
    state: &AppState,
    video_id: &str,
    quality: &str,
) -> Result<CachedStream, String> {
    if let Some((path, entry)) = crate::cache::get_cached_audio(state, video_id).await {
        return Ok(crate::cache::cached_entry_to_stream(&entry, &path));
    }

    extract_stream_network(state, video_id, quality).await
}

pub async fn build_stream_info(
    state: &AppState,
    video_id: &str,
    quality: Option<&str>,
) -> Result<StreamInfo, String> {
    let q = match quality.unwrap_or("lossless") {
        "standard" => "standard",
        "high" => "high",
        _ => "lossless",
    };
    let cached = get_or_extract_stream(state, video_id, q).await?;
    let port = *state.proxy_port.read().await;
    let proxy_url = if port > 0 {
        format!("http://127.0.0.1:{port}/stream/{video_id}?quality={q}")
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
        sample_rate: cached.sample_rate,
        bit_depth: cached.bit_depth,
        quality_label: cached.quality_label,
        engine_used: cached.engine_used,
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

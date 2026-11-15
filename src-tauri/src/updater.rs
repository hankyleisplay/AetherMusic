use crate::models::{AppState, UpdateActionResult, UpdateStatus, YtDlpRunner};
use crate::ytdlp;
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const APP_REPO: &str = "hankyleisplay/AetherMusic";
const YTDLP_LATEST_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

fn normalize_tag(tag: &str) -> String {
    tag.trim().trim_start_matches('v').to_string()
}

fn current_utc_label() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("UNIX {secs}")
}

pub async fn check_updates(state: &AppState) -> Result<UpdateStatus, String> {
    let current_app_version = env!("CARGO_PKG_VERSION").to_string();
    let app_release_api = format!("https://api.github.com/repos/{APP_REPO}/releases/latest");
    let fallback_repo_url = format!("https://github.com/{APP_REPO}/releases");

    let (ytdlp_avail, ytdlp_cur_ver, _) = ytdlp::get_ytdlp_status(state).await;

    let app_req = state
        .http_client
        .get(&app_release_api)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "AetherMusic-Updater");

    let ytdlp_req = state
        .http_client
        .get(YTDLP_LATEST_API)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "AetherMusic-Updater");

    let (app_res, ytdlp_res) = tokio::join!(app_req.send(), ytdlp_req.send());

    let mut latest_app_version = current_app_version.clone();
    let mut app_update_available = false;
    let mut release_url = fallback_repo_url.clone();
    let mut release_notes = String::from("已同步至最新 AetherMusic 主分支版本。");

    if let Ok(resp) = app_res {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<Value>().await {
                if let Some(tag) = json.get("tag_name").and_then(|v| v.as_str()) {
                    let norm = normalize_tag(tag);
                    if !norm.is_empty() {
                        latest_app_version = norm.clone();
                        app_update_available = norm != normalize_tag(&current_app_version);
                    }
                }
                if let Some(html_url) = json.get("html_url").and_then(|v| v.as_str()) {
                    release_url = html_url.to_string();
                }
                if let Some(body) = json.get("body").and_then(|v| v.as_str()) {
                    let trimmed = body.trim();
                    if !trimmed.is_empty() {
                        release_notes = trimmed.chars().take(280).collect();
                    }
                }
            }
        } else {
            // If no GitHub Release tag yet, inspect latest commit SHA from main
            let commits_api = format!("https://api.github.com/repos/{APP_REPO}/commits/main");
            if let Ok(c_resp) = state
                .http_client
                .get(&commits_api)
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "AetherMusic-Updater")
                .send()
                .await
            {
                if c_resp.status().is_success() {
                    if let Ok(c_json) = c_resp.json::<Value>().await {
                        if let Some(sha) = c_json.get("sha").and_then(|v| v.as_str()) {
                            let short_sha: String = sha.chars().take(7).collect();
                            let msg = c_json
                                .pointer("/commit/message")
                                .and_then(|v| v.as_str())
                                .unwrap_or("main branch")
                                .lines()
                                .next()
                                .unwrap_or("");
                            release_notes = format!("GitHub main 最新提交 ({short_sha}): {msg}");
                            release_url = format!("https://github.com/{APP_REPO}");
                        }
                    }
                }
            }
        }
    }

    let mut ytdlp_latest_version = ytdlp_cur_ver.clone();
    let mut ytdlp_update_available = false;
    if let Ok(resp) = ytdlp_res {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<Value>().await {
                if let Some(tag) = json.get("tag_name").and_then(|v| v.as_str()) {
                    let norm = normalize_tag(tag);
                    if !norm.is_empty() {
                        ytdlp_latest_version = norm.clone();
                        if ytdlp_avail && !ytdlp_cur_ver.is_empty() {
                            ytdlp_update_available = norm != normalize_tag(&ytdlp_cur_ver);
                        }
                    }
                }
            }
        }
    }

    Ok(UpdateStatus {
        current_app_version,
        latest_app_version,
        app_update_available,
        release_url,
        release_notes,
        ytdlp_current_version: if ytdlp_avail {
            ytdlp_cur_ver
        } else {
            "純 Rust InnerTube".to_string()
        },
        ytdlp_latest_version,
        ytdlp_update_available,
        last_checked: current_utc_label(),
    })
}

#[cfg(not(target_os = "android"))]
async fn upgrade_via_pip(py: &str) -> (bool, String) {
    let mut cmd = tokio::process::Command::new(py);
    cmd.args(["-m", "pip", "install", "-U", "yt-dlp"]);
    if let Ok(path_val) = std::env::var("PATH") {
        if path_val.contains('"') {
            cmd.env("PATH", path_val.replace('"', ""));
        }
    }
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    match tokio::time::timeout(Duration::from_secs(60), cmd.output()).await {
        Ok(Ok(out)) => {
            if out.status.success() {
                (true, "已透過 pip 自動更新 yt-dlp 至最新版本。".to_string())
            } else {
                let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                (false, if err.is_empty() { "pip 更新失敗".to_string() } else { err })
            }
        }
        _ => (false, "執行 pip 更新逾時或失敗".to_string()),
    }
}

pub async fn perform_core_update(state: &AppState) -> Result<UpdateActionResult, String> {
    let status_before = check_updates(state).await?;

    #[cfg(target_os = "android")]
    {
        return Ok(UpdateActionResult {
            success: true,
            message: "Android 平台使用內建純 Rust InnerTube 引擎，無需更新外部二進位檔。".to_string(),
            updated_ytdlp_version: "rust-innertube".to_string(),
            release_url: status_before.release_url,
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        let Ok((runner, cur_ver)) = ytdlp::detect_or_setup_ytdlp(state, true).await else {
            return Ok(UpdateActionResult {
                success: false,
                message: "未偵測到本機 yt-dlp，目前由內建 Rust InnerTube 引擎接手串流。".to_string(),
                updated_ytdlp_version: "rust-innertube".to_string(),
                release_url: status_before.release_url,
            });
        };

        let mut msg = String::new();
        let mut ok = false;

        match &runner {
            YtDlpRunner::Executable(_) => {
                let mut cmd = ytdlp::build_ytdlp_command(&runner, &["-U"]);
                if let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(45), cmd.output()).await {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    let combined = format!("{stdout} {stderr}");
                    if combined.contains("pip") || combined.contains("installed using pip") {
                        (ok, msg) = upgrade_via_pip("python").await;
                    } else {
                        ok = out.status.success();
                        msg = stdout.lines().last().unwrap_or("已執行 yt-dlp 更新檢查").trim().to_string();
                    }
                }
            }
            YtDlpRunner::PythonModule(py) => {
                (ok, msg) = upgrade_via_pip(py).await;
            }
        }

        // Clear cached runner so next check re-reads updated version
        *state.ytdlp_cmd.write().await = None;
        let (_, new_ver, _) = ytdlp::get_ytdlp_status(state).await;
        let final_ver = if new_ver.is_empty() { cur_ver } else { new_ver };

        if msg.is_empty() {
            msg = format!("串流核心檢查完畢 (目前版本: {final_ver})");
        }

        Ok(UpdateActionResult {
            success: ok,
            message: msg,
            updated_ytdlp_version: final_ver,
            release_url: status_before.release_url,
        })
    }
}

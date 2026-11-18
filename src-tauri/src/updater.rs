use crate::models::{AppState, UpdateActionResult, UpdateStatus, YtDlpRunner};
use crate::ytdlp;
use serde_json::Value;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Emitter;

const APP_REPO: &str = "hankyleisplay/AetherMusic";
const YTDLP_LATEST_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

fn normalize_tag(tag: &str) -> String {
    tag.trim().trim_start_matches(['v', 'V']).to_string()
}

fn parse_version_parts(raw: &str) -> Vec<u64> {
    let trimmed = normalize_tag(raw);
    let core = trimmed.split(['-', '+']).next().unwrap_or("");
    core.split('.')
        .filter_map(|part| {
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            if digits.is_empty() {
                None
            } else {
                digits.parse::<u64>().ok()
            }
        })
        .collect()
}

pub fn is_newer_version(latest: &str, current: &str) -> bool {
    let l_parts = parse_version_parts(latest);
    let c_parts = parse_version_parts(current);
    if l_parts.is_empty() || c_parts.is_empty() {
        return false;
    }
    let max_len = l_parts.len().max(c_parts.len());
    for i in 0..max_len {
        let l = *l_parts.get(i).unwrap_or(&0);
        let c = *c_parts.get(i).unwrap_or(&0);
        if l != c {
            return l > c;
        }
    }
    false
}

fn current_utc_label() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("UNIX {secs}")
}

fn select_platform_installer_asset(assets: &[Value]) -> (Option<String>, Option<String>) {
    let parsed: Vec<(String, String)> = assets
        .iter()
        .filter_map(|asset| {
            let name = asset.get("name")?.as_str()?.trim().to_string();
            let url = asset
                .get("browser_download_url")?
                .as_str()?
                .trim()
                .to_string();
            if name.is_empty() || url.is_empty() {
                None
            } else {
                Some((name, url))
            }
        })
        .collect();

    #[cfg(target_os = "windows")]
    {
        if let Some((n, u)) = parsed
            .iter()
            .find(|(n, _)| n.to_lowercase().ends_with("-setup.exe"))
        {
            return (Some(n.clone()), Some(u.clone()));
        }
        if let Some((n, u)) = parsed
            .iter()
            .find(|(n, _)| n.to_lowercase().ends_with(".exe"))
        {
            return (Some(n.clone()), Some(u.clone()));
        }
        if let Some((n, u)) = parsed
            .iter()
            .find(|(n, _)| n.to_lowercase().ends_with(".msi"))
        {
            return (Some(n.clone()), Some(u.clone()));
        }
    }

    #[cfg(target_os = "linux")]
    {
        let prefer_appimage = std::env::var_os("APPIMAGE").is_some();
        let order = if prefer_appimage {
            [".appimage", ".deb"]
        } else {
            [".deb", ".appimage"]
        };
        for ext in order {
            if let Some((n, u)) = parsed
                .iter()
                .find(|(n, _)| n.to_lowercase().ends_with(ext))
            {
                return (Some(n.clone()), Some(u.clone()));
            }
        }
    }

    #[cfg(target_os = "android")]
    {
        if let Some((n, u)) = parsed
            .iter()
            .find(|(n, _)| n.to_lowercase().ends_with(".apk"))
        {
            return (Some(n.clone()), Some(u.clone()));
        }
    }

    let _ = parsed;
    (None, None)
}

pub fn open_url_in_browser(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://"))
        || trimmed.contains('"')
        || trimmed.chars().any(|c| c.is_whitespace())
    {
        return Err("無效的外部連結格式".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "start", "", trimmed]);
        cmd.creation_flags(0x08000000);
        cmd.spawn().map_err(|e| format!("開啟瀏覽器失敗: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("開啟瀏覽器失敗: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("開啟瀏覽器失敗: {e}"))?;
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Err("目前平臺請由介面直接開啟外部連結".to_string())
    }
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
    let mut installer_name: Option<String> = None;
    let mut installer_url: Option<String> = None;

    if let Ok(resp) = app_res {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<Value>().await {
                if let Some(tag) = json.get("tag_name").and_then(|v| v.as_str()) {
                    let norm = normalize_tag(tag);
                    if !norm.is_empty() {
                        latest_app_version = norm.clone();
                        app_update_available = is_newer_version(&norm, &current_app_version);
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
                if let Some(assets) = json.get("assets").and_then(|v| v.as_array()) {
                    (installer_name, installer_url) = select_platform_installer_asset(assets);
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
                            ytdlp_update_available = is_newer_version(&norm, &ytdlp_cur_ver);
                        } else if !ytdlp_avail && cfg!(not(target_os = "android")) {
                            ytdlp_update_available = true;
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
        installer_url,
        installer_name,
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
                (
                    false,
                    if err.is_empty() {
                        "pip 更新失敗".to_string()
                    } else {
                        err
                    },
                )
            }
        }
        _ => (false, "執行 pip 更新逾時或失敗".to_string()),
    }
}

#[cfg(not(target_os = "android"))]
fn resolve_python_candidates_for_exe(exe_path: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let p = Path::new(exe_path);
    if let Some(parent) = p.parent() {
        #[cfg(target_os = "windows")]
        {
            let py1 = parent.join("python.exe");
            if py1.exists() {
                candidates.push(py1.to_string_lossy().to_string());
            }
            if let Some(grandparent) = parent.parent() {
                let py2 = grandparent.join("python.exe");
                if py2.exists() {
                    candidates.push(py2.to_string_lossy().to_string());
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            for name in ["python3", "python"] {
                let py1 = parent.join(name);
                if py1.exists() {
                    candidates.push(py1.to_string_lossy().to_string());
                }
                if let Some(grandparent) = parent.parent() {
                    let py2 = grandparent.join("bin").join(name);
                    if py2.exists() {
                        candidates.push(py2.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    for fallback in ["python", "python3"] {
        let s = fallback.to_string();
        if !candidates.contains(&s) {
            candidates.push(s);
        }
    }
    #[cfg(target_os = "windows")]
    {
        let py = "py".to_string();
        if !candidates.contains(&py) {
            candidates.push(py);
        }
    }
    candidates
}

#[cfg(not(target_os = "android"))]
async fn try_pip_candidates(candidates: &[String]) -> (bool, String) {
    let mut last_err = String::from("pip 更新失敗");
    for py in candidates {
        let (ok, msg) = upgrade_via_pip(py).await;
        if ok {
            return (true, msg);
        }
        last_err = msg;
    }
    (false, last_err)
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
            app_update_launched: false,
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        let detected = ytdlp::detect_or_setup_ytdlp(state, true).await;
        let (runner, cur_ver) = match detected {
            Ok(pair) => pair,
            Err(_) => match ytdlp::download_standalone_ytdlp(state).await {
                Ok((_r, ver)) => {
                    return Ok(UpdateActionResult {
                        success: true,
                        message: format!("已自動下載最新版獨立 yt-dlp 串流核心 ({ver})"),
                        updated_ytdlp_version: ver,
                        release_url: status_before.release_url,
                        app_update_launched: false,
                    });
                }
                Err(e) => {
                    return Ok(UpdateActionResult {
                        success: false,
                        message: format!("無法取得或下載 yt-dlp ({e})，目前由內建 Rust InnerTube 接手串流。"),
                        updated_ytdlp_version: "rust-innertube".to_string(),
                        release_url: status_before.release_url,
                        app_update_launched: false,
                    });
                }
            },
        };

        let (mut ok, mut msg) = match &runner {
            YtDlpRunner::Executable(exe_path) => {
                let mut cmd = ytdlp::build_ytdlp_command(&runner, &["-U"]);
                if let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(45), cmd.output()).await {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    let combined = format!("{stdout} {stderr}");
                    let lower = combined.to_lowercase();
                    if lower.contains("pip")
                        || lower.contains("wheel")
                        || lower.contains("installed using pip")
                        || lower.contains("package manager")
                    {
                        let py_candidates = resolve_python_candidates_for_exe(exe_path);
                        try_pip_candidates(&py_candidates).await
                    } else if out.status.success() {
                        let line = stdout
                            .lines()
                            .rev()
                            .find(|l| !l.trim().is_empty())
                            .unwrap_or("已執行 yt-dlp 更新檢查")
                            .trim()
                            .to_string();
                        (true, line)
                    } else {
                        let err_line = stderr.trim();
                        let err_msg = if err_line.is_empty() {
                            "yt-dlp 自我更新失敗".to_string()
                        } else {
                            err_line.to_string()
                        };
                        (false, err_msg)
                    }
                } else {
                    (false, "yt-dlp 自我更新執行逾時".to_string())
                }
            }
            YtDlpRunner::PythonModule(py) => upgrade_via_pip(py).await,
        };

        if !ok {
            if let Ok((_new_runner, dl_ver)) = ytdlp::download_standalone_ytdlp(state).await {
                ok = true;
                msg = format!("已自動下載並切換為獨立版最新 yt-dlp ({dl_ver})。");
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
            app_update_launched: false,
        })
    }
}

pub async fn perform_app_update(
    state: &AppState,
    app_handle: Option<tauri::AppHandle>,
) -> Result<UpdateActionResult, String> {
    let status = check_updates(state).await?;

    if !status.app_update_available {
        return Ok(UpdateActionResult {
            success: true,
            message: format!("AetherMusic v{} 已是最新版本。", status.current_app_version),
            updated_ytdlp_version: status.ytdlp_current_version,
            release_url: status.release_url,
            app_update_launched: false,
        });
    }

    let Some(dl_url) = status.installer_url.clone() else {
        let opened = open_url_in_browser(&status.release_url).is_ok();
        return Ok(UpdateActionResult {
            success: true,
            message: if opened {
                format!(
                    "偵測到新版本 v{}，已為您開啟 GitHub Releases 下載頁面。",
                    status.latest_app_version
                )
            } else {
                format!(
                    "偵測到新版本 v{}，請前往 GitHub Releases 下載安裝包。",
                    status.latest_app_version
                )
            },
            updated_ytdlp_version: status.ytdlp_current_version,
            release_url: status.release_url,
            app_update_launched: false,
        });
    };

    #[cfg(target_os = "android")]
    {
        return Ok(UpdateActionResult {
            success: true,
            message: format!(
                "偵測到新版 APK v{}，請透過瀏覽器下載並安裝更新。",
                status.latest_app_version
            ),
            updated_ytdlp_version: status.ytdlp_current_version,
            release_url: dl_url,
            app_update_launched: false,
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        let raw_name = status
            .installer_name
            .as_deref()
            .unwrap_or("AetherMusic-update");
        let file_name = Path::new(raw_name)
            .file_name()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("AetherMusic-update")
            .to_string();

        let update_dir = std::env::temp_dir().join("aethermusic-updater");
        tokio::fs::create_dir_all(&update_dir)
            .await
            .map_err(|e| format!("建立更新暫存目錄失敗: {e}"))?;
        let installer_path = update_dir.join(&file_name);

        let dl_client = reqwest::Client::builder()
            .user_agent("AetherMusic-Updater")
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|e| format!("建立更新下載連線失敗: {e}"))?;

        let resp = dl_client
            .get(&dl_url)
            .send()
            .await
            .map_err(|e| format!("下載 AetherMusic 更新檔失敗: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("下載更新檔失敗: HTTP {}", resp.status()));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("讀取更新安裝包內容失敗: {e}"))?;

        if bytes.len() < 100_000 {
            return Err("下載的更新安裝包過小或已損毀".to_string());
        }

        tokio::fs::write(&installer_path, &bytes)
            .await
            .map_err(|e| format!("儲存更新安裝包失敗: {e}"))?;

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;

            let fallback_exe = std::env::var_os("LOCALAPPDATA")
                .map(|local| Path::new(&local).join("AetherMusic").join("aether-music.exe"));
            let relaunch_exe = std::env::current_exe()
                .ok()
                .or(fallback_exe)
                .unwrap_or_else(|| Path::new("aether-music.exe").to_path_buf());

            let esc_ps = |p: &Path| p.to_string_lossy().replace('\'', "''");
            let installer_ps = esc_ps(&installer_path);
            let relaunch_ps = esc_ps(&relaunch_exe);

            let ps_script = format!(
                "\u{FEFF}$ErrorActionPreference = 'SilentlyContinue'\r\n\
                 Start-Sleep -Milliseconds 900\r\n\
                 Get-Process -Name 'aether-music' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue\r\n\
                 Start-Sleep -Milliseconds 500\r\n\
                 $installer = '{installer_ps}'\r\n\
                 $relaunch = '{relaunch_ps}'\r\n\
                 if ($installer.ToLower().EndsWith('.msi')) {{\r\n\
                     Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $installer, '/passive', '/norestart') -Wait\r\n\
                 }} else {{\r\n\
                     $p = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru\r\n\
                     if ($p -and $p.ExitCode -ne 0) {{\r\n\
                         Start-Process -FilePath $installer -Wait\r\n\
                     }}\r\n\
                 }}\r\n\
                 if (Test-Path $relaunch) {{\r\n\
                     Start-Process -FilePath $relaunch\r\n\
                 }} else {{\r\n\
                     $fallback = Join-Path $env:LOCALAPPDATA 'AetherMusic\\aether-music.exe'\r\n\
                     if (Test-Path $fallback) {{\r\n\
                         Start-Process -FilePath $fallback\r\n\
                     }}\r\n\
                 }}\r\n"
            );

            let script_path = update_dir.join("apply-update.ps1");
            tokio::fs::write(&script_path, ps_script.as_bytes())
                .await
                .map_err(|e| format!("寫入更新腳本失敗: {e}"))?;

            let mut cmd = std::process::Command::new("powershell.exe");
            cmd.args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                &script_path.to_string_lossy(),
            ]);
            cmd.creation_flags(0x08000000);
            cmd.spawn()
                .map_err(|e| format!("啟動背景更新安裝程序失敗: {e}"))?;

            state
                .is_quitting
                .store(true, std::sync::atomic::Ordering::Relaxed);
            if let Some(handle) = app_handle {
                let _ = handle.emit("app-will-close", ());
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    handle.exit(0);
                });
            }

            Ok(UpdateActionResult {
                success: true,
                message: format!(
                    "已下載 AetherMusic v{} 更新安裝包，正在自動安裝並重啟...",
                    status.latest_app_version
                ),
                updated_ytdlp_version: status.ytdlp_current_version,
                release_url: status.release_url,
                app_update_launched: true,
            })
        }

        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::PermissionsExt;

            let lower_name = file_name.to_lowercase();
            if lower_name.ends_with(".appimage") {
                if let Some(current_appimage) = std::env::var_os("APPIMAGE") {
                    let target = Path::new(&current_appimage).to_path_buf();
                    let mut perms = tokio::fs::metadata(&installer_path)
                        .await
                        .map_err(|e| e.to_string())?
                        .permissions();
                    perms.set_mode(0o755);
                    tokio::fs::set_permissions(&installer_path, perms)
                        .await
                        .map_err(|e| e.to_string())?;

                    tokio::fs::copy(&installer_path, &target)
                        .await
                        .map_err(|e| format!("替換 AppImage 失敗: {e}"))?;

                    std::process::Command::new(&target)
                        .spawn()
                        .map_err(|e| format!("重新啟動新版本失敗: {e}"))?;

                    state
                        .is_quitting
                        .store(true, std::sync::atomic::Ordering::Relaxed);
                    if let Some(handle) = app_handle {
                        let _ = handle.emit("app-will-close", ());
                        tokio::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            handle.exit(0);
                        });
                    }

                    return Ok(UpdateActionResult {
                        success: true,
                        message: format!(
                            "已下載並套用 AetherMusic v{} AppImage，正在重新啟動...",
                            status.latest_app_version
                        ),
                        updated_ytdlp_version: status.ytdlp_current_version,
                        release_url: status.release_url,
                        app_update_launched: true,
                    });
                }
            }

            let path_str = installer_path.to_string_lossy().to_string();
            let _ = std::process::Command::new("xdg-open")
                .arg(&installer_path)
                .spawn();

            Ok(UpdateActionResult {
                success: true,
                message: format!(
                    "已下載 AetherMusic v{} 安裝包至：{path_str}",
                    status.latest_app_version
                ),
                updated_ytdlp_version: status.ytdlp_current_version,
                release_url: status.release_url,
                app_update_launched: false,
            })
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = app_handle;
            let _ = open_url_in_browser(&status.release_url);
            Ok(UpdateActionResult {
                success: true,
                message: format!(
                    "已下載更新檔至 {}，請開啟安裝包完成更新。",
                    installer_path.to_string_lossy()
                ),
                updated_ytdlp_version: status.ytdlp_current_version,
                release_url: status.release_url,
                app_update_launched: false,
            })
        }
    }
}

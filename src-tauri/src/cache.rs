use crate::models::{AppState, CacheStats, CachedStream, DownloadResult, Track};
use crate::ytdlp;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;

pub const DEFAULT_MAX_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GB

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedAudioEntry {
    pub video_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub acodec: String,
    pub abr: String,
    pub sample_rate: String,
    pub bit_depth: String,
    pub quality_label: String,
    pub size_bytes: u64,
    pub last_accessed_ms: u64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct CacheIndex {
    entries: HashMap<String, CachedAudioEntry>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn sanitize_id(video_id: &str) -> String {
    video_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => ' ',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "AetherMusic_Track".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

pub fn extension_from_mime(mime: &str) -> &'static str {
    let m = mime.to_lowercase();
    if m.contains("mp4") || m.contains("m4a") || m.contains("aac") {
        "m4a"
    } else if m.contains("webm") || m.contains("opus") {
        "webm"
    } else if m.contains("mpeg") || m.contains("mp3") {
        "mp3"
    } else if m.contains("flac") {
        "flac"
    } else if m.contains("ogg") {
        "ogg"
    } else if m.contains("wav") {
        "wav"
    } else {
        "m4a"
    }
}

pub fn mime_from_extension(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "m4a" | "mp4" => "audio/mp4",
        "webm" => "audio/webm",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "audio/mp4",
    }
}

pub async fn resolve_base_data_dir(state: &AppState) -> PathBuf {
    if let Some(ov) = state.base_data_dir_override.read().await.clone() {
        return ov;
    }

    if let Some(dir) = state.app_data_dir.read().await.clone() {
        return dir;
    }

    if let Some(cache_dir) = state.app_cache_dir.read().await.clone() {
        return cache_dir;
    }

    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(xdg).join("AetherMusic");
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local).join("AetherMusic");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".local").join("share").join("AetherMusic");
    }

    std::env::temp_dir().join("AetherMusic")
}

pub fn audio_cache_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("cache").join("audio")
}

fn cache_index_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join("cache_index.json")
}

pub fn append_cache_log(base_dir: &Path, message: &str) {
    println!("[AudioCache] {message}");
    let log_dir = base_dir.join("logs");
    if std::fs::create_dir_all(&log_dir).is_ok() {
        let log_file = log_dir.join("cache.log");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
        {
            let _ = writeln!(file, "[{}] {message}", now_ms());
        }
    }
}

fn load_index_sync(cache_dir: &Path) -> CacheIndex {
    let path = cache_index_path(cache_dir);
    if let Ok(bytes) = std::fs::read(&path) {
        if let Ok(idx) = serde_json::from_slice::<CacheIndex>(&bytes) {
            return idx;
        }
    }
    CacheIndex::default()
}

fn save_index_sync(cache_dir: &Path, idx: &CacheIndex) -> Result<(), String> {
    std::fs::create_dir_all(cache_dir).map_err(|e| format!("建立快取目錄失敗: {e}"))?;
    let path = cache_index_path(cache_dir);
    let tmp = cache_dir.join("cache_index.json.tmp");
    let data = serde_json::to_vec_pretty(idx).map_err(|e| format!("序列化快取索引失敗: {e}"))?;
    std::fs::write(&tmp, &data).map_err(|e| format!("寫入快取索引暫存檔失敗: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("替換快取索引失敗: {e}"))?;
    Ok(())
}

fn find_orphan_audio_file(cache_dir: &Path, safe_id: &str) -> Option<(PathBuf, String)> {
    for ext in ["m4a", "webm", "mp3", "flac", "ogg", "wav"] {
        let candidate = cache_dir.join(format!("{safe_id}.{ext}"));
        if let Ok(meta) = std::fs::metadata(&candidate) {
            if meta.is_file() && meta.len() > 0 {
                return Some((candidate, mime_from_extension(ext).to_string()));
            }
        }
    }
    None
}

pub async fn get_cached_audio_in_dir(
    base_dir: &Path,
    video_id: &str,
) -> Option<(PathBuf, CachedAudioEntry)> {
    let safe_id = sanitize_id(video_id);
    if safe_id.is_empty() {
        return None;
    }
    let cache_dir = audio_cache_dir(base_dir);
    if !cache_dir.exists() {
        return None;
    }

    let mut index = load_index_sync(&cache_dir);
    if let Some(entry) = index.entries.get_mut(&safe_id) {
        let path = cache_dir.join(&entry.file_name);
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.is_file() && meta.len() > 0 {
                entry.size_bytes = meta.len();
                entry.last_accessed_ms = now_ms();
                let cloned = entry.clone();
                let _ = save_index_sync(&cache_dir, &index);
                append_cache_log(
                    base_dir,
                    &format!(
                        "Cache Hit: video_id={safe_id} file={} ({} bytes)",
                        path.display(),
                        cloned.size_bytes
                    ),
                );
                return Some((path, cloned));
            }
        }
        index.entries.remove(&safe_id);
        let _ = save_index_sync(&cache_dir, &index);
    }

    if let Some((path, mime)) = find_orphan_audio_file(&cache_dir, &safe_id) {
        let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let entry = CachedAudioEntry {
            video_id: safe_id.clone(),
            file_name,
            mime_type: mime,
            acodec: "cached".to_string(),
            abr: "Local".to_string(),
            sample_rate: "48 kHz".to_string(),
            bit_depth: "Local Cache".to_string(),
            quality_label: "本機快取零延遲".to_string(),
            size_bytes,
            last_accessed_ms: now_ms(),
        };
        index.entries.insert(safe_id.clone(), entry.clone());
        let _ = save_index_sync(&cache_dir, &index);
        append_cache_log(
            base_dir,
            &format!(
                "Cache Hit: video_id={safe_id} file={} ({} bytes)",
                path.display(),
                entry.size_bytes
            ),
        );
        return Some((path, entry));
    }

    None
}

pub async fn get_cached_audio(
    state: &AppState,
    video_id: &str,
) -> Option<(PathBuf, CachedAudioEntry)> {
    let base_dir = resolve_base_data_dir(state).await;
    let _guard = state.cache_index_lock.lock().await;
    get_cached_audio_in_dir(&base_dir, video_id).await
}

pub fn cached_entry_to_stream(entry: &CachedAudioEntry, path: &Path) -> CachedStream {
    CachedStream {
        direct_url: format!("file://{}", path.to_string_lossy().replace('\\', "/")),
        mime_type: entry.mime_type.clone(),
        acodec: entry.acodec.clone(),
        abr: entry.abr.clone(),
        sample_rate: entry.sample_rate.clone(),
        bit_depth: entry.bit_depth.clone(),
        quality_label: entry.quality_label.clone(),
        engine_used: "local-cache (Cache Hit)".to_string(),
        fetched_at: std::time::Instant::now(),
    }
}

pub fn enforce_lru_limit_in_dir(base_dir: &Path, max_bytes: u64) -> Result<u64, String> {
    let cache_dir = audio_cache_dir(base_dir);
    if !cache_dir.exists() {
        return Ok(0);
    }

    let mut index = load_index_sync(&cache_dir);

    // Reconcile index with actual files on disk
    if let Ok(entries) = std::fs::read_dir(&cache_dir) {
        for dir_entry in entries.flatten() {
            let p = dir_entry.path();
            if !p.is_file() {
                continue;
            }
            let Some(fname) = p.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if fname == "cache_index.json" || fname.ends_with(".tmp") {
                continue;
            }
            let vid = p
                .file_stem()
                .and_then(|s| s.to_str())
                .map(sanitize_id)
                .unwrap_or_default();
            if vid.is_empty() {
                continue;
            }
            let sz = dir_entry.metadata().map(|m| m.len()).unwrap_or(0);
            if !index.entries.contains_key(&vid) {
                let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("m4a");
                index.entries.insert(
                    vid.clone(),
                    CachedAudioEntry {
                        video_id: vid,
                        file_name: fname.to_string(),
                        mime_type: mime_from_extension(ext).to_string(),
                        acodec: "cached".to_string(),
                        abr: "Local".to_string(),
                        sample_rate: "48 kHz".to_string(),
                        bit_depth: "Local Cache".to_string(),
                        quality_label: "本機快取".to_string(),
                        size_bytes: sz,
                        last_accessed_ms: 0,
                    },
                );
            } else if let Some(existing) = index.entries.get_mut(&vid) {
                existing.size_bytes = sz;
            }
        }
    }

    // Prune entries whose files vanished
    index.entries.retain(|_, v| cache_dir.join(&v.file_name).exists());

    let mut total: u64 = index.entries.values().map(|e| e.size_bytes).sum();
    if total > max_bytes {
        let mut sorted: Vec<(String, u64, u64, String)> = index
            .entries
            .iter()
            .map(|(k, v)| (k.clone(), v.last_accessed_ms, v.size_bytes, v.file_name.clone()))
            .collect();
        sorted.sort_by_key(|item| item.1);

        for (vid, _ts, sz, fname) in sorted {
            if total <= max_bytes {
                break;
            }
            let file_path = cache_dir.join(&fname);
            let _ = std::fs::remove_file(&file_path);
            index.entries.remove(&vid);
            total = total.saturating_sub(sz);
            append_cache_log(
                base_dir,
                &format!("LRU Evict: removed {fname} ({sz} bytes), remaining={total} bytes"),
            );
        }
    }

    save_index_sync(&cache_dir, &index)?;
    Ok(total)
}

pub fn register_cached_bytes_in_dir(
    base_dir: &Path,
    video_id: &str,
    meta: &CachedStream,
    bytes: &[u8],
    max_bytes: u64,
) -> Result<PathBuf, String> {
    let safe_id = sanitize_id(video_id);
    if safe_id.is_empty() {
        return Err("無效的曲目 ID".to_string());
    }
    let cache_dir = audio_cache_dir(base_dir);
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("建立快取目錄失敗: {e}"))?;

    let ext = extension_from_mime(&meta.mime_type);
    let file_name = format!("{safe_id}.{ext}");
    let dest = cache_dir.join(&file_name);
    let tmp = cache_dir.join(format!("{file_name}.tmp"));

    std::fs::write(&tmp, bytes).map_err(|e| format!("寫入音訊快取失敗: {e}"))?;
    std::fs::rename(&tmp, &dest).map_err(|e| format!("完成音訊快取寫入失敗: {e}"))?;

    let mut index = load_index_sync(&cache_dir);
    index.entries.insert(
        safe_id.clone(),
        CachedAudioEntry {
            video_id: safe_id.clone(),
            file_name,
            mime_type: meta.mime_type.clone(),
            acodec: meta.acodec.clone(),
            abr: meta.abr.clone(),
            sample_rate: meta.sample_rate.clone(),
            bit_depth: meta.bit_depth.clone(),
            quality_label: meta.quality_label.clone(),
            size_bytes: bytes.len() as u64,
            last_accessed_ms: now_ms(),
        },
    );
    save_index_sync(&cache_dir, &index)?;
    append_cache_log(
        base_dir,
        &format!("Cache Store: video_id={safe_id} ({} bytes)", bytes.len()),
    );
    let _ = enforce_lru_limit_in_dir(base_dir, max_bytes);
    Ok(dest)
}

struct InFlightGuard {
    state: AppState,
    key: String,
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        let key = self.key.clone();
        if let Ok(mut guard) = self.state.cache_in_flight.try_lock() {
            guard.remove(&key);
            return;
        }
        let in_flight = self.state.cache_in_flight.clone();
        tokio::spawn(async move {
            let mut guard = in_flight.lock().await;
            guard.remove(&key);
        });
    }
}

pub async fn cache_audio_stream(
    state: &AppState,
    video_id: &str,
    quality: &str,
) -> Result<PathBuf, String> {
    let safe_id = sanitize_id(video_id);
    if safe_id.is_empty() || safe_id.starts_with("local-") {
        return Err("略過本機音檔快取".to_string());
    }

    if let Some((existing_path, _)) = get_cached_audio(state, &safe_id).await {
        return Ok(existing_path);
    }

    {
        let mut inflight = state.cache_in_flight.lock().await;
        if inflight.contains(&safe_id) {
            return Err("已在背景快取中".to_string());
        }
        inflight.insert(safe_id.clone());
    }
    let _inflight_guard = InFlightGuard {
        state: state.clone(),
        key: safe_id.clone(),
    };

    let extracted = ytdlp::extract_stream_network(state, &safe_id, quality).await?;
    let base_dir = resolve_base_data_dir(state).await;
    let cache_dir = audio_cache_dir(&base_dir);
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| format!("建立快取資料夾失敗: {e}"))?;

    let ext = extension_from_mime(&extracted.mime_type);
    let file_name = format!("{safe_id}.{ext}");
    let dest = cache_dir.join(&file_name);
    let tmp = cache_dir.join(format!("{file_name}.{}.tmp", now_ms()));

    let resp = state
        .http_client
        .get(&extracted.direct_url)
        .send()
        .await
        .map_err(|e| format!("下載串流寫入快取失敗: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("串流快取 HTTP {}", resp.status()));
    }

    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("建立快取暫存檔失敗: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut written: u64 = 0;

    while let Some(chunk_res) = stream.next().await {
        match chunk_res {
            Ok(bytes) => {
                if let Err(e) = file.write_all(&bytes).await {
                    let _ = tokio::fs::remove_file(&tmp).await;
                    return Err(format!("寫入快取分塊失敗: {e}"));
                }
                written += bytes.len() as u64;
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err(format!("串流接收中斷: {e}"));
            }
        }
    }
    let _ = file.flush().await;
    drop(file);

    if written < 1024 {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err("快取音訊不完整".to_string());
    }

    tokio::fs::rename(&tmp, &dest)
        .await
        .map_err(|e| format!("移動快取檔案失敗: {e}"))?;

    {
        let _guard = state.cache_index_lock.lock().await;
        let mut index = load_index_sync(&cache_dir);
        index.entries.insert(
            safe_id.clone(),
            CachedAudioEntry {
                video_id: safe_id.clone(),
                file_name,
                mime_type: extracted.mime_type.clone(),
                acodec: extracted.acodec.clone(),
                abr: extracted.abr.clone(),
                sample_rate: extracted.sample_rate.clone(),
                bit_depth: extracted.bit_depth.clone(),
                quality_label: extracted.quality_label.clone(),
                size_bytes: written,
                last_accessed_ms: now_ms(),
            },
        );
        let _ = save_index_sync(&cache_dir, &index);
        append_cache_log(
            &base_dir,
            &format!("Auto-Cache Saved: video_id={safe_id} file={} ({written} bytes)", dest.display()),
        );
        let _ = enforce_lru_limit_in_dir(&base_dir, DEFAULT_MAX_CACHE_BYTES);
    }

    Ok(dest)
}

pub async fn get_cache_stats(state: &AppState) -> CacheStats {
    let base_dir = resolve_base_data_dir(state).await;
    let cache_dir = audio_cache_dir(&base_dir);
    let _guard = state.cache_index_lock.lock().await;
    let _ = enforce_lru_limit_in_dir(&base_dir, DEFAULT_MAX_CACHE_BYTES);
    let index = load_index_sync(&cache_dir);
    let total_bytes: u64 = index.entries.values().map(|e| e.size_bytes).sum();
    CacheStats {
        cache_dir: cache_dir.to_string_lossy().to_string(),
        entry_count: index.entries.len(),
        total_bytes,
        max_bytes: DEFAULT_MAX_CACHE_BYTES,
    }
}

pub async fn clear_audio_cache(state: &AppState) -> Result<(), String> {
    let base_dir = resolve_base_data_dir(state).await;
    let cache_dir = audio_cache_dir(&base_dir);
    let _guard = state.cache_index_lock.lock().await;
    if cache_dir.exists() {
        for entry in std::fs::read_dir(&cache_dir).map_err(|e| e.to_string())?.flatten() {
            let p = entry.path();
            if p.is_file() {
                let _ = std::fs::remove_file(p);
            }
        }
    }
    append_cache_log(&base_dir, "Cache Cleared by user");
    Ok(())
}

// ============================================================================
// Pure-Rust Metadata Embedding: ID3v2.3 (for MP3) + MP4 iTunes ilst (for M4A)
// ============================================================================

fn encode_syncsafe_u32(val: u32) -> [u8; 4] {
    [
        ((val >> 21) & 0x7F) as u8,
        ((val >> 14) & 0x7F) as u8,
        ((val >> 7) & 0x7F) as u8,
        (val & 0x7F) as u8,
    ]
}

fn build_id3v23_text_frame(frame_id: &[u8; 4], text: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(3 + text.len() * 2);
    payload.push(0x01); // UTF-16 with BOM
    payload.extend_from_slice(&[0xFF, 0xFE]); // Little-endian BOM
    for unit in text.encode_utf16() {
        payload.extend_from_slice(&unit.to_le_bytes());
    }

    let mut frame = Vec::with_capacity(10 + payload.len());
    frame.extend_from_slice(frame_id);
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(&[0x00, 0x00]); // Flags
    frame.extend_from_slice(&payload);
    frame
}

pub fn build_id3v23_tag(
    title: &str,
    artist: &str,
    album: &str,
    cover: Option<(&[u8], &str)>,
) -> Vec<u8> {
    let mut frames = Vec::new();
    if !title.is_empty() {
        frames.extend_from_slice(&build_id3v23_text_frame(b"TIT2", title));
    }
    if !artist.is_empty() {
        frames.extend_from_slice(&build_id3v23_text_frame(b"TPE1", artist));
    }
    if !album.is_empty() {
        frames.extend_from_slice(&build_id3v23_text_frame(b"TALB", album));
    }
    if let Some((img_bytes, mime)) = cover {
        if !img_bytes.is_empty() {
            let mut apic = Vec::with_capacity(mime.len() + 4 + img_bytes.len());
            apic.push(0x00); // ISO-8859-1 MIME/description
            apic.extend_from_slice(mime.as_bytes());
            apic.push(0x00);
            apic.push(0x03); // Picture type: Cover (front)
            apic.push(0x00); // Empty description
            apic.extend_from_slice(img_bytes);

            frames.extend_from_slice(b"APIC");
            frames.extend_from_slice(&(apic.len() as u32).to_be_bytes());
            frames.extend_from_slice(&[0x00, 0x00]);
            frames.extend_from_slice(&apic);
        }
    }

    let mut out = Vec::with_capacity(10 + frames.len());
    out.extend_from_slice(b"ID3");
    out.extend_from_slice(&[0x03, 0x00, 0x00]); // ID3v2.3.0
    out.extend_from_slice(&encode_syncsafe_u32(frames.len() as u32));
    out.extend_from_slice(&frames);
    out
}

fn mp4_box(tag: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let total = 8u32.saturating_add(payload.len() as u32);
    let mut out = Vec::with_capacity(total as usize);
    out.extend_from_slice(&total.to_be_bytes());
    out.extend_from_slice(tag);
    out.extend_from_slice(payload);
    out
}

fn mp4_itunes_text_atom(tag: &[u8; 4], text: &str) -> Vec<u8> {
    let mut data_payload = Vec::with_capacity(8 + text.len());
    data_payload.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]); // UTF-8
    data_payload.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // Locale
    data_payload.extend_from_slice(text.as_bytes());
    let data_box = mp4_box(b"data", &data_payload);
    mp4_box(tag, &data_box)
}

fn mp4_itunes_cover_atom(img_bytes: &[u8], is_png: bool) -> Vec<u8> {
    let type_code: u8 = if is_png { 14 } else { 13 }; // 13 = JPEG, 14 = PNG
    let mut data_payload = Vec::with_capacity(8 + img_bytes.len());
    data_payload.extend_from_slice(&[0x00, 0x00, 0x00, type_code]);
    data_payload.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
    data_payload.extend_from_slice(img_bytes);
    let data_box = mp4_box(b"data", &data_payload);
    mp4_box(b"covr", &data_box)
}

pub fn build_mp4_udta_box(
    title: &str,
    artist: &str,
    album: &str,
    cover: Option<(&[u8], bool)>,
) -> Vec<u8> {
    let mut ilst_items = Vec::new();
    if !title.is_empty() {
        ilst_items.extend_from_slice(&mp4_itunes_text_atom(b"\xa9nam", title));
    }
    if !artist.is_empty() {
        ilst_items.extend_from_slice(&mp4_itunes_text_atom(b"\xa9ART", artist));
    }
    if !album.is_empty() {
        ilst_items.extend_from_slice(&mp4_itunes_text_atom(b"\xa9alb", album));
    }
    if let Some((img_bytes, is_png)) = cover {
        if !img_bytes.is_empty() {
            ilst_items.extend_from_slice(&mp4_itunes_cover_atom(img_bytes, is_png));
        }
    }

    let ilst_box = mp4_box(b"ilst", &ilst_items);

    // hdlr box inside meta (mdir / appl)
    let mut hdlr_payload = Vec::new();
    hdlr_payload.extend_from_slice(&[0u8; 4]); // version + flags
    hdlr_payload.extend_from_slice(&[0u8; 4]); // pre_defined
    hdlr_payload.extend_from_slice(b"mdir");
    hdlr_payload.extend_from_slice(b"appl");
    hdlr_payload.extend_from_slice(&[0u8; 9]);
    let hdlr_box = mp4_box(b"hdlr", &hdlr_payload);

    let mut meta_payload = Vec::with_capacity(4 + hdlr_box.len() + ilst_box.len());
    meta_payload.extend_from_slice(&[0u8; 4]); // FullBox version + flags
    meta_payload.extend_from_slice(&hdlr_box);
    meta_payload.extend_from_slice(&ilst_box);
    let meta_box = mp4_box(b"meta", &meta_payload);

    mp4_box(b"udta", &meta_box)
}

fn next_mp4_box(data: &[u8], offset: usize) -> Option<(usize, usize, [u8; 4], usize)> {
    if offset + 8 > data.len() {
        return None;
    }
    let size32 = u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
    let box_type = [data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]];
    let (header_len, box_len) = if size32 == 1 {
        if offset + 16 > data.len() {
            return None;
        }
        let size64 = u64::from_be_bytes([
            data[offset + 8],
            data[offset + 9],
            data[offset + 10],
            data[offset + 11],
            data[offset + 12],
            data[offset + 13],
            data[offset + 14],
            data[offset + 15],
        ]) as usize;
        (16, size64)
    } else if size32 == 0 {
        (8, data.len() - offset)
    } else {
        (8, size32 as usize)
    };
    if box_len < header_len || offset + box_len > data.len() {
        return None;
    }
    Some((offset, box_len, box_type, header_len))
}

/// Injects MP4 iTunes metadata (`udta/meta/ilst`) into `moov` while preserving `mdat` byte offsets
/// so `stco`/`co64` chunk tables remain 100% valid without needing `ffmpeg`.
pub fn embed_mp4_metadata(
    mp4_bytes: &[u8],
    title: &str,
    artist: &str,
    album: &str,
    cover: Option<(&[u8], bool)>,
) -> Result<Vec<u8>, String> {
    let mut offset = 0;
    let mut moov_span: Option<(usize, usize, usize)> = None;
    while let Some((start, len, btype, hdr_len)) = next_mp4_box(mp4_bytes, offset) {
        if &btype == b"moov" {
            moov_span = Some((start, len, hdr_len));
            break;
        }
        offset += len;
    }

    let Some((moov_start, moov_len, moov_hdr_len)) = moov_span else {
        return Err("來源音訊不是有效的 MP4/M4A 封裝".to_string());
    };

    // Rebuild moov children excluding any existing `udta`, then append our new `udta`
    let mut new_moov_children = Vec::new();
    let moov_end = moov_start + moov_len;
    let mut child_off = moov_start + moov_hdr_len;
    while let Some((c_start, c_len, c_type, _)) = next_mp4_box(&mp4_bytes[..moov_end], child_off) {
        if &c_type != b"udta" {
            new_moov_children.extend_from_slice(&mp4_bytes[c_start..c_start + c_len]);
        }
        child_off += c_len;
    }
    new_moov_children.extend_from_slice(&build_mp4_udta_box(title, artist, album, cover));
    let new_moov = mp4_box(b"moov", &new_moov_children);

    // Replace old `moov` tag with `free` so mdat chunk offsets (`stco`/`co64`) never shift!
    let mut out = mp4_bytes.to_vec();
    out[moov_start + 4..moov_start + 8].copy_from_slice(b"free");
    out.extend_from_slice(&new_moov);
    Ok(out)
}

pub async fn resolve_downloads_dir(state: &AppState) -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        return PathBuf::from(profile).join("Downloads").join("AetherMusic");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join("Downloads").join("AetherMusic");
    }
    resolve_base_data_dir(state).await.join("downloads")
}

async fn fetch_cover_bytes(state: &AppState, track: &Track) -> Option<(Vec<u8>, &'static str, bool)> {
    let mut urls = Vec::new();
    if !track.thumbnail_url.is_empty() && track.thumbnail_url.starts_with("http") {
        urls.push(track.thumbnail_url.clone());
    }
    if !track.video_id.is_empty() && !track.video_id.starts_with("local-") {
        urls.push(format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", track.video_id));
    }

    for url in urls {
        if let Ok(resp) = state.http_client.get(&url).send().await {
            if resp.status().is_success() {
                let ct = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("image/jpeg")
                    .to_string();
                if let Ok(bytes) = resp.bytes().await {
                    if !bytes.is_empty() {
                        let is_png = ct.contains("png") || bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]);
                        let mime = if is_png { "image/png" } else { "image/jpeg" };
                        return Some((bytes.to_vec(), mime, is_png));
                    }
                }
            }
        }
    }
    None
}

async fn find_ffmpeg_path() -> Option<String> {
    #[cfg(not(target_os = "android"))]
    {
        let mut cmd = tokio::process::Command::new("ffmpeg");
        cmd.arg("-version");
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        if let Ok(Ok(out)) = tokio::time::timeout(std::time::Duration::from_secs(3), cmd.output()).await {
            if out.status.success() {
                return Some("ffmpeg".to_string());
            }
        }
    }
    None
}

pub async fn download_track_offline(
    state: &AppState,
    track: Track,
    quality: Option<String>,
) -> Result<DownloadResult, String> {
    let safe_id = sanitize_id(&track.video_id);
    if safe_id.is_empty() || track.video_id.starts_with("local-") {
        return Err("此為本機音檔，不需從雲端下載".to_string());
    }

    let q = quality.as_deref().unwrap_or("high");
    let cover_opt = fetch_cover_bytes(state, &track).await;
    let downloads_dir = resolve_downloads_dir(state).await;
    tokio::fs::create_dir_all(&downloads_dir)
        .await
        .map_err(|e| format!("無法建立下載資料夾: {e}"))?;

    let base_name = sanitize_filename(&format!("{} - {}", track.artist, track.title));
    let album_name = if track.album.trim().is_empty() {
        "AetherMusic Offline"
    } else {
        track.album.as_str()
    };

    // Prefer ffmpeg -> 320kbps MP3 with ID3v2.3 + cover art when available
    if let Some(ffmpeg) = find_ffmpeg_path().await {
        let cached_path = match get_cached_audio(state, &safe_id).await {
            Some((p, _)) => p,
            None => cache_audio_stream(state, &safe_id, q).await?,
        };
        let out_mp3 = downloads_dir.join(format!("{base_name}.mp3"));
        let cover_tmp = cover_opt.as_ref().map(|(bytes, _, is_png)| {
            let ext = if *is_png { "png" } else { "jpg" };
            let p = std::env::temp_dir().join(format!("aethermusic_cover_{safe_id}.{ext}"));
            let _ = std::fs::write(&p, bytes);
            p
        });

        let mut cmd = tokio::process::Command::new(ffmpeg);
        cmd.arg("-y").arg("-i").arg(&cached_path);
        if let Some(ref cp) = cover_tmp {
            cmd.args(["-i"]).arg(cp).args([
                "-map", "0:a", "-map", "1:v", "-c:v", "mjpeg", "-disposition:v", "attached_pic",
            ]);
        } else {
            cmd.args(["-map", "0:a"]);
        }
        cmd.args([
            "-c:a",
            "libmp3lame",
            "-b:a",
            "320k",
            "-id3v2_version",
            "3",
            "-metadata",
            &format!("title={}", track.title),
            "-metadata",
            &format!("artist={}", track.artist),
            "-metadata",
            &format!("album={album_name}"),
        ])
        .arg(&out_mp3);
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        if let Ok(output) = cmd.output().await {
            if let Some(ref cp) = cover_tmp {
                let _ = std::fs::remove_file(cp);
            }
            if output.status.success() {
                let size_bytes = std::fs::metadata(&out_mp3).map(|m| m.len()).unwrap_or(0);
                return Ok(DownloadResult {
                    file_path: out_mp3.to_string_lossy().to_string(),
                    size_bytes,
                    format: "mp3 (ID3v2.3)".to_string(),
                    has_cover_art: cover_opt.is_some(),
                    has_metadata_tags: true,
                });
            }
        }
        if let Some(ref cp) = cover_tmp {
            let _ = std::fs::remove_file(cp);
        }
    }

    // Pure-Rust path: obtain M4A (or native MP3) bytes and embed cover art + metadata tags
    let mut raw_bytes: Option<Vec<u8>> = None;
    let mut is_mp4 = false;

    if let Some((cached_path, entry)) = get_cached_audio(state, &safe_id).await {
        if entry.mime_type.contains("mp4") || cached_path.extension().and_then(|e| e.to_str()) == Some("m4a") {
            if let Ok(bytes) = tokio::fs::read(&cached_path).await {
                raw_bytes = Some(bytes);
                is_mp4 = true;
            }
        }
    }

    if raw_bytes.is_none() {
        let extracted = ytdlp::extract_stream_network(state, &safe_id, "high").await?;
        let resp = state
            .http_client
            .get(&extracted.direct_url)
            .send()
            .await
            .map_err(|e| format!("下載離線音訊失敗: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("下載離線音訊 HTTP {}", resp.status()));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("讀取離線音訊失敗: {e}"))?
            .to_vec();
        is_mp4 = extracted.mime_type.contains("mp4") || bytes.get(4..8) == Some(b"ftyp");
        if is_mp4 {
            let base_dir = resolve_base_data_dir(state).await;
            let _guard = state.cache_index_lock.lock().await;
            let _ = register_cached_bytes_in_dir(
                &base_dir,
                &safe_id,
                &extracted,
                &bytes,
                DEFAULT_MAX_CACHE_BYTES,
            );
        }
        raw_bytes = Some(bytes);
    }

    let bytes = raw_bytes.ok_or_else(|| "無法取得離線音訊內容".to_string())?;
    if is_mp4 || bytes.get(4..8) == Some(b"ftyp") {
        let tagged = embed_mp4_metadata(
            &bytes,
            &track.title,
            &track.artist,
            album_name,
            cover_opt.as_ref().map(|(b, _, is_png)| (b.as_slice(), *is_png)),
        )
        .unwrap_or(bytes);
        let out_m4a = downloads_dir.join(format!("{base_name}.m4a"));
        let tmp_m4a = downloads_dir.join(format!("{base_name}.m4a.tmp"));
        tokio::fs::write(&tmp_m4a, &tagged)
            .await
            .map_err(|e| format!("寫入離線檔案失敗: {e}"))?;
        tokio::fs::rename(&tmp_m4a, &out_m4a)
            .await
            .map_err(|e| format!("儲存離線檔案失敗: {e}"))?;
        Ok(DownloadResult {
            file_path: out_m4a.to_string_lossy().to_string(),
            size_bytes: tagged.len() as u64,
            format: "m4a (MP4 Metadata + Cover)".to_string(),
            has_cover_art: cover_opt.is_some(),
            has_metadata_tags: true,
        })
    } else {
        // Fallback: attach ID3v2.3 tags to MP3 stream
        let tag = build_id3v23_tag(
            &track.title,
            &track.artist,
            album_name,
            cover_opt.as_ref().map(|(b, mime, _)| (b.as_slice(), *mime)),
        );
        let mut combined = Vec::with_capacity(tag.len() + bytes.len());
        combined.extend_from_slice(&tag);
        combined.extend_from_slice(&bytes);
        let out_mp3 = downloads_dir.join(format!("{base_name}.mp3"));
        let tmp_mp3 = downloads_dir.join(format!("{base_name}.mp3.tmp"));
        tokio::fs::write(&tmp_mp3, &combined)
            .await
            .map_err(|e| format!("寫入離線 MP3 失敗: {e}"))?;
        tokio::fs::rename(&tmp_mp3, &out_mp3)
            .await
            .map_err(|e| format!("儲存離線 MP3 失敗: {e}"))?;
        Ok(DownloadResult {
            file_path: out_mp3.to_string_lossy().to_string(),
            size_bytes: combined.len() as u64,
            format: "mp3 (ID3v2.3)".to_string(),
            has_cover_art: cover_opt.is_some(),
            has_metadata_tags: true,
        })
    }
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn decode_id3_text_payload(payload: &[u8]) -> Option<String> {
    if payload.is_empty() {
        return None;
    }
    let encoding = payload[0];
    let raw = &payload[1..];
    let text = match encoding {
        0 => raw.iter().map(|&b| b as char).collect::<String>(),
        1 | 2 => {
            let is_le = encoding == 1 && raw.starts_with(&[0xFF, 0xFE]);
            let data = if encoding == 1 && (raw.starts_with(&[0xFF, 0xFE]) || raw.starts_with(&[0xFE, 0xFF])) {
                &raw[2..]
            } else {
                raw
            };
            let u16s: Vec<u16> = data
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| {
                    if is_le {
                        u16::from_le_bytes([c[0], c[1]])
                    } else {
                        u16::from_be_bytes([c[0], c[1]])
                    }
                })
                .collect();
            String::from_utf16_lossy(&u16s)
        }
        3 => String::from_utf8_lossy(raw).to_string(),
        _ => String::from_utf8_lossy(raw).to_string(),
    };
    let cleaned = text.trim_matches('\0').trim().to_string();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn parse_id3v2_metadata(bytes: &[u8]) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let mut title = None;
    let mut artist = None;
    let mut album = None;
    let mut cover = None;

    if bytes.len() < 10 || &bytes[0..3] != b"ID3" {
        return (title, artist, album, cover);
    }
    let version = bytes[3];
    let tag_size = (((bytes[6] & 0x7F) as usize) << 21)
        | (((bytes[7] & 0x7F) as usize) << 14)
        | (((bytes[8] & 0x7F) as usize) << 7)
        | ((bytes[9] & 0x7F) as usize);
    let end = (10 + tag_size).min(bytes.len());
    let mut off = 10usize;
    if version < 3 {
        return (title, artist, album, cover);
    }

    while off + 10 <= end {
        let frame_id = &bytes[off..off + 4];
        if frame_id == [0, 0, 0, 0] {
            break;
        }
        let frame_size = if version == 4 {
            (((bytes[off + 4] & 0x7F) as usize) << 21)
                | (((bytes[off + 5] & 0x7F) as usize) << 14)
                | (((bytes[off + 6] & 0x7F) as usize) << 7)
                | ((bytes[off + 7] & 0x7F) as usize)
        } else {
            u32::from_be_bytes([bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]]) as usize
        };
        if frame_size == 0 || off + 10 + frame_size > end {
            break;
        }
        let payload = &bytes[off + 10..off + 10 + frame_size];
        match frame_id {
            b"TIT2" => title = title.or_else(|| decode_id3_text_payload(payload)),
            b"TPE1" => artist = artist.or_else(|| decode_id3_text_payload(payload)),
            b"TALB" => album = album.or_else(|| decode_id3_text_payload(payload)),
            b"APIC" if cover.is_none() && payload.len() > 4 => {
                let enc = payload[0];
                if let Some(mime_end) = payload[1..].iter().position(|&b| b == 0) {
                    let mime_raw = String::from_utf8_lossy(&payload[1..1 + mime_end]).to_string();
                    let after_mime = 1 + mime_end + 1;
                    if after_mime + 1 < payload.len() {
                        // skip picture_type (1 byte) + description (null-terminated)
                        let desc_start = after_mime + 1;
                        let img_start = if enc == 1 || enc == 2 {
                            let mut pos = desc_start;
                            while pos + 1 < payload.len() {
                                if payload[pos] == 0 && payload[pos + 1] == 0 {
                                    pos += 2;
                                    break;
                                }
                                pos += 2;
                            }
                            pos
                        } else if let Some(d_end) = payload[desc_start..].iter().position(|&b| b == 0) {
                            desc_start + d_end + 1
                        } else {
                            payload.len()
                        };
                        if img_start + 8 < payload.len() && payload.len() - img_start <= 2_000_000 {
                            let img_bytes = &payload[img_start..];
                            let mime = if mime_raw.contains("png") || img_bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                                "image/png"
                            } else {
                                "image/jpeg"
                            };
                            cover = Some(format!("data:{mime};base64,{}", encode_base64(img_bytes)));
                        }
                    }
                }
            }
            _ => {}
        }
        off += 10 + frame_size;
    }

    (title, artist, album, cover)
}

fn parse_flac_metadata(bytes: &[u8]) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let mut title = None;
    let mut artist = None;
    let mut album = None;
    let mut cover = None;

    if bytes.len() < 8 || &bytes[0..4] != b"fLaC" {
        return (title, artist, album, cover);
    }

    let mut off = 4usize;
    while off + 4 <= bytes.len() {
        let header = bytes[off];
        let is_last = (header & 0x80) != 0;
        let block_type = header & 0x7F;
        let block_len =
            ((bytes[off + 1] as usize) << 16) | ((bytes[off + 2] as usize) << 8) | (bytes[off + 3] as usize);
        off += 4;
        if off + block_len > bytes.len() {
            break;
        }
        let block = &bytes[off..off + block_len];

        if block_type == 4 && block.len() >= 8 {
            let vendor_len = u32::from_le_bytes([block[0], block[1], block[2], block[3]]) as usize;
            let mut pos = 4 + vendor_len;
            if pos + 4 <= block.len() {
                let count = u32::from_le_bytes([block[pos], block[pos + 1], block[pos + 2], block[pos + 3]]) as usize;
                pos += 4;
                for _ in 0..count.min(128) {
                    if pos + 4 > block.len() {
                        break;
                    }
                    let c_len = u32::from_le_bytes([block[pos], block[pos + 1], block[pos + 2], block[pos + 3]]) as usize;
                    pos += 4;
                    if pos + c_len > block.len() {
                        break;
                    }
                    let comment = String::from_utf8_lossy(&block[pos..pos + c_len]);
                    if let Some((k, v)) = comment.split_once('=') {
                        let key = k.trim().to_ascii_uppercase();
                        let val = v.trim().to_string();
                        if !val.is_empty() {
                            match key.as_str() {
                                "TITLE" => title = title.or(Some(val)),
                                "ARTIST" | "ALBUMARTIST" => artist = artist.or(Some(val)),
                                "ALBUM" => album = album.or(Some(val)),
                                _ => {}
                            }
                        }
                    }
                    pos += c_len;
                }
            }
        } else if block_type == 6 && cover.is_none() && block.len() >= 32 {
            let mut pos = 4usize;
            if pos + 4 <= block.len() {
                let mime_len = u32::from_be_bytes([block[pos], block[pos + 1], block[pos + 2], block[pos + 3]]) as usize;
                pos += 4;
                if pos + mime_len + 4 <= block.len() {
                    let mime_str = String::from_utf8_lossy(&block[pos..pos + mime_len]).to_string();
                    pos += mime_len;
                    let desc_len = u32::from_be_bytes([block[pos], block[pos + 1], block[pos + 2], block[pos + 3]]) as usize;
                    pos += 4 + desc_len + 16;
                    if pos + 4 <= block.len() {
                        let pic_len = u32::from_be_bytes([block[pos], block[pos + 1], block[pos + 2], block[pos + 3]]) as usize;
                        pos += 4;
                        if pic_len > 8 && pic_len <= 2_000_000 && pos + pic_len <= block.len() {
                            let mime = if mime_str.contains("png") { "image/png" } else { "image/jpeg" };
                            cover = Some(format!("data:{mime};base64,{}", encode_base64(&block[pos..pos + pic_len])));
                        }
                    }
                }
            }
        }

        off += block_len;
        if is_last {
            break;
        }
    }

    (title, artist, album, cover)
}

fn find_mp4_atom_text(haystack: &[u8], atom: &[u8; 4]) -> Option<String> {
    let pos = haystack.windows(4).position(|w| w == atom)?;
    if pos + 16 > haystack.len() {
        return None;
    }
    let data_pos = haystack[pos..].windows(4).position(|w| w == b"data")?;
    let abs = pos + data_pos;
    if abs < 4 || abs + 12 > haystack.len() {
        return None;
    }
    let data_box_len = u32::from_be_bytes([
        haystack[abs - 4],
        haystack[abs - 3],
        haystack[abs - 2],
        haystack[abs - 1],
    ]) as usize;
    if data_box_len <= 16 || abs - 4 + data_box_len > haystack.len() {
        return None;
    }
    let text_bytes = &haystack[abs + 12..abs - 4 + data_box_len];
    let text = String::from_utf8_lossy(text_bytes).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

pub fn parse_local_audio_metadata(path: &Path) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    use std::io::{Read, Seek};
    let Ok(mut file) = std::fs::File::open(path) else {
        return (None, None, None, None);
    };
    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let head_len = (file_len as usize).min(524_288);
    let mut buf = vec![0u8; head_len];
    if file.read_exact(&mut buf).is_err() {
        return (None, None, None, None);
    }

    if buf.starts_with(b"ID3") {
        return parse_id3v2_metadata(&buf);
    }
    if buf.starts_with(b"fLaC") {
        return parse_flac_metadata(&buf);
    }

    // MP4 / M4A / ALAC: search head and tail (since udta/moov may sit at the end)
    if buf.get(4..8) == Some(b"ftyp") {
        let mut title = find_mp4_atom_text(&buf, b"\xa9nam");
        let mut artist = find_mp4_atom_text(&buf, b"\xa9ART");
        let mut album = find_mp4_atom_text(&buf, b"\xa9alb");
        if (title.is_none() || artist.is_none()) && file_len > head_len as u64 {
            let tail_len = (file_len as usize).min(262_144);
            if file.seek(std::io::SeekFrom::End(-(tail_len as i64))).is_ok() {
                let mut tail = vec![0u8; tail_len];
                if file.read_exact(&mut tail).is_ok() {
                    title = title.or_else(|| find_mp4_atom_text(&tail, b"\xa9nam"));
                    artist = artist.or_else(|| find_mp4_atom_text(&tail, b"\xa9ART"));
                    album = album.or_else(|| find_mp4_atom_text(&tail, b"\xa9alb"));
                }
            }
        }
        return (title, artist, album, None);
    }

    (None, None, None, None)
}

fn collect_audio_files_recursive(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 3 || out.len() >= 500 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= 500 {
            break;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_audio_files_recursive(&path, depth + 1, out);
        } else if path.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(
                ext.as_str(),
                "flac" | "wav" | "mp3" | "ogg" | "m4a" | "alac" | "aiff" | "opus"
            ) {
                out.push(path);
            }
        }
    }
}

fn fnv1a_64(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub async fn scan_local_music_dir(
    state: &AppState,
    folder_path: Option<String>,
    _proxy_port: u16,
) -> Result<(String, Vec<Track>), String> {
    let root_dir = if let Some(custom) = folder_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        PathBuf::from(custom)
    } else {
        let mut candidate = None;
        #[cfg(target_os = "windows")]
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let music = PathBuf::from(profile).join("Music");
            if music.exists() {
                candidate = Some(music);
            }
        }
        if candidate.is_none() {
            if let Some(home) = std::env::var_os("HOME") {
                let music = PathBuf::from(home).join("Music");
                if music.exists() {
                    candidate = Some(music);
                }
            }
        }
        match candidate {
            Some(c) => c,
            None => resolve_downloads_dir(state).await,
        }
    };

    if !root_dir.exists() || !root_dir.is_dir() {
        return Err(format!("指定的音樂資料夾不存在：{}", root_dir.display()));
    }

    let root_clone = root_dir.clone();
    let tracks = tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        collect_audio_files_recursive(&root_clone, 0, &mut files);
        files.sort();
        files
            .into_iter()
            .map(|p| {
                let full_str = p.to_string_lossy().to_string();
                let (title_opt, artist_opt, album_opt, cover_opt) = parse_local_audio_metadata(&p);
                let stem = p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown Track")
                    .to_string();
                let ext = p
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("LOCAL")
                    .to_ascii_uppercase();
                let parent_name = p
                    .parent()
                    .and_then(|d| d.file_name())
                    .and_then(|s| s.to_str())
                    .unwrap_or("本機無損音檔")
                    .to_string();
                Track {
                    video_id: format!("local-{:016x}", fnv1a_64(&full_str)),
                    title: title_opt.unwrap_or(stem),
                    artist: artist_opt.unwrap_or(parent_name),
                    album: album_opt.unwrap_or(ext),
                    duration_text: "Local".to_string(),
                    duration_seconds: 0,
                    thumbnail_url: cover_opt.unwrap_or_default(),
                    is_auto_recommended: false,
                    local_file_path: Some(full_str),
                }
            })
            .collect::<Vec<Track>>()
    })
    .await
    .map_err(|e| format!("掃描本機資料夾失敗: {e}"))?;

    let resolved_path = root_dir.to_string_lossy().to_string();
    let base_dir = resolve_base_data_dir(state).await;
    let _guard = state.store_lock.lock().await;
    let mut store = crate::storage::load_store_in_dir(&base_dir);
    store.local_folder_path = Some(resolved_path.clone());
    store.local_tracks = tracks.clone();
    let _ = crate::storage::save_store_in_dir(&base_dir, &store);

    Ok((resolved_path, tracks))
}

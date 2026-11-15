use crate::models::{AppState, HomeSection, LyricLine, LyricsResponse, SongMetadata, Track};
use crate::ytdlp;
use serde_json::{json, Value};

const YTM_BASE: &str = "https://music.youtube.com/youtubei/v1";

fn ytm_context() -> Value {
    json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240501.01.00",
                "hl": "zh-TW",
                "gl": "TW"
            }
        }
    })
}

async fn post_ytm(state: &AppState, endpoint: &str, body: Value) -> Result<Value, String> {
    let url = format!("{YTM_BASE}/{endpoint}?prettyPrint=false");
    let resp = state
        .http_client
        .post(&url)
        .header("Origin", "https://music.youtube.com")
        .header("Referer", "https://music.youtube.com/")
        .header("X-YouTube-Client-Name", "67")
        .header("X-YouTube-Client-Version", "1.20240501.01.00")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("YTMAPI request failed ({endpoint}): {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("YTMAPI {endpoint} HTTP {}", resp.status()));
    }

    resp.json::<Value>()
        .await
        .map_err(|e| format!("YTMAPI {endpoint} JSON parse error: {e}"))
}

pub fn upgrade_thumbnail_url(url: &str) -> String {
    if url.contains("googleusercontent.com") {
        if let Some(eq_idx) = url.rfind('=') {
            let base = &url[..eq_idx];
            return format!("{base}=w544-h544-l90-rj");
        }
    }
    url.to_string()
}

fn pick_best_thumbnail(val: Option<&Value>) -> String {
    let Some(arr) = val
        .and_then(|v| v.get("thumbnails"))
        .and_then(|v| v.as_array())
    else {
        return String::new();
    };
    arr.last()
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .map(upgrade_thumbnail_url)
        .unwrap_or_default()
}

pub fn parse_duration_seconds(text: &str) -> Option<u64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let parts: Vec<&str> = trimmed.split(':').collect();
    if parts.len() == 2 {
        let m = parts[0].trim().parse::<u64>().ok()?;
        let s = parts[1].trim().parse::<u64>().ok()?;
        if s < 60 {
            return Some(m * 60 + s);
        }
    } else if parts.len() == 3 {
        let h = parts[0].trim().parse::<u64>().ok()?;
        let m = parts[1].trim().parse::<u64>().ok()?;
        let s = parts[2].trim().parse::<u64>().ok()?;
        if m < 60 && s < 60 {
            return Some(h * 3600 + m * 60 + s);
        }
    }
    None
}

fn format_duration(secs: u64) -> String {
    if secs == 0 {
        return "0:00".to_string();
    }
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

fn collect_runs_text(runs: Option<&Value>) -> String {
    let Some(arr) = runs.and_then(|v| v.as_array()) else {
        return String::new();
    };
    arr.iter()
        .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("")
}

fn split_byline_runs(runs: Option<&Value>) -> (String, String, String, u64) {
    let Some(arr) = runs.and_then(|v| v.as_array()) else {
        return ("未知藝人".to_string(), String::new(), "0:00".to_string(), 0);
    };

    let mut segments: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut explicit_album: Option<String> = None;

    for r in arr {
        let txt = r.get("text").and_then(|t| t.as_str()).unwrap_or("");
        if txt.trim() == "•" {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                segments.push(trimmed);
            }
            current.clear();
            continue;
        }
        if let Some(bid) = r
            .pointer("/navigationEndpoint/browseEndpoint/browseId")
            .and_then(|b| b.as_str())
        {
            if bid.starts_with("MPREb") && !txt.trim().is_empty() {
                explicit_album = Some(txt.trim().to_string());
            }
        }
        current.push_str(txt);
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        segments.push(trimmed);
    }

    let type_tags = [
        "歌曲", "Song", "影片", "Video", "單曲", "Single", "EP", "專輯", "Album",
    ];
    if segments.len() >= 2 && type_tags.contains(&segments[0].as_str()) {
        segments.remove(0);
    }

    let mut duration_text = "0:00".to_string();
    let mut duration_seconds = 0u64;
    if let Some(last) = segments.last() {
        if let Some(secs) = parse_duration_seconds(last) {
            duration_seconds = secs;
            duration_text = last.clone();
            segments.pop();
        }
    }

    let artist = segments
        .first()
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "未知藝人".to_string());

    let album = explicit_album.unwrap_or_else(|| {
        if segments.len() >= 2 {
            let candidate = &segments[1];
            if !candidate.contains("觀看") && !candidate.contains("views") && !candidate.contains("次播放")
            {
                candidate.clone()
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    });

    (artist, album, duration_text, duration_seconds)
}

fn parse_responsive_list_item(item: &Value, is_auto: bool) -> Option<Track> {
    let m = item.get("musicResponsiveListItemRenderer")?;
    let cols = m.get("flexColumns").and_then(|c| c.as_array())?;

    let video_id = m
        .pointer("/playlistItemData/videoId")
        .and_then(|v| v.as_str())
        .or_else(|| {
            m.pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId")
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            cols.first()
                .and_then(|c| c.pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs/0/navigationEndpoint/watchEndpoint/videoId"))
                .and_then(|v| v.as_str())
        })?
        .to_string();

    if video_id.is_empty() {
        return None;
    }

    let title = cols
        .first()
        .map(|c| collect_runs_text(c.pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs")))
        .unwrap_or_default()
        .trim()
        .to_string();
    if title.is_empty() {
        return None;
    }

    let (artist, album, mut duration_text, mut duration_seconds) = cols
        .get(1)
        .map(|c| split_byline_runs(c.pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs")))
        .unwrap_or_else(|| ("未知藝人".to_string(), String::new(), "0:00".to_string(), 0));

    if duration_seconds == 0 {
        if let Some(fixed) = m.get("fixedColumns").and_then(|f| f.as_array()).and_then(|a| a.first()) {
            let fixed_dur = collect_runs_text(
                fixed.pointer("/musicResponsiveListItemFixedColumnRenderer/text/runs"),
            );
            if let Some(secs) = parse_duration_seconds(&fixed_dur) {
                duration_seconds = secs;
                duration_text = fixed_dur;
            }
        }
    }

    let thumbnail_url = pick_best_thumbnail(m.pointer("/thumbnail/musicThumbnailRenderer/thumbnail"));

    Some(Track {
        video_id,
        title,
        artist,
        album,
        duration_text,
        duration_seconds,
        thumbnail_url,
        is_auto_recommended: is_auto,
    })
}

fn parse_two_row_item(item: &Value, is_auto: bool) -> Option<Track> {
    let m = item.get("musicTwoRowItemRenderer")?;
    let video_id = m
        .pointer("/navigationEndpoint/watchEndpoint/videoId")
        .and_then(|v| v.as_str())
        .or_else(|| {
            m.pointer("/thumbnailOverlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId")
                .and_then(|v| v.as_str())
        })?
        .to_string();

    let title = collect_runs_text(m.pointer("/title/runs")).trim().to_string();
    if title.is_empty() {
        return None;
    }
    let (artist, album, duration_text, duration_seconds) =
        split_byline_runs(m.pointer("/subtitle/runs"));
    let thumbnail_url =
        pick_best_thumbnail(m.pointer("/thumbnailRenderer/musicThumbnailRenderer/thumbnail"));

    Some(Track {
        video_id,
        title,
        artist,
        album,
        duration_text,
        duration_seconds,
        thumbnail_url,
        is_auto_recommended: is_auto,
    })
}

fn parse_playlist_panel_video(item: &Value, is_auto: bool) -> Option<Track> {
    let v = item.get("playlistPanelVideoRenderer")?;
    let video_id = v.get("videoId").and_then(|s| s.as_str())?.to_string();
    let title = collect_runs_text(v.pointer("/title/runs")).trim().to_string();
    if title.is_empty() {
        return None;
    }

    let (artist, album, _, _) = split_byline_runs(v.pointer("/longBylineText/runs"));
    let duration_text = collect_runs_text(v.pointer("/lengthText/runs"))
        .trim()
        .to_string();
    let duration_seconds = parse_duration_seconds(&duration_text).unwrap_or(0);
    let thumbnail_url = pick_best_thumbnail(v.get("thumbnail"));

    Some(Track {
        video_id,
        title,
        artist,
        album,
        duration_text: if duration_text.is_empty() {
            format_duration(duration_seconds)
        } else {
            duration_text
        },
        duration_seconds,
        thumbnail_url,
        is_auto_recommended: is_auto,
    })
}

pub async fn search_tracks(
    state: &AppState,
    query: &str,
    filter: Option<&str>,
) -> Result<Vec<Track>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let mut body = ytm_context();
    body["query"] = json!(trimmed);

    match filter.unwrap_or("songs") {
        "songs" => {
            body["params"] = json!("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D");
        }
        "videos" => {
            body["params"] = json!("EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D");
        }
        _ => {}
    }

    let data = post_ytm(state, "search", body).await?;
    let mut results = Vec::new();

    if let Some(tabs) = data
        .pointer("/contents/tabbedSearchResultsRenderer/tabs")
        .and_then(|v| v.as_array())
    {
        for tab in tabs {
            let Some(sections) = tab
                .pointer("/tabRenderer/content/sectionListRenderer/contents")
                .and_then(|v| v.as_array())
            else {
                continue;
            };
            for sec in sections {
                if let Some(shelf_items) = sec
                    .pointer("/musicShelfRenderer/contents")
                    .and_then(|v| v.as_array())
                {
                    for item in shelf_items {
                        if let Some(track) = parse_responsive_list_item(item, false) {
                            results.push(track);
                        }
                    }
                }
                if let Some(card_item) = sec.pointer("/musicCardShelfRenderer") {
                    if let Some(vid) = card_item
                        .pointer("/onTap/watchEndpoint/videoId")
                        .and_then(|v| v.as_str())
                    {
                        let title = collect_runs_text(card_item.pointer("/title/runs"));
                        let (artist, album, dur_t, dur_s) =
                            split_byline_runs(card_item.pointer("/subtitle/runs"));
                        let thumb = pick_best_thumbnail(
                            card_item.pointer("/thumbnail/musicThumbnailRenderer/thumbnail"),
                        );
                        if !title.is_empty() {
                            results.push(Track {
                                video_id: vid.to_string(),
                                title,
                                artist,
                                album,
                                duration_text: dur_t,
                                duration_seconds: dur_s,
                                thumbnail_url: thumb,
                                is_auto_recommended: false,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

pub async fn get_song_metadata(state: &AppState, video_id: &str) -> Result<SongMetadata, String> {
    let mut next_body = ytm_context();
    next_body["videoId"] = json!(video_id);
    next_body["enablePersistentPlaylistPanel"] = json!(true);
    next_body["isAudioOnly"] = json!(true);

    let mut player_body = ytm_context();
    player_body["videoId"] = json!(video_id);

    let (next_res, player_res) = tokio::join!(
        post_ytm(state, "next", next_body),
        post_ytm(state, "player", player_body)
    );

    let next_data = next_res.unwrap_or(Value::Null);
    let player_data = player_res.unwrap_or(Value::Null);

    let vd = player_data.get("videoDetails").unwrap_or(&Value::Null);
    let mut title = vd
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut artist = vd
        .get("author")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut duration_seconds = vd
        .get("lengthSeconds")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let mut duration_text = format_duration(duration_seconds);
    let mut thumbnail_url = pick_best_thumbnail(vd.get("thumbnail"));
    let view_count_raw = vd
        .get("viewCount")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let view_count_text = if view_count_raw >= 100_000_000 {
        format!("{:.2} 億次播放", view_count_raw as f64 / 100_000_000.0)
    } else if view_count_raw >= 10_000 {
        format!("{:.1} 萬次播放", view_count_raw as f64 / 10_000.0)
    } else if view_count_raw > 0 {
        format!("{view_count_raw} 次播放")
    } else {
        String::new()
    };

    let mut album = String::new();
    let mut lyrics_browse_id: Option<String> = None;
    let mut related_browse_id: Option<String> = None;
    let mut radio_playlist_id: Option<String> = Some(format!("RDAMVM{video_id}"));

    if let Some(tabs) = next_data
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs")
        .and_then(|v| v.as_array())
    {
        for (idx, tab) in tabs.iter().enumerate() {
            let Some(tr) = tab.get("tabRenderer") else {
                continue;
            };
            if let Some(bid) = tr
                .pointer("/endpoint/browseEndpoint/browseId")
                .and_then(|v| v.as_str())
            {
                if bid.starts_with("MPLYt_") || idx == 1 {
                    lyrics_browse_id = Some(bid.to_string());
                } else if bid.starts_with("MPTRt_") || idx == 3 {
                    related_browse_id = Some(bid.to_string());
                }
            }
            if let Some(queue_items) = tr
                .pointer("/content/musicQueueRenderer/content/playlistPanelRenderer/contents")
                .and_then(|v| v.as_array())
            {
                for item in queue_items {
                    if let Some(parsed) = parse_playlist_panel_video(item, false) {
                        if parsed.video_id == video_id {
                            if title.is_empty() {
                                title = parsed.title;
                            }
                            if artist.is_empty() {
                                artist = parsed.artist;
                            }
                            if album.is_empty() {
                                album = parsed.album;
                            }
                            if duration_seconds == 0 && parsed.duration_seconds > 0 {
                                duration_seconds = parsed.duration_seconds;
                                duration_text = parsed.duration_text;
                            }
                            if thumbnail_url.is_empty() {
                                thumbnail_url = parsed.thumbnail_url;
                            }
                        }
                    }
                    if let Some(pid) = item
                        .pointer("/automixPreviewVideoRenderer/content/automixPlaylistVideoRenderer/navigationEndpoint/watchPlaylistEndpoint/playlistId")
                        .and_then(|v| v.as_str())
                    {
                        radio_playlist_id = Some(pid.to_string());
                    }
                }
            }
        }
    }

    let mut related_tracks = Vec::new();
    if let Some(rel_id) = related_browse_id.as_deref() {
        if let Ok(rel_tracks) = fetch_related_browse_tracks(state, rel_id).await {
            related_tracks = rel_tracks;
        }
    }
    if related_tracks.is_empty() {
        if let Ok(radio_tracks) = get_radio_recommendations(state, video_id).await {
            related_tracks = radio_tracks.into_iter().take(12).collect();
        }
    }

    Ok(SongMetadata {
        video_id: video_id.to_string(),
        title: if title.is_empty() {
            video_id.to_string()
        } else {
            title
        },
        artist: if artist.is_empty() {
            "未知藝人".to_string()
        } else {
            artist
        },
        album,
        duration_text,
        duration_seconds,
        thumbnail_url,
        view_count_text,
        lyrics_browse_id,
        related_browse_id,
        radio_playlist_id,
        related_tracks,
    })
}

async fn fetch_related_browse_tracks(
    state: &AppState,
    browse_id: &str,
) -> Result<Vec<Track>, String> {
    let mut body = ytm_context();
    body["browseId"] = json!(browse_id);
    let data = post_ytm(state, "browse", body).await?;
    let mut tracks = Vec::new();

    if let Some(sections) = data
        .pointer("/contents/sectionListRenderer/contents")
        .and_then(|v| v.as_array())
    {
        for sec in sections {
            if let Some(items) = sec
                .pointer("/musicCarouselShelfRenderer/contents")
                .and_then(|v| v.as_array())
            {
                for item in items {
                    if let Some(t) = parse_responsive_list_item(item, true)
                        .or_else(|| parse_two_row_item(item, true))
                    {
                        tracks.push(t);
                    }
                }
                if !tracks.is_empty() {
                    break;
                }
            }
        }
    }

    Ok(tracks)
}

pub async fn get_radio_recommendations(
    state: &AppState,
    video_id: &str,
) -> Result<Vec<Track>, String> {
    let mut body = ytm_context();
    body["videoId"] = json!(video_id);
    body["playlistId"] = json!(format!("RDAMVM{video_id}"));
    body["isAudioOnly"] = json!(true);

    let data = post_ytm(state, "next", body).await?;
    let mut tracks = extract_playlist_panel_tracks(&data, video_id);

    if tracks.is_empty() {
        // Fallback: query next without playlistId to discover custom automix playlistId
        let mut probe_body = ytm_context();
        probe_body["videoId"] = json!(video_id);
        probe_body["enablePersistentPlaylistPanel"] = json!(true);
        probe_body["isAudioOnly"] = json!(true);
        if let Ok(probe_data) = post_ytm(state, "next", probe_body).await {
            if let Some(tabs) = probe_data
                .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs")
                .and_then(|v| v.as_array())
            {
                let mut found_pid = None;
                let mut found_rel = None;
                for tab in tabs {
                    if let Some(bid) = tab
                        .pointer("/tabRenderer/endpoint/browseEndpoint/browseId")
                        .and_then(|v| v.as_str())
                    {
                        if bid.starts_with("MPTRt_") {
                            found_rel = Some(bid.to_string());
                        }
                    }
                    if let Some(contents) = tab
                        .pointer("/tabRenderer/content/musicQueueRenderer/content/playlistPanelRenderer/contents")
                        .and_then(|v| v.as_array())
                    {
                        for item in contents {
                            if let Some(pid) = item
                                .pointer("/automixPreviewVideoRenderer/content/automixPlaylistVideoRenderer/navigationEndpoint/watchPlaylistEndpoint/playlistId")
                                .and_then(|v| v.as_str())
                            {
                                found_pid = Some(pid.to_string());
                            }
                        }
                    }
                }
                if let Some(pid) = found_pid {
                    let mut retry_body = ytm_context();
                    retry_body["videoId"] = json!(video_id);
                    retry_body["playlistId"] = json!(pid);
                    retry_body["isAudioOnly"] = json!(true);
                    if let Ok(retry_data) = post_ytm(state, "next", retry_body).await {
                        tracks = extract_playlist_panel_tracks(&retry_data, video_id);
                    }
                }
                if tracks.is_empty() {
                    if let Some(rel_id) = found_rel {
                        if let Ok(rel_tracks) = fetch_related_browse_tracks(state, &rel_id).await {
                            tracks = rel_tracks;
                        }
                    }
                }
            }
        }
    }

    Ok(tracks)
}

fn extract_playlist_panel_tracks(data: &Value, seed_video_id: &str) -> Vec<Track> {
    let mut tracks = Vec::new();
    let Some(tabs) = data
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs")
        .and_then(|v| v.as_array())
    else {
        return tracks;
    };

    for tab in tabs {
        if let Some(contents) = tab
            .pointer("/tabRenderer/content/musicQueueRenderer/content/playlistPanelRenderer/contents")
            .and_then(|v| v.as_array())
        {
            for item in contents {
                if let Some(track) = parse_playlist_panel_video(item, true) {
                    if track.video_id != seed_video_id {
                        tracks.push(track);
                    }
                }
            }
        }
    }
    tracks
}

fn parse_lrc_timestamp(tag: &str) -> Option<u64> {
    let inner = tag.trim();
    let parts: Vec<&str> = inner.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let mins = parts[0].trim().parse::<u64>().ok()?;
    let sec_parts: Vec<&str> = parts[1].trim().split('.').collect();
    let secs = sec_parts[0].trim().parse::<u64>().ok()?;
    let ms = if sec_parts.len() >= 2 {
        let frac = sec_parts[1].trim();
        let val = frac.parse::<u64>().ok()?;
        match frac.len() {
            1 => val * 100,
            2 => val * 10,
            3 => val,
            _ => val / 10u64.pow((frac.len() - 3) as u32),
        }
    } else {
        0
    };
    Some(mins * 60_000 + secs * 1_000 + ms)
}

pub fn parse_lrc(lrc: &str) -> Vec<LyricLine> {
    let mut lines = Vec::new();
    for raw_line in lrc.lines() {
        let mut rest = raw_line.trim();
        let mut timestamps = Vec::new();
        while rest.starts_with('[') {
            let Some(end) = rest.find(']') else {
                break;
            };
            let tag = &rest[1..end];
            if let Some(ms) = parse_lrc_timestamp(tag) {
                timestamps.push(ms);
                rest = rest[end + 1..].trim_start();
            } else {
                // Metadata tag like [ar:...], [ti:...]
                timestamps.clear();
                break;
            }
        }
        if !timestamps.is_empty() {
            let text = rest.trim().to_string();
            if !text.is_empty() {
                for ts in timestamps {
                    lines.push(LyricLine {
                        time_ms: ts,
                        text: text.clone(),
                    });
                }
            }
        }
    }
    lines.sort_by_key(|l| l.time_ms);
    lines
}

async fn fetch_lrclib_lyrics(
    state: &AppState,
    video_id: &str,
    title: &str,
    artist: &str,
    duration_seconds: u64,
) -> Option<LyricsResponse> {
    let clean_title = title
        .split(['(', '（', '['])
        .next()
        .unwrap_or(title)
        .trim();
    let clean_artist = artist
        .split([',', '、', '&'])
        .next()
        .unwrap_or(artist)
        .trim();

    let mut candidates: Vec<Value> = Vec::new();

    if !clean_title.is_empty() && !clean_artist.is_empty() {
        let mut url = format!(
            "https://lrclib.net/api/get?track_name={}&artist_name={}",
            urlencoding::encode(clean_title),
            urlencoding::encode(clean_artist)
        );
        if duration_seconds > 0 {
            url.push_str(&format!("&duration={duration_seconds}"));
        }
        if let Ok(resp) = state
            .http_client
            .get(&url)
            .header("User-Agent", "AetherMusic/0.1.0 (https://github.com/hankyleisplay/AetherMusic)")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<Value>().await {
                    if val.get("syncedLyrics").is_some() || val.get("plainLyrics").is_some() {
                        candidates.push(val);
                    }
                }
            }
        }
    }

    if candidates.is_empty() {
        let q = format!("{clean_artist} {clean_title}").trim().to_string();
        if !q.is_empty() {
            let url = format!("https://lrclib.net/api/search?q={}", urlencoding::encode(&q));
            if let Ok(resp) = state
                .http_client
                .get(&url)
                .header("User-Agent", "AetherMusic/0.1.0 (https://github.com/hankyleisplay/AetherMusic)")
                .send()
                .await
            {
                if resp.status().is_success() {
                    if let Ok(arr) = resp.json::<Vec<Value>>().await {
                        candidates.extend(arr);
                    }
                }
            }
        }
    }

    for item in &candidates {
        if let Some(synced) = item.get("syncedLyrics").and_then(|v| v.as_str()) {
            if !synced.trim().is_empty() {
                let parsed = parse_lrc(synced);
                if !parsed.is_empty() {
                    let plain = item
                        .get("plainLyrics")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| {
                            parsed
                                .iter()
                                .map(|l| l.text.as_str())
                                .collect::<Vec<_>>()
                                .join("\n")
                        });
                    return Some(LyricsResponse {
                        video_id: video_id.to_string(),
                        synced_lines: parsed,
                        plain_text: plain,
                        source: "LRCLIB Synced".to_string(),
                        has_synced: true,
                    });
                }
            }
        }
    }

    for item in &candidates {
        if let Some(plain) = item.get("plainLyrics").and_then(|v| v.as_str()) {
            if !plain.trim().is_empty() {
                return Some(LyricsResponse {
                    video_id: video_id.to_string(),
                    synced_lines: Vec::new(),
                    plain_text: plain.trim().to_string(),
                    source: "LRCLIB Plain".to_string(),
                    has_synced: false,
                });
            }
        }
    }

    None
}

async fn fetch_ytmapi_official_lyrics(
    state: &AppState,
    video_id: &str,
) -> Option<LyricsResponse> {
    let mut next_body = ytm_context();
    next_body["videoId"] = json!(video_id);
    next_body["isAudioOnly"] = json!(true);

    let next_data = post_ytm(state, "next", next_body).await.ok()?;
    let tabs = next_data
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs")
        .and_then(|v| v.as_array())?;

    let mut lyrics_browse_id: Option<String> = None;
    for tab in tabs {
        if let Some(bid) = tab
            .pointer("/tabRenderer/endpoint/browseEndpoint/browseId")
            .and_then(|v| v.as_str())
        {
            if bid.starts_with("MPLYt_") {
                lyrics_browse_id = Some(bid.to_string());
                break;
            }
        }
    }
    let browse_id = lyrics_browse_id?;

    let mut browse_body = ytm_context();
    browse_body["browseId"] = json!(browse_id);
    let browse_data = post_ytm(state, "browse", browse_body).await.ok()?;

    // Check timed lyrics renderer first if available
    if let Some(timed_data) = browse_data
        .pointer("/contents/sectionListRenderer/contents/0/elementRenderer/newElement/type/componentType/model/timedLyricsModel/lyricsData/timedLyricsData")
        .and_then(|v| v.as_array())
    {
        let mut lines = Vec::new();
        for entry in timed_data {
            let text = entry
                .get("lyricLine")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let start_ms = entry
                .pointer("/cueRange/startTimeMilliseconds")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok())
                .or_else(|| {
                    entry
                        .pointer("/cueRange/startTimeMilliseconds")
                        .and_then(|v| v.as_u64())
                })
                .unwrap_or(0);
            if !text.is_empty() {
                lines.push(LyricLine {
                    time_ms: start_ms,
                    text,
                });
            }
        }
        if !lines.is_empty() {
            let plain = lines
                .iter()
                .map(|l| l.text.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            return Some(LyricsResponse {
                video_id: video_id.to_string(),
                synced_lines: lines,
                plain_text: plain,
                source: "YTMAPI Synced".to_string(),
                has_synced: true,
            });
        }
    }

    if let Some(contents) = browse_data
        .pointer("/contents/sectionListRenderer/contents")
        .and_then(|v| v.as_array())
    {
        for sec in contents {
            if let Some(runs) = sec.pointer("/musicDescriptionShelfRenderer/description/runs") {
                let text = collect_runs_text(Some(runs)).trim().to_string();
                if !text.is_empty() {
                    return Some(LyricsResponse {
                        video_id: video_id.to_string(),
                        synced_lines: Vec::new(),
                        plain_text: text,
                        source: "YTMAPI Official".to_string(),
                        has_synced: false,
                    });
                }
            }
        }
    }

    None
}

pub async fn get_lyrics(
    state: &AppState,
    video_id: &str,
    title: &str,
    artist: &str,
    duration_seconds: u64,
    prefer_source: Option<&str>,
) -> LyricsResponse {
    let pref = prefer_source.unwrap_or("auto");

    if pref == "ytmapi" {
        if let Some(res) = fetch_ytmapi_official_lyrics(state, video_id).await {
            return res;
        }
    } else if pref == "ytdlp" {
        if let Ok((lines, plain)) = ytdlp::extract_cc_lyrics(state, video_id).await {
            return LyricsResponse {
                video_id: video_id.to_string(),
                synced_lines: lines,
                plain_text: plain,
                source: "yt-dlp Captions".to_string(),
                has_synced: true,
            };
        }
    } else if pref == "lrclib" {
        if let Some(res) = fetch_lrclib_lyrics(state, video_id, title, artist, duration_seconds).await {
            return res;
        }
    }

    // Auto 3-tier waterfall
    let (lrclib_res, ytmapi_res) = tokio::join!(
        fetch_lrclib_lyrics(state, video_id, title, artist, duration_seconds),
        fetch_ytmapi_official_lyrics(state, video_id)
    );

    if let Some(ref lrc) = lrclib_res {
        if lrc.has_synced {
            return lrc.clone();
        }
    }
    if let Some(ytm) = ytmapi_res {
        return ytm;
    }
    if let Ok((lines, plain)) = ytdlp::extract_cc_lyrics(state, video_id).await {
        return LyricsResponse {
            video_id: video_id.to_string(),
            synced_lines: lines,
            plain_text: plain,
            source: "yt-dlp Captions".to_string(),
            has_synced: true,
        };
    }
    if let Some(lrc) = lrclib_res {
        return lrc;
    }

    LyricsResponse {
        video_id: video_id.to_string(),
        synced_lines: Vec::new(),
        plain_text: String::new(),
        source: "None".to_string(),
        has_synced: false,
    }
}

pub async fn get_home_sections(state: &AppState) -> Result<Vec<HomeSection>, String> {
    let queries = [
        ("華語流行熱門", "即時熱門華語金曲與經典單曲", "華語流行熱門歌曲 周杰倫 林俊傑 鄧紫棋"),
        ("日語動漫 & J-Pop", "YOASOBI, 米津玄師, Ado 與人氣動畫主題曲", "J-Pop Anime Hits YOASOBI 米津玄師"),
        ("歐美流行精選", "全球排行榜熱門單曲與話題新作", "Global Top Pop Hits 2025"),
        ("Lo-Fi & 專注節拍", "適合編程、閱讀與深夜放鬆的氛圍節奏", "Lo-Fi Chill Beats Study Relax"),
    ];

    let (r0, r1, r2, r3) = tokio::join!(
        search_tracks(state, queries[0].2, Some("songs")),
        search_tracks(state, queries[1].2, Some("songs")),
        search_tracks(state, queries[2].2, Some("songs")),
        search_tracks(state, queries[3].2, Some("songs")),
    );

    let mut sections = Vec::new();
    for (idx, res) in [r0, r1, r2, r3].into_iter().enumerate() {
        if let Ok(tracks) = res {
            if !tracks.is_empty() {
                sections.push(HomeSection {
                    title: queries[idx].0.to_string(),
                    subtitle: queries[idx].1.to_string(),
                    tracks: tracks.into_iter().take(12).collect(),
                });
            }
        }
    }

    if sections.is_empty() {
        return Err("無法從 YTMAPI 載入首頁推薦內容，請檢查網路連線。".to_string());
    }

    Ok(sections)
}

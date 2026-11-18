use crate::cache;
use crate::models::AppState;
use crate::ytdlp;
use futures_util::StreamExt;
use std::path::Path;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

pub async fn start_proxy_server(state: AppState) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local audio proxy: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get proxy local_addr: {e}"))?
        .port();

    *state.proxy_port.write().await = port;

    let stream_client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(45))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((socket, _addr)) => {
                    let st = state.clone();
                    let cl = stream_client.clone();
                    tokio::spawn(async move {
                        let _ = handle_connection(socket, st, cl).await;
                    });
                }
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    });

    Ok(port)
}

async fn write_simple_response(
    socket: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let headers = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
         Access-Control-Allow-Headers: Range, Content-Type\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    socket.write_all(headers.as_bytes()).await?;
    if !body.is_empty() {
        socket.write_all(body).await?;
    }
    socket.flush().await
}

async fn handle_connection(
    socket: TcpStream,
    state: AppState,
    client: reqwest::Client,
) -> Result<(), String> {
    let mut reader = BufReader::new(socket);
    let mut request_line = String::new();
    let n = reader
        .read_line(&mut request_line)
        .await
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Ok(());
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(());
    }
    let method = parts[0].to_uppercase();
    let target = parts[1].to_string();

    let mut range_header: Option<String> = None;
    loop {
        let mut line = String::new();
        let read_bytes = reader.read_line(&mut line).await.map_err(|e| e.to_string())?;
        if read_bytes == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                let val = v.trim().to_string();
                if !val.is_empty() {
                    range_header = Some(val);
                }
            }
        }
    }

    let mut socket = reader.into_inner();

    if method == "OPTIONS" {
        let headers = "HTTP/1.1 204 No Content\r\n\
                       Access-Control-Allow-Origin: *\r\n\
                       Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                       Access-Control-Allow-Headers: Range, Content-Type\r\n\
                       Access-Control-Max-Age: 86400\r\n\
                       Connection: close\r\n\r\n";
        let _ = socket.write_all(headers.as_bytes()).await;
        let _ = socket.flush().await;
        return Ok(());
    }

    let (path, query_str) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target.as_str(), ""),
    };
    if path == "/health" {
        let _ = write_simple_response(&mut socket, "200 OK", "text/plain; charset=utf-8", b"ok").await;
        return Ok(());
    }

    if path == "/focus" {
        if let Some(tx) = state.focus_tx.read().await.as_ref() {
            let _ = tx.send(());
        }
        let _ = write_simple_response(&mut socket, "200 OK", "text/plain; charset=utf-8", b"focused").await;
        return Ok(());
    }

    if path == "/local" {
        if method != "GET" && method != "HEAD" {
            let _ = write_simple_response(
                &mut socket,
                "405 Method Not Allowed",
                "text/plain",
                b"Method Not Allowed",
            )
            .await;
            return Ok(());
        }
        let raw_path = query_str
            .split('&')
            .find_map(|pair| pair.strip_prefix("path="))
            .unwrap_or("");
        let decoded = urlencoding::decode(raw_path).unwrap_or_default().to_string();
        let local_path = Path::new(&decoded);
        let ext = local_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if decoded.is_empty()
            || !matches!(
                ext.as_str(),
                "flac" | "wav" | "mp3" | "ogg" | "m4a" | "alac" | "aiff" | "opus" | "aac" | "webm"
            )
            || !local_path.is_file()
        {
            let _ = write_simple_response(&mut socket, "404 Not Found", "text/plain", b"Local audio not found").await;
            return Ok(());
        }
        let mime_type = cache::mime_from_extension(&ext);
        let _ = serve_cached_file(
            &mut socket,
            &method,
            local_path,
            mime_type,
            range_header.as_deref(),
        )
        .await;
        return Ok(());
    }

    let Some(raw_id) = path.strip_prefix("/stream/") else {
        let _ = write_simple_response(&mut socket, "404 Not Found", "text/plain", b"Not Found").await;
        return Ok(());
    };

    let video_id = raw_id.trim().trim_matches('/');
    if video_id.is_empty() || video_id.contains('/') {
        let _ = write_simple_response(&mut socket, "400 Bad Request", "text/plain", b"Invalid video id").await;
        return Ok(());
    }

    let quality = query_str
        .split('&')
        .find_map(|pair| pair.strip_prefix("quality="))
        .unwrap_or("lossless");

    if method != "GET" && method != "HEAD" {
        let _ = write_simple_response(
            &mut socket,
            "405 Method Not Allowed",
            "text/plain",
            b"Method Not Allowed",
        )
        .await;
        return Ok(());
    }

    if let Some((cached_path, entry)) = cache::get_cached_audio(&state, video_id).await {
        let _ = serve_cached_file(
            &mut socket,
            &method,
            &cached_path,
            &entry.mime_type,
            range_header.as_deref(),
        )
        .await;
        return Ok(());
    }

    // Spawn non-blocking background auto-cache so subsequent plays hit local disk cache
    {
        let bg_state = state.clone();
        let bg_vid = video_id.to_string();
        let bg_quality = quality.to_string();
        tokio::spawn(async move {
            let _ = cache::cache_audio_stream(&bg_state, &bg_vid, &bg_quality).await;
        });
    }

    let mut cached = match ytdlp::extract_stream_network(&state, video_id, quality).await {
        Ok(c) => c,
        Err(err) => {
            let _ = write_simple_response(
                &mut socket,
                "502 Bad Gateway",
                "text/plain; charset=utf-8",
                err.as_bytes(),
            )
            .await;
            return Ok(());
        }
    };

    let mut upstream_resp = send_upstream(&client, &method, &cached.direct_url, range_header.as_deref()).await;
    if let Ok(ref resp) = upstream_resp {
        if resp.status().as_u16() == 403 || resp.status().as_u16() == 410 {
            ytdlp::invalidate_stream_cache(&state, video_id).await;
            if let Ok(fresh) = ytdlp::extract_stream_network(&state, video_id, quality).await {
                cached = fresh;
                upstream_resp = send_upstream(&client, &method, &cached.direct_url, range_header.as_deref()).await;
            }
        }
    }

    let resp = match upstream_resp {
        Ok(r) => r,
        Err(err) => {
            let _ = write_simple_response(
                &mut socket,
                "502 Bad Gateway",
                "text/plain; charset=utf-8",
                err.as_bytes(),
            )
            .await;
            return Ok(());
        }
    };

    let status = resp.status();
    let status_line = match status.as_u16() {
        206 => "206 Partial Content",
        200 => "200 OK",
        416 => "416 Range Not Satisfiable",
        code => {
            let msg = format!("Upstream HTTP {code}");
            let _ = write_simple_response(&mut socket, "502 Bad Gateway", "text/plain", msg.as_bytes()).await;
            return Ok(());
        }
    };

    let resp_headers = resp.headers();
    let content_type = resp_headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(&cached.mime_type)
        .to_string();
    let content_length = resp_headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let content_range = resp_headers
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let mut header_buf = format!(
        "HTTP/1.1 {status_line}\r\n\
         Content-Type: {content_type}\r\n\
         Accept-Ranges: bytes\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
         Access-Control-Allow-Headers: Range, Content-Type\r\n\
         Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n\
         Cache-Control: no-cache\r\n"
    );
    if let Some(len) = content_length {
        header_buf.push_str(&format!("Content-Length: {len}\r\n"));
    }
    if let Some(cr) = content_range {
        header_buf.push_str(&format!("Content-Range: {cr}\r\n"));
    }
    header_buf.push_str("Connection: close\r\n\r\n");

    if socket.write_all(header_buf.as_bytes()).await.is_err() {
        return Ok(());
    }

    if method == "HEAD" {
        let _ = socket.flush().await;
        return Ok(());
    }

    let mut stream = resp.bytes_stream();
    while let Some(chunk_res) = stream.next().await {
        match chunk_res {
            Ok(bytes) => {
                if socket.write_all(&bytes).await.is_err() {
                    // Client closed connection (e.g. seek or skip track)
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let _ = socket.flush().await;
    Ok(())
}

async fn send_upstream(
    client: &reqwest::Client,
    method: &str,
    url: &str,
    range: Option<&str>,
) -> Result<reqwest::Response, String> {
    let mut req = if method == "HEAD" {
        client.head(url)
    } else {
        client.get(url)
    };
    if let Some(r) = range {
        req = req.header(reqwest::header::RANGE, r);
    }
    req.send()
        .await
        .map_err(|e| format!("Upstream audio stream error: {e}"))
}

async fn serve_cached_file(
    socket: &mut TcpStream,
    method: &str,
    path: &Path,
    mime_type: &str,
    range: Option<&str>,
) -> std::io::Result<()> {
    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => {
            return write_simple_response(socket, "404 Not Found", "text/plain", b"Cache miss").await;
        }
    };
    let total_len = file.metadata().await?.len();
    if total_len == 0 {
        return write_simple_response(socket, "404 Not Found", "text/plain", b"Empty cache").await;
    }

    let (status_line, start, end) = if let Some(r_hdr) = range {
        if let Some(spec) = r_hdr.strip_prefix("bytes=") {
            let parts: Vec<&str> = spec.split('-').collect();
            let s = parts
                .first()
                .and_then(|v| v.trim().parse::<u64>().ok())
                .unwrap_or(0);
            let e = parts
                .get(1)
                .and_then(|v| v.trim().parse::<u64>().ok())
                .unwrap_or(total_len.saturating_sub(1))
                .min(total_len.saturating_sub(1));
            if s <= e && s < total_len {
                ("206 Partial Content", s, e)
            } else {
                ("416 Range Not Satisfiable", 0, 0)
            }
        } else {
            ("200 OK", 0, total_len.saturating_sub(1))
        }
    } else {
        ("200 OK", 0, total_len.saturating_sub(1))
    };

    if status_line.starts_with("416") {
        let headers = format!(
            "HTTP/1.1 416 Range Not Satisfiable\r\n\
             Content-Range: bytes */{total_len}\r\n\
             Access-Control-Allow-Origin: *\r\n\
             Connection: close\r\n\r\n"
        );
        socket.write_all(headers.as_bytes()).await?;
        return socket.flush().await;
    }

    let chunk_len = end - start + 1;
    let mut header_buf = format!(
        "HTTP/1.1 {status_line}\r\n\
         Content-Type: {mime_type}\r\n\
         Accept-Ranges: bytes\r\n\
         Content-Length: {chunk_len}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
         Access-Control-Allow-Headers: Range, Content-Type\r\n\
         Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n\
         X-Aether-Cache: HIT\r\n"
    );
    if status_line.starts_with("206") {
        header_buf.push_str(&format!("Content-Range: bytes {start}-{end}/{total_len}\r\n"));
    }
    header_buf.push_str("Connection: close\r\n\r\n");

    socket.write_all(header_buf.as_bytes()).await?;
    if method == "HEAD" {
        return socket.flush().await;
    }

    file.seek(std::io::SeekFrom::Start(start)).await?;
    let mut reader = file.take(chunk_len);
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        if socket.write_all(&buf[..n]).await.is_err() {
            break;
        }
    }
    socket.flush().await
}

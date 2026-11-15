# AetherMusic

A modern desktop cloud music streaming player built with **Tauri v2 + Rust + React + TypeScript**.

## Features

- **Cloud Music Streaming (`yt-dlp` + Local HTTP Range Proxy)**: High-quality audio extraction via `yt-dlp` piped through a built-in Rust async HTTP Range proxy (`127.0.0.1`) for instant seeking, CORS-free playback, and live Web Audio API spectrum visualization.
- **YouTube Music Metadata & Discovery (YTMAPI)**: Search tracks, fetch high-resolution artwork, song details, and curated discovery feeds via YouTube Music InnerTube (`WEB_REMIX`).
- **3-Tier Synced Lyrics Engine**:
  1. Time-synced LRC lyrics via LRCLIB
  2. Official YouTube Music lyrics via YTMAPI (`MPLYt_...`)
  3. Cloud closed-caption lyrics fallback via `yt-dlp`
- **Auto-Radio Queue Continuation**: Automatically fetches related tracks (`RDAMVM` radio mix) when the queue nears completion so music never stops.
- **Stable Desktop UI**: Fixed-frame responsive grid layout engineered to prevent overflow or text distortion across window sizes and CJK/Latin titles.

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](./LICENSE) file for details.

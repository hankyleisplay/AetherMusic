# Changelog

All notable changes to **AetherMusic** are documented in this file.

## [2026.11.0] - 2026-11-18

### Version & Release Pipeline
- Adopted CalVer `YYYY.MM.PATCH` versioning starting with `2026.11.0` across `package.json`, `Cargo.toml`, `tauri.conf.json`, and UI status views (dynamically queried via `@tauri-apps/api/app`).
- Added full 4-platform GitHub Actions release matrix (`windows-latest`, `macos-latest` Universal `.dmg`, `ubuntu-22.04` `.deb` & `.AppImage`, `ubuntu-latest` signed Android `.apk`) in `.github/workflows/release.yml` and `.github/workflows/cross-platform.yml`.

### Discovery, Search & Smart Recommendations
- Dynamic Home Dashboard with personalized **Jump Back In (近期常聽)**, **Daily Mix (為你推薦)** seeded by listening taste, **Top Charts (熱門排行榜)**, and **Moods & Genres (依曲風/心情探索)**.
- Expanded multi-category search (`歌曲`, `藝人`, `專輯`, `播放清單`, `MV 影片`, `綜合`) with live YTMAPI search suggestions and persistent search history.
- Added dedicated **Artist & Album Detail** views displaying top tracks, albums, and similar artists.

### Library, Playlists, Local Scanner & Sound Capsule
- Full custom playlist management (create, rename, upload cover art, delete) with automatic duplicate detection and one-click deduplication (`一鍵移除重複歌曲`).
- In-playlist keyword filtering, sorting (`加入時間 / 歌名 / 藝人`), and drag-and-drop track reordering persisted to local storage.
- One-click import from YouTube / YouTube Music public playlist URLs and export to `.json` and `.m3u` formats.
- Local lossless music folder scanner (`.flac`, `.wav`, `.mp3`, `.ogg`, `.m4a`, `.alac`, `.aiff`, `.opus`) with pure-Rust ID3v2 / Vorbis / MP4 tag & embedded cover art parsing, streamed via local HTTP Range proxy.
- Added **Sound Capsule (個人聆聽統計)** showing cumulative/monthly listening time, Top 10 most played tracks, and favorite artists ranking.

### Audio Engine & Immersive Experience
- Added Gapless Playback preloading alongside configurable 0–12s DJ Crossfade transitions.
- Upgraded DSP equalizer to a **10-Band Graphic EQ** (`31Hz`–`16kHz`) with built-in presets (`Flat`, `Bass`, `Vocal`, `Pop`, `Rock`, `Classical`, `Club`, `Hi-Res`) and custom profile persistence, plus a **Loudness Normalization** toggle.
- Multi-style real-time Web Audio FFT visualizer (`Bars`, `Wave`, `Aurora`).
- Per-track persistent `±0.5s` lyrics timing offset storage.
- Added **Sleep Timer** (`15/30/45/60m` or end-of-track with 10-second smooth volume fade-out) and desktop **Mini Player** floating mode.

### Cross-Platform OS Integration & Reliability
- Standardized Tauri `app_data_dir` / `app_cache_dir` path resolution and 2GB LRU audio cache.
- Added cross-platform single-instance wakeup lock (`instance.port` + `/focus`), platform-isolated window effects (`#[cfg(target_os = "...")]`), and global media/keyboard shortcuts (`Ctrl/Cmd+Alt+Space`, etc.).
- Fixed app self-update download/installer execution, external browser URL opening, and `yt-dlp` standalone fallback.

## [0.2.1] - 2026-11-18
- Replaced Liquid Glass with crisp dark studio UI, redesigned app icon, fixed engine re-detection, and added Pure Direct audio path.

## [0.2.0] - 2026-11-18
- Initial cross-platform release with AI DJ Mix, dual-deck crossfade, local HTTP Range proxy, Windows SMTC, system tray, and 2GB LRU audio cache.

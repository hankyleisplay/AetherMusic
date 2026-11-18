# AetherMusic

A cross-platform cloud & Hi-Res music streaming player built with **Tauri v2 + Rust + React + TypeScript** for **Windows, Linux, and Android**.

## Features (v2026.11.0)

- **Spotify-Style AI DJ Mix**:
  - Dual-deck audio engine (`Deck A` / `Deck B`) with automatic smooth crossfading, bass-swap EQ transition curves, curated mood vibes (`Late Night`, `Focus Flow`, `Cyber Neon`, `Acoustic Warm`, `Energy Boost`), optional AI DJ voice commentary, and a manual 3-band EQ (`Bass 65Hz`, `Mid 2.5kHz`, `Air 12kHz`).
- **Low-Power Acrylic Frosted Glass UI & Live FFT Spectrum**:
  - GPU-friendly translucent Acrylic/Mica frosted glass over dynamic album-color aurora ambient lighting, paired with a one-click **Acrylic / Lite** performance toggle.
  - Real-time Web Audio API FFT frequency spectrum visualizers across the mini player bar, DJ Mix console, and immersive lyrics stage.
- **Hi-Res / Lossless Audio Support**:
  - Lossless/Hi-Res stream priority (`48kHz` Opus/AAC extraction via `yt-dlp` & InnerTube fallback), 32-bit Float Web Audio DSP chain with soft-knee `DynamicsCompressorNode` limiter, plus local lossless file playback (`.flac`, `.wav`, `.alac`, `.aiff`).
- **Cloud Music Streaming & Discovery**:
  - Desktop streaming via `yt-dlp` piped through a built-in Rust async HTTP Range proxy (`127.0.0.1`) for instant seeking and CORS-free Web Audio analysis, with pure-Rust YouTube InnerTube (`VISIONOS`) stream extraction fallback for sandboxed/Android environments.
  - Search tracks, fetch high-resolution artwork, curated discovery feeds, and automatic related-track (`RDAMVM` radio mix) queue continuation via YTMAPI (`WEB_REMIX`).
  - 3-tier synced lyrics engine (LRCLIB time-synced LRC -> YTMAPI official lyrics -> `yt-dlp` cloud captions).
- **Auto-Updater & GPU Startup Splash**:
  - Built-in Settings updater checking GitHub releases/commits and one-click `yt-dlp` engine self-update, plus a compositor-only startup splash animation.
- **Cross-Platform & Automated GitHub Actions CI**:
  - Responsive layout supporting desktop shells and Android/mobile bottom navigation (`<= 768px`), compiled automatically for **Windows** (`.exe`/`.msi`), **Linux** (`.deb`/`.AppImage`), and **Android** (`.apk`) via GitHub Actions.

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](./LICENSE) file for details.

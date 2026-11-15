import {
  AudioWaveform,
  Disc3,
  FolderPlus,
  Loader2,
  Mic,
  Radio,
  Sliders,
  Sparkles,
  Volume2,
} from "lucide-react";
import type { DjVibeId, EqPreset, EqSettings, Track } from "../types";
import { AlbumArt } from "./AlbumArt";
import { SpectrumCanvas } from "./SpectrumCanvas";

export interface DjVibeOption {
  id: DjVibeId;
  label: string;
  desc: string;
  query: string;
  gradient: string;
}

export const DJ_VIBES: DjVibeOption[] = [
  {
    id: "club",
    label: "Neon Club 派對電音",
    desc: "高能量 EDM、House 與強節奏混音無縫切換",
    query: "Electronic Dance House Club Mix Hits",
    gradient: "linear-gradient(135deg, #7c5cff 0%, #ec4899 100%)",
  },
  {
    id: "chill",
    label: "Late Night 深夜微醺",
    desc: "R&B、Neo-Soul 與微醺電子氛圍平滑漸變",
    query: "Late Night Chill R&B Soul Vibes",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
  },
  {
    id: "mandopop",
    label: "Mandopop 華語金曲連播",
    desc: "精選華語流行與抒情經典 DJ 導聆混音",
    query: "華語流行精選串燒 金曲",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)",
  },
  {
    id: "anime",
    label: "Anime & J-Pop 動漫熱血",
    desc: "YOASOBI、Ado 與高燃日系動畫主題曲",
    query: "J-Pop Anime Opening Hits Mix",
    gradient: "linear-gradient(135deg, #10b981 0%, #3b82f6 100%)",
  },
  {
    id: "focus",
    label: "Deep Focus 專注律動",
    desc: "Synthwave、Lo-Fi 與低干擾工作節拍",
    query: "Synthwave Lo-Fi Deep Focus Instrumental",
    gradient: "linear-gradient(135deg, #14b8a6 0%, #8b5cf6 100%)",
  },
];

export const EQ_PRESETS: Record<EqPreset, { label: string; low: number; mid: number; high: number }> = {
  hires: { label: "Hi-Res 無損母帶", low: 1.5, mid: 0.5, high: 2.5 },
  flat: { label: "原音無渲染", low: 0, mid: 0, high: 0 },
  bass: { label: "深沉重低音", low: 6, mid: -1, high: 1.5 },
  club: { label: "DJ Club 現場", low: 5, mid: -2, high: 4 },
  vocal: { label: "清晰人聲", low: -2, mid: 4.5, high: 2 },
};

interface DjMixConsoleProps {
  currentTrack: Track | null;
  nextTrack: Track | null;
  isPlaying: boolean;
  analyser: AnalyserNode | null;
  djEnabled: boolean;
  djVibe: DjVibeId;
  djLoading: boolean;
  djComment: string;
  djVoiceEnabled: boolean;
  crossfadeSec: number;
  crossfadeActive: boolean;
  eq: EqSettings;
  onToggleDj: () => void;
  onSelectVibe: (vibe: DjVibeOption) => void;
  onToggleDjVoice: () => void;
  onChangeCrossfadeSec: (sec: number) => void;
  onChangeEq: (next: EqSettings) => void;
  onSpeakNow: () => void;
  onImportLocalLossless: (files: FileList | null) => void;
}

export function DjMixConsole({
  currentTrack,
  nextTrack,
  isPlaying,
  analyser,
  djEnabled,
  djVibe,
  djLoading,
  djComment,
  djVoiceEnabled,
  crossfadeSec,
  crossfadeActive,
  eq,
  onToggleDj,
  onSelectVibe,
  onToggleDjVoice,
  onChangeCrossfadeSec,
  onChangeEq,
  onSpeakNow,
  onImportLocalLossless,
}: DjMixConsoleProps) {
  const activeVibe = DJ_VIBES.find((v) => v.id === djVibe) ?? DJ_VIBES[0];

  return (
    <div className="dj-console-wrap">
      {/* Spotify-style AI DJ Hero Orb Card */}
      <section className="dj-hero-card">
        <button
          type="button"
          className={`dj-orb-btn ${djEnabled ? "active" : ""} ${isPlaying && djEnabled ? "pulsing" : ""}`}
          style={{ background: activeVibe.gradient }}
          onClick={() => {
            if (!djEnabled) {
              onToggleDj();
            } else {
              const nextIdx = (DJ_VIBES.findIndex((v) => v.id === djVibe) + 1) % DJ_VIBES.length;
              onSelectVibe(DJ_VIBES[nextIdx]);
            }
          }}
          title={djEnabled ? "點擊切換下一組 AI DJ 混音風格" : "啟動 AI DJ Mix"}
        >
          {djLoading ? (
            <Loader2 size={34} color="#fff" className="spin" />
          ) : (
            <span className="dj-orb-label">DJ</span>
          )}
        </button>

        <div className="dj-hero-info">
          <div className="hero-eyebrow">
            <Sparkles size={14} />
            <span>SPOTIFY-STYLE AI DJ MIX · 雙軌無縫 CROSSFADE</span>
          </div>
          <h1 className="hero-title truncate">
            {djEnabled ? `AI DJ 混音中：${activeVibe.label}` : "啟動您的專屬 AI DJ 混音台"}
          </h1>
          <p className="dj-comment-box">
            {djComment ||
              "點擊左側 AI DJ 光球即可切換曲風、自動串接相關音樂，並在每首歌結尾自動執行 Bass-Swap 平滑 Crossfade 混音過渡。"}
          </p>
          <div className="hero-actions">
            <button
              type="button"
              className="primary-btn"
              onClick={onToggleDj}
            >
              <Radio size={15} />
              {djEnabled ? "關閉 AI DJ 自動混音" : "一鍵啟動 AI DJ Mix"}
            </button>
            <button
              type="button"
              className={`secondary-btn ${djVoiceEnabled ? "active-outline" : ""}`}
              onClick={onToggleDjVoice}
            >
              <Mic size={14} />
              DJ 語音串場：{djVoiceEnabled ? "開啟" : "靜音"}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={onSpeakNow}
              disabled={!currentTrack}
            >
              <Volume2 size={14} />
              試聽 DJ 導聆
            </button>
          </div>
        </div>
      </section>

      {/* Dual-Deck Transition Monitor */}
      <section className="dj-decks-grid">
        <div className="panel-card deck-card">
          <div className="deck-badge">DECK A · 正在混音播放</div>
          <div className="deck-track-row">
            {currentTrack ? (
              <AlbumArt
                thumbnailUrl={currentTrack.thumbnailUrl}
                videoId={currentTrack.videoId}
                title={currentTrack.title}
                artist={currentTrack.artist}
                className="deck-art"
              />
            ) : (
              <div className="deck-art placeholder">
                <Disc3 size={24} />
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>
                {currentTrack?.title || "尚未載入曲目"}
              </div>
              <div className="truncate" style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
                {currentTrack?.artist || "請點選下方風格或歌曲"}
              </div>
            </div>
          </div>
        </div>

        <div className="deck-bridge">
          <div className={`crossfade-pill ${crossfadeActive ? "live" : ""}`}>
            <AudioWaveform size={15} />
            <span>{crossfadeActive ? "正在無縫 Crossfade..." : `自動混音過渡 ${crossfadeSec}s`}</span>
          </div>
        </div>

        <div className="panel-card deck-card">
          <div className="deck-badge next">DECK B · 預備接續 (已預載)</div>
          <div className="deck-track-row">
            {nextTrack ? (
              <AlbumArt
                thumbnailUrl={nextTrack.thumbnailUrl}
                videoId={nextTrack.videoId}
                title={nextTrack.title}
                artist={nextTrack.artist}
                className="deck-art"
              />
            ) : (
              <div className="deck-art placeholder">
                <Sparkles size={22} />
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>
                {nextTrack?.title || "佇列將自動推薦下一首"}
              </div>
              <div className="truncate" style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
                {nextTrack?.artist || "Auto-Radio & YTMAPI"}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Live Master FFT Spectrum Monitor */}
      <section className="panel-card" style={{ gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" }}>
            即時 32-bit Float 主混音輸出頻譜 (Web Audio FFT)
          </span>
          <span className="quality-badge">LIVE SPECTRUM</span>
        </div>
        <SpectrumCanvas analyser={analyser} isPlaying={isPlaying} variant="wide" />
      </section>

      {/* DJ Vibes */}
      <section className="panel-card">
        <div className="section-header" style={{ marginBottom: 4 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>切換 AI DJ 混音頻道</h3>
            <p className="section-sub">根據心情與場合即時重新編排混音歌單</p>
          </div>
        </div>
        <div className="vibes-grid">
          {DJ_VIBES.map((v) => {
            const active = v.id === djVibe;
            return (
              <button
                key={v.id}
                type="button"
                className={`vibe-tile ${active ? "active" : ""}`}
                onClick={() => onSelectVibe(v)}
                disabled={djLoading}
              >
                <div className="vibe-dot" style={{ background: v.gradient }} />
                <div style={{ minWidth: 0, textAlign: "left" }}>
                  <div className="truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {v.label}
                  </div>
                  <div className="truncate" style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                    {v.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Crossfade, 32-bit Float Hi-Res EQ & Local Lossless Importer */}
      <div className="settings-grid">
        <section className="panel-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sliders size={16} style={{ color: "var(--accent-secondary)" }} />
              <h3 style={{ margin: 0, fontSize: 15 }}>32-bit Float 母帶 EQ 與混音過渡</h3>
            </div>
            <span className="quality-badge">DSP Active</span>
          </div>

          <div className="chip-row">
            {(Object.keys(EQ_PRESETS) as EqPreset[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`chip-btn ${eq.preset === key ? "active" : ""}`}
                onClick={() =>
                  onChangeEq({
                    ...EQ_PRESETS[key],
                    preset: key,
                  })
                }
              >
                {EQ_PRESETS[key].label}
              </button>
            ))}
          </div>

          <div className="eq-sliders">
            <label className="eq-row">
              <span>Low (65Hz)</span>
              <input
                type="range"
                className="range-slider"
                min={-12}
                max={12}
                step={0.5}
                value={eq.low}
                style={{ "--progress": `${((eq.low + 12) / 24) * 100}%` } as React.CSSProperties}
                onChange={(e) => onChangeEq({ ...eq, low: Number(e.target.value) })}
              />
              <span className="tabular-nums eq-val">{eq.low > 0 ? `+${eq.low}` : eq.low} dB</span>
            </label>
            <label className="eq-row">
              <span>Mid (2.5kHz)</span>
              <input
                type="range"
                className="range-slider"
                min={-12}
                max={12}
                step={0.5}
                value={eq.mid}
                style={{ "--progress": `${((eq.mid + 12) / 24) * 100}%` } as React.CSSProperties}
                onChange={(e) => onChangeEq({ ...eq, mid: Number(e.target.value) })}
              />
              <span className="tabular-nums eq-val">{eq.mid > 0 ? `+${eq.mid}` : eq.mid} dB</span>
            </label>
            <label className="eq-row">
              <span>High (12kHz)</span>
              <input
                type="range"
                className="range-slider"
                min={-12}
                max={12}
                step={0.5}
                value={eq.high}
                style={{ "--progress": `${((eq.high + 12) / 24) * 100}%` } as React.CSSProperties}
                onChange={(e) => onChangeEq({ ...eq, high: Number(e.target.value) })}
              />
              <span className="tabular-nums eq-val">{eq.high > 0 ? `+${eq.high}` : eq.high} dB</span>
            </label>
            <label className="eq-row">
              <span>Crossfade 混音秒數</span>
              <input
                type="range"
                className="range-slider"
                min={0}
                max={12}
                step={1}
                value={crossfadeSec}
                style={{ "--progress": `${(crossfadeSec / 12) * 100}%` } as React.CSSProperties}
                onChange={(e) => onChangeCrossfadeSec(Number(e.target.value))}
              />
              <span className="tabular-nums eq-val">{crossfadeSec} 秒</span>
            </label>
          </div>
        </section>

        <section className="panel-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FolderPlus size={16} style={{ color: "var(--accent-primary)" }} />
            <h3 style={{ margin: 0, fontSize: 15 }}>本機無損音檔匯入 (FLAC / WAV / ALAC)</h3>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            支援直接載入本機高解析無損音檔（FLAC、WAV、ALAC、MP3），免上傳雲端即刻進入 32-bit Float DSP 與雙軌 Crossfade DJ 混音佇列。
          </p>
          <label className="primary-btn" style={{ width: "fit-content", cursor: "pointer" }}>
            <FolderPlus size={15} />
            <span>選擇本機無損音檔</span>
            <input
              type="file"
              accept=".flac,.wav,.alac,.m4a,.aac,.ogg,.mp3,audio/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                onImportLocalLossless(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </section>
      </div>
    </div>
  );
}

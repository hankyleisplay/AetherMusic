import {
  AudioWaveform,
  Disc3,
  FolderPlus,
  Loader2,
  Mic,
  Radio,
  Save,
  Sliders,
  Sparkles,
  Volume2,
} from "lucide-react";
import type { DjVibeId, EqPreset, EqSettings, Track, VisualizerStyle } from "../types";
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

export const EQ_BAND_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_BAND_LABELS = [
  "31",
  "62",
  "125",
  "250",
  "500",
  "1k",
  "2k",
  "4k",
  "8k",
  "16k",
] as const;

export const EQ_PRESETS: Record<
  Exclude<EqPreset, "custom">,
  { label: string; bands: number[] }
> = {
  flat: { label: "原音直通", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: "重低音", bands: [6, 5.5, 4.5, 2.5, 0.5, 0, 0, 0.5, 1, 1.5] },
  vocal: { label: "清晰人聲", bands: [-2.5, -2, -1, 1, 3, 4.5, 4, 2.5, 1.5, 0.5] },
  pop: { label: "流行 Pop", bands: [1.5, 2.5, 3, 1.5, -0.5, 0.5, 2, 3, 2.5, 1.5] },
  rock: { label: "搖滾 Rock", bands: [4, 3, 1.5, -1, -1.5, 0.5, 2.5, 4, 4.5, 3.5] },
  classical: { label: "古典 Classical", bands: [2.5, 2, 1, 0, 0, 0, 1.5, 2.5, 3, 3.5] },
  club: { label: "DJ Club", bands: [5.5, 5, 3, 0.5, -1.5, -1, 1.5, 3.5, 4.5, 4] },
  hires: { label: "Hi-Res 解析", bands: [1.5, 1, 0.5, 0, 0, 0.5, 1, 1.5, 2.5, 3] },
};

export function summarizeBandsToTriBand(bands: number[]): {
  low: number;
  mid: number;
  high: number;
} {
  const b = bands.length === 10 ? bands : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const low = Number(((b[0] + b[1] + b[2]) / 3).toFixed(1));
  const mid = Number(((b[4] + b[5] + b[6]) / 3).toFixed(1));
  const high = Number(((b[8] + b[9]) / 2).toFixed(1));
  return { low, mid, high };
}

export function resolveEqBands(eq: EqSettings): number[] {
  if (eq.bands && eq.bands.length === 10) {
    return eq.bands;
  }
  return [
    eq.low,
    eq.low * 0.85,
    eq.low * 0.6,
    eq.low * 0.25,
    eq.mid * 0.6,
    eq.mid,
    eq.mid * 0.8,
    eq.high * 0.5,
    eq.high * 0.85,
    eq.high,
  ];
}

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
  loudnessNorm: boolean;
  visualizerStyle: VisualizerStyle;
  onToggleDj: () => void;
  onSelectVibe: (vibe: DjVibeOption) => void;
  onToggleDjVoice: () => void;
  onChangeCrossfadeSec: (sec: number) => void;
  onChangeEq: (next: EqSettings) => void;
  onSaveCustomEq: () => void;
  onToggleLoudnessNorm: () => void;
  onChangeVisualizerStyle: (style: VisualizerStyle) => void;
  onSpeakNow: () => void;
  onTriggerCrossfadeNext: () => void;
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
  loudnessNorm,
  visualizerStyle,
  onToggleDj,
  onSelectVibe,
  onToggleDjVoice,
  onChangeCrossfadeSec,
  onChangeEq,
  onSaveCustomEq,
  onToggleLoudnessNorm,
  onChangeVisualizerStyle,
  onSpeakNow,
  onTriggerCrossfadeNext,
  onImportLocalLossless,
}: DjMixConsoleProps) {
  const activeVibe = DJ_VIBES.find((v) => v.id === djVibe) ?? DJ_VIBES[0];
  const bands = resolveEqBands(eq);

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
            <button type="button" className="primary-btn" onClick={onToggleDj}>
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
            <button
              type="button"
              className="secondary-btn"
              onClick={onTriggerCrossfadeNext}
              disabled={!currentTrack || !nextTrack}
            >
              <AudioWaveform size={14} />
              立即無縫混音切歌
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
            <span>
              {crossfadeActive
                ? "正在無縫 Crossfade..."
                : crossfadeSec === 0
                  ? "Gapless 無縫預載"
                  : `自動混音過渡 ${crossfadeSec}s`}
            </span>
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

      {/* Live Master FFT Spectrum Monitor with Visualizer Mode Selector */}
      <section className="panel-card" style={{ gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" }}>
            即時 32-bit Float 主混音輸出頻譜 (Web Audio FFT)
          </span>
          <div className="chip-row">
            {(
              [
                ["bars", "律動柱狀"],
                ["wave", "雙向音波"],
                ["aurora", "動態光暈"],
              ] as const
            ).map(([styleKey, label]) => (
              <button
                key={styleKey}
                type="button"
                className={`chip-btn ${visualizerStyle === styleKey ? "active" : ""}`}
                style={{ padding: "4px 10px", fontSize: 11.5 }}
                onClick={() => onChangeVisualizerStyle(styleKey)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <SpectrumCanvas analyser={analyser} isPlaying={isPlaying} variant="wide" mode={visualizerStyle} />
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

      {/* 10-Band Graphic EQ, Loudness Normalization, Crossfade & Local Lossless Importer */}
      <div className="settings-grid">
        <section className="panel-card" style={{ gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sliders size={16} style={{ color: "var(--accent-secondary)" }} />
              <h3 style={{ margin: 0, fontSize: 15 }}>10 段式圖形均衡器 (10-Band EQ) 與音量標準化</h3>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="secondary-btn"
                style={{ padding: "5px 10px", fontSize: 11.5 }}
                onClick={onSaveCustomEq}
                title="將目前 10 段頻率曲線儲存為「自訂」預設"
              >
                <Save size={12} />
                儲存自訂 EQ
              </button>
              <span className="quality-badge">10-Band DSP</span>
            </div>
          </div>

          <div className="chip-row">
            {(Object.keys(EQ_PRESETS) as Array<Exclude<EqPreset, "custom">>).map((key) => (
              <button
                key={key}
                type="button"
                className={`chip-btn ${eq.preset === key ? "active" : ""}`}
                onClick={() => {
                  const nextBands = [...EQ_PRESETS[key].bands];
                  const tri = summarizeBandsToTriBand(nextBands);
                  onChangeEq({
                    ...eq,
                    ...tri,
                    preset: key,
                    bands: nextBands,
                  });
                }}
              >
                {EQ_PRESETS[key].label}
              </button>
            ))}
            <button
              type="button"
              className={`chip-btn ${eq.preset === "custom" ? "active" : ""}`}
              onClick={() => {
                const nextBands =
                  eq.customBands && eq.customBands.length === 10
                    ? [...eq.customBands]
                    : [...bands];
                const tri = summarizeBandsToTriBand(nextBands);
                onChangeEq({
                  ...eq,
                  ...tri,
                  preset: "custom",
                  bands: nextBands,
                  customBands: nextBands,
                });
              }}
            >
              自訂儲存
            </button>
          </div>

          <div className="eq10-grid">
            {EQ_BAND_LABELS.map((freqLabel, idx) => {
              const val = bands[idx] ?? 0;
              return (
                <div key={freqLabel} className="eq10-col">
                  <span className="eq10-val tabular-nums">
                    {val > 0 ? `+${val}` : val}
                  </span>
                  <input
                    type="range"
                    className="eq10-slider"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={val}
                    aria-label={`${freqLabel} Hz 增益`}
                    onChange={(e) => {
                      const nextBands = [...bands];
                      nextBands[idx] = Number(e.target.value);
                      const tri = summarizeBandsToTriBand(nextBands);
                      onChangeEq({
                        ...eq,
                        ...tri,
                        preset: "custom",
                        bands: nextBands,
                      });
                    }}
                  />
                  <span className="eq10-freq">{freqLabel}Hz</span>
                </div>
              );
            })}
          </div>

          <div className="eq-sliders" style={{ marginTop: 6 }}>
            <label className="eq-row">
              <span>Crossfade 混音 (0s = 無縫)</span>
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
              <span className="tabular-nums eq-val">
                {crossfadeSec === 0 ? "Gapless" : `${crossfadeSec} 秒`}
              </span>
            </label>
          </div>

          <div className="auto-radio-card" style={{ marginTop: 4 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                音量標準化 (Loudness Normalization)
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                自動平衡不同曲目與專輯間的響度落差，維持一致聽感
              </div>
            </div>
            <button
              type="button"
              className={`toggle-switch ${loudnessNorm ? "on" : ""}`}
              onClick={onToggleLoudnessNorm}
              aria-label="切換音量標準化"
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </section>

        <section className="panel-card" style={{ gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FolderPlus size={16} style={{ color: "var(--accent-primary)" }} />
              <div>
                <h3 style={{ margin: 0, fontSize: 15 }}>快速匯入本機無損音檔 (FLAC / WAV / ALAC)</h3>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                  支援直接載入本機音檔進入 10 段 EQ 與雙軌 Crossfade DJ 混音佇列；完整資料夾掃描可於「收藏與紀錄」執行。
                </p>
              </div>
            </div>
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
          </div>
        </section>
      </div>
    </div>
  );
}

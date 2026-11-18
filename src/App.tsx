import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ArrowUpCircle,
  BarChart3,
  Clock,
  Compass,
  CopyCheck,
  Disc3,
  Download,
  Edit3,
  FileJson,
  FileMusic,
  FolderPlus,
  FolderSearch,
  HardDrive,
  Heart,
  Home,
  ImagePlus,
  Info,
  Library,
  Link2,
  ListMusic,
  Loader2,
  Maximize2,
  Mic2,
  Minimize2,
  Moon,
  Music,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Settings,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  checkForUpdates,
  clearAudioCache,
  clearPlayHistoryDb,
  downloadTrack,
  exportPlaylistFile,
  getCacheStats,
  getEngineStatus,
  getEntityDetail,
  getHomeDiscovery,
  getLyrics,
  getRecommendations,
  getSearchSuggestions,
  getSongDetail,
  getStreamUrl,
  importYoutubePlaylist,
  loadUserStore,
  openExternalUrl,
  prefetchStream,
  recordListeningStatDb,
  recordPlayHistoryDb,
  runAppUpdate,
  runCoreUpdate,
  saveLyricsOffsetDb,
  savePlaybackSnapshot,
  savePlaylistsDb,
  saveSearchHistoryDb,
  scanLocalMusic,
  searchMusic,
  setCloseToTray as setCloseToTrayCmd,
  setMiniPlayerMode,
  toggleFavoriteDb,
  triggerAudioCache,
  updateMediaSession,
} from "./api";
import appIconUrl from "./assets/app-icon.png";
import { AlbumArt } from "./components/AlbumArt";
import {
  DJ_VIBES,
  DjMixConsole,
  EQ_BAND_FREQS,
  resolveEqBands,
  type DjVibeOption,
} from "./components/DjMixConsole";
import { SpectrumCanvas } from "./components/SpectrumCanvas";
import { StartupSplash } from "./components/StartupSplash";
import { TrackTable } from "./components/TrackTable";
import type {
  AudioQuality,
  CacheStats,
  CustomPlaylist,
  DjVibeId,
  EngineStatus,
  EntityDetail,
  EqSettings,
  GlassMode,
  HomeSection,
  ListeningStats,
  LyricsResponse,
  NavTab,
  PersistedSettings,
  RepeatMode,
  SearchFilter,
  SidePanelTab,
  SongMetadata,
  StreamInfo,
  Track,
  UpdateStatus,
  VisualizerStyle,
} from "./types";
import { buildFallbackCoverSvgDataUrl } from "./utils/artworkFallback";
import { extractAlbumAccentRgb } from "./utils/colorExtract";

const STORAGE_FAVS = "aethermusic_favorites_v1";
const STORAGE_HISTORY = "aether_history_v1";
const STORAGE_SETTINGS = "aethermusic_settings_v2";
const STORAGE_PLAYLISTS = "aethermusic_playlists_v1";

const QUICK_GENRES = [
  "周杰倫",
  "YOASOBI",
  "陳奕迅",
  "鄧紫棋",
  "米津玄師",
  "Taylor Swift",
  "Lo-Fi Beats",
  "動漫神曲",
];

const MOOD_CARDS = [
  {
    title: "深夜 Lo-Fi 律動",
    sub: "專注・閱讀・夜色",
    query: "Lo-Fi Chill Beats Study",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #312e81 100%)",
  },
  {
    title: "華語金曲殿堂",
    sub: "情歌・經典・大合唱",
    query: "華語流行精選金曲",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #be123c 100%)",
  },
  {
    title: "動漫熱血燃曲",
    sub: "OP / ED・J-Pop",
    query: "J-Pop Anime Opening Hits",
    gradient: "linear-gradient(135deg, #10b981 0%, #2563eb 100%)",
  },
  {
    title: "Neon Club 電音",
    sub: "派對・EDM・高能量",
    query: "Electronic Dance House Club Mix",
    gradient: "linear-gradient(135deg, #7c5cff 0%, #ec4899 100%)",
  },
  {
    title: "K-Pop 潮流節拍",
    sub: "舞曲・熱門打榜",
    query: "K-Pop Top Hits 2026",
    gradient: "linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)",
  },
  {
    title: "Pure Acoustic 不插電",
    sub: "民謠・原音直通",
    query: "Acoustic Unplugged Chill",
    gradient: "linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)",
  },
];

function currentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatListenDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 分鐘";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} 小時 ${mins} 分`;
  }
  return `${Math.max(1, mins)} 分鐘`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function loadJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [appVersion, setAppVersion] = useState<string>("2026.11.0");
  const [showSplash, setShowSplash] = useState(true);
  const [navTab, setNavTab] = useState<NavTab>("home");
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [sideTab, setSideTab] = useState<SidePanelTab>("queue");

  // Discovery, Search & Entity Detail
  const [homeSections, setHomeSections] = useState<HomeSection[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<SearchFilter>("songs");
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [entityDetail, setEntityDetail] = useState<EntityDetail | null>(null);
  const [entityLoading, setEntityLoading] = useState(false);
  const [entityReturnTab, setEntityReturnTab] = useState<NavTab>("home");

  // Persisted settings
  const initialSettings = useMemo(
    () =>
      loadJsonStorage<PersistedSettings>(STORAGE_SETTINGS, {
        volume: 0.85,
        autoRadio: true,
        repeatMode: "off",
        shuffle: false,
        audioQuality: "lossless",
        glassMode: "acrylic",
        crossfadeSec: 5,
        djVoiceEnabled: true,
        djVibe: "club",
        eq: {
          low: 0,
          mid: 0,
          high: 0,
          preset: "flat",
          bands: new Array(10).fill(0),
          customBands: new Array(10).fill(0),
        },
        closeToTray: true,
        loudnessNorm: false,
        visualizerStyle: "bars",
      }),
    []
  );

  // Queue & playback state
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);

  const [volume, setVolume] = useState<number>(initialSettings.volume);
  const [muted, setMuted] = useState(false);
  const [autoRadio, setAutoRadio] = useState<boolean>(initialSettings.autoRadio);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(initialSettings.repeatMode);
  const [shuffle, setShuffle] = useState<boolean>(initialSettings.shuffle);
  const [audioQuality, setAudioQuality] = useState<AudioQuality>(initialSettings.audioQuality);
  const [glassMode, setGlassMode] = useState<GlassMode>(initialSettings.glassMode);
  const [pureDirect, setPureDirect] = useState<boolean>(() =>
    loadJsonStorage<boolean>("aethermusic_pure_direct_v1", true)
  );
  const [loudnessNorm, setLoudnessNorm] = useState<boolean>(
    Boolean(initialSettings.loudnessNorm)
  );
  const [visualizerStyle, setVisualizerStyle] = useState<VisualizerStyle>(
    initialSettings.visualizerStyle ?? "bars"
  );
  const [fetchingRecs, setFetchingRecs] = useState(false);

  // AI DJ Mix state
  const [djEnabled, setDjEnabled] = useState(false);
  const [djVibe, setDjVibe] = useState<DjVibeId>(initialSettings.djVibe);
  const [djLoading, setDjLoading] = useState(false);
  const [djComment, setDjComment] = useState("");
  const [djVoiceEnabled, setDjVoiceEnabled] = useState<boolean>(initialSettings.djVoiceEnabled);
  const [crossfadeSec, setCrossfadeSec] = useState<number>(initialSettings.crossfadeSec);
  const [crossfadeActive, setCrossfadeActive] = useState(false);
  const [eq, setEq] = useState<EqSettings>(initialSettings.eq);

  // Song metadata & lyrics
  const [songDetail, setSongDetail] = useState<SongMetadata | null>(null);
  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsOffset, setLyricsOffset] = useState<number>(0);
  const [lyricsOffsetsMap, setLyricsOffsetsMap] = useState<Record<string, number>>({});

  // Library, Playlists, Local Files, Sound Capsule, Sleep Timer & Mini Player
  const [favorites, setFavorites] = useState<Track[]>(() =>
    loadJsonStorage<Track[]>(STORAGE_FAVS, [])
  );
  const [history, setHistory] = useState<Track[]>(() =>
    loadJsonStorage<Track[]>(STORAGE_HISTORY, [])
  );
  const [playlists, setPlaylists] = useState<CustomPlaylist[]>(() =>
    loadJsonStorage<CustomPlaylist[]>(STORAGE_PLAYLISTS, [])
  );
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("");
  const [playlistFilter, setPlaylistFilter] = useState("");
  const [playlistSort, setPlaylistSort] = useState<"order" | "title" | "artist">("order");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [renamePlaylistName, setRenamePlaylistName] = useState("");
  const [renamingPlaylist, setRenamingPlaylist] = useState(false);
  const [importPlaylistUrl, setImportPlaylistUrl] = useState("");
  const [importingPlaylist, setImportingPlaylist] = useState(false);
  const [librarySubTab, setLibrarySubTab] = useState<"favorites" | "playlists" | "local" | "stats">(
    "favorites"
  );

  const [localFolderPath, setLocalFolderPath] = useState<string>("");
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [scanningLocal, setScanningLocal] = useState(false);
  const [listeningStats, setListeningStats] = useState<ListeningStats>({
    totalListenSeconds: 0,
    monthlyListenSeconds: {},
    trackPlayCounts: {},
    artistPlayCounts: {},
  });

  // Sleep Timer & Mini Player
  const [sleepMode, setSleepMode] = useState<"off" | "track" | "timer">("off");
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number>(0);
  const [sleepMenuOpen, setSleepMenuOpen] = useState(false);
  const [miniMode, setMiniMode] = useState(false);

  // Cache, Tray, Engine & Auto-Updater
  const [closeToTray, setCloseToTray] = useState<boolean>(initialSettings.closeToTray ?? true);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(() => new Set());
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [detectingEngine, setDetectingEngine] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updatingCore, setUpdatingCore] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);

  // Dual-deck Audio & 10-Band Web Audio DSP refs
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const activeDeckRef = useRef<"A" | "B">("A");
  const [activeDeck, setActiveDeck] = useState<"A" | "B">("A");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainARef = useRef<GainNode | null>(null);
  const gainBRef = useRef<GainNode | null>(null);
  const djBassSwapFilterRef = useRef<BiquadFilterNode | null>(null);
  const bandFiltersRef = useRef<BiquadFilterNode[]>([]);
  const pureDirectGainRef = useRef<GainNode | null>(null);
  const limiterGainRef = useRef<GainNode | null>(null);
  const normGainRef = useRef<GainNode | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Mutable refs for async/event accuracy
  const queueRef = useRef<Track[]>(queue);
  const currentIndexRef = useRef<number>(currentIndex);
  const autoRadioRef = useRef<boolean>(autoRadio);
  const repeatModeRef = useRef<RepeatMode>(repeatMode);
  const shuffleRef = useRef<boolean>(shuffle);
  const qualityRef = useRef<AudioQuality>(audioQuality);
  const djEnabledRef = useRef<boolean>(djEnabled);
  const djVoiceRef = useRef<boolean>(djVoiceEnabled);
  const crossfadeSecRef = useRef<number>(crossfadeSec);
  const lyricsOffsetsRef = useRef<Record<string, number>>(lyricsOffsetsMap);
  const sleepModeRef = useRef(sleepMode);
  const proxyPortRef = useRef<number>(0);

  const playRequestIdRef = useRef<number>(0);
  const crossfadeTriggeredReqRef = useRef<number>(-1);
  const cacheTriggeredReqRef = useRef<number>(-1);
  const gaplessPreloadedReqRef = useRef<number>(-1);
  const gaplessPreloadedUrlRef = useRef<{ videoId: string; url: string; deck: "A" | "B" } | null>(
    null
  );
  const restoredSeekSecRef = useRef<number>(0);
  const storeLoadedRef = useRef<boolean>(false);
  const lastSmtcSyncAtRef = useRef<number>(0);
  const crossfadeCleanupTimerRef = useRef<number | null>(null);
  const playedIdsRef = useRef<Set<string>>(new Set());
  const recInFlightRef = useRef<boolean>(false);
  const listenAccumSecRef = useRef<number>(0);
  const recordedTrackForStatRef = useRef<string>("");

  const lyricsMainActiveRef = useRef<HTMLButtonElement | null>(null);
  const lyricsSideActiveRef = useRef<HTMLDivElement | null>(null);

  queueRef.current = queue;
  currentIndexRef.current = currentIndex;
  autoRadioRef.current = autoRadio;
  repeatModeRef.current = repeatMode;
  shuffleRef.current = shuffle;
  qualityRef.current = audioQuality;
  djEnabledRef.current = djEnabled;
  djVoiceRef.current = djVoiceEnabled;
  crossfadeSecRef.current = crossfadeSec;
  lyricsOffsetsRef.current = lyricsOffsetsMap;
  sleepModeRef.current = sleepMode;
  if (engineStatus?.proxyPort) {
    proxyPortRef.current = engineStatus.proxyPort;
  }

  const currentTrack =
    currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  const nextTrack =
    currentIndex >= 0 && currentIndex + 1 < queue.length ? queue[currentIndex + 1] : null;
  const favoriteIds = useMemo(() => new Set(favorites.map((t) => t.videoId)), [favorites]);

  const showToast = useCallback((message: string, isError = false) => {
    setToast({ message, isError });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    try {
      localStorage.setItem("aethermusic_pure_direct_v1", JSON.stringify(pureDirect));
    } catch {
      // ignore
    }
  }, [pureDirect]);

  // Dynamic Acrylic Accent Extraction from Album Art
  useEffect(() => {
    if (!currentTrack?.thumbnailUrl) return;
    let cancelled = false;
    void extractAlbumAccentRgb(currentTrack.thumbnailUrl).then((colors) => {
      if (cancelled || !colors) return;
      document.documentElement.style.setProperty("--accent-rgb-1", colors[0]);
      document.documentElement.style.setProperty("--accent-rgb-2", colors[1]);
    });
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.thumbnailUrl]);

  // Persist user library & settings
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_FAVS, JSON.stringify(favorites));
    } catch {
      // ignore
    }
  }, [favorites]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PLAYLISTS, JSON.stringify(playlists));
    } catch {
      // ignore
    }
  }, [playlists]);

  const buildCurrentSettings = useCallback(
    (): PersistedSettings => ({
      volume,
      autoRadio,
      repeatMode,
      shuffle,
      audioQuality,
      glassMode,
      crossfadeSec,
      djVoiceEnabled,
      djVibe,
      eq,
      closeToTray,
      loudnessNorm,
      visualizerStyle,
    }),
    [
      audioQuality,
      autoRadio,
      closeToTray,
      crossfadeSec,
      djVibe,
      djVoiceEnabled,
      eq,
      glassMode,
      loudnessNorm,
      repeatMode,
      shuffle,
      visualizerStyle,
      volume,
    ]
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(buildCurrentSettings()));
    } catch {
      // ignore
    }
  }, [buildCurrentSettings]);

  const persistSnapshot = useCallback(
    (overridePosSec?: number) => {
      if (!storeLoadedRef.current) return;
      const activeAudio = activeDeckRef.current === "A" ? audioARef.current : audioBRef.current;
      const posSec =
        overridePosSec ??
        (activeAudio && Number.isFinite(activeAudio.currentTime)
          ? activeAudio.currentTime
          : restoredSeekSecRef.current || 0);
      savePlaybackSnapshot({
        queue: queueRef.current,
        currentIndex: currentIndexRef.current,
        positionSec: posSec,
        settings: buildCurrentSettings(),
      }).catch(() => {});
    },
    [buildCurrentSettings]
  );

  useEffect(() => {
    if (!storeLoadedRef.current) return;
    const t = window.setTimeout(() => {
      persistSnapshot();
    }, 450);
    return () => window.clearTimeout(t);
  }, [queue, currentIndex, buildCurrentSettings, persistSnapshot]);

  useEffect(() => {
    const onBeforeUnload = () => {
      persistSnapshot();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [persistSnapshot]);

  useEffect(() => {
    const fadeFactor =
      sleepMode === "timer" && sleepRemainingSec > 0 && sleepRemainingSec <= 10
        ? sleepRemainingSec / 10
        : 1;
    const v = muted ? 0 : volume * fadeFactor;
    if (audioARef.current) audioARef.current.volume = v;
    if (audioBRef.current) audioBRef.current.volume = v;
  }, [volume, muted, sleepMode, sleepRemainingSec]);

  // Sync live 10-band EQ parameters to Web Audio filters
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || bandFiltersRef.current.length === 0) return;
    const now = ctx.currentTime;
    const bands = resolveEqBands(eq);
    bandFiltersRef.current.forEach((filter, i) => {
      filter.gain.setTargetAtTime(bands[i] ?? 0, now, 0.04);
    });
  }, [eq]);

  // Switch cleanly between Pure Direct, Limiter protection, and Loudness Normalization
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !pureDirectGainRef.current || !limiterGainRef.current || !normGainRef.current) {
      return;
    }
    const now = ctx.currentTime;
    const normOn = loudnessNorm ? 1 : 0;
    const directOn = !loudnessNorm && pureDirect ? 1 : 0;
    const limiterOn = !loudnessNorm && !pureDirect ? 1 : 0;
    normGainRef.current.gain.setTargetAtTime(normOn, now, 0.02);
    pureDirectGainRef.current.gain.setTargetAtTime(directOn, now, 0.02);
    limiterGainRef.current.gain.setTargetAtTime(limiterOn, now, 0.02);
  }, [pureDirect, loudnessNorm]);

  const getActiveAudio = useCallback(() => {
    return activeDeckRef.current === "A" ? audioARef.current : audioBRef.current;
  }, []);

  const getStandbyDeck = useCallback((): "A" | "B" => {
    return activeDeckRef.current === "A" ? "B" : "A";
  }, []);

  const ensureAudioGraph = useCallback(() => {
    const aA = audioARef.current;
    const aB = audioBRef.current;
    if (!aA || !aB) return;

    try {
      if (!audioCtxRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;

        const ctx = new Ctx({ latencyHint: "playback" });

        const bassSwap = ctx.createBiquadFilter();
        bassSwap.type = "lowshelf";
        bassSwap.frequency.value = 85;
        bassSwap.gain.value = 0;

        const initialBands = resolveEqBands(eq);
        const eqNodes = EQ_BAND_FREQS.map((freq, idx) => {
          const f = ctx.createBiquadFilter();
          f.type = idx === 0 ? "lowshelf" : idx === EQ_BAND_FREQS.length - 1 ? "highshelf" : "peaking";
          f.frequency.value = freq;
          f.Q.value = 1.4;
          f.gain.value = initialBands[idx] ?? 0;
          return f;
        });

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -0.5;
        limiter.knee.value = 2;
        limiter.ratio.value = 8;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.12;

        const normComp = ctx.createDynamicsCompressor();
        normComp.threshold.value = -16;
        normComp.knee.value = 12;
        normComp.ratio.value = 3.5;
        normComp.attack.value = 0.015;
        normComp.release.value = 0.25;

        const normMakeup = ctx.createGain();
        normMakeup.gain.value = 1.32;

        const pureDirectGain = ctx.createGain();
        const limiterGain = ctx.createGain();
        const normGain = ctx.createGain();
        normGain.gain.value = loudnessNorm ? 1 : 0;
        pureDirectGain.gain.value = !loudnessNorm && pureDirect ? 1 : 0;
        limiterGain.gain.value = !loudnessNorm && !pureDirect ? 1 : 0;

        const analyserNode = ctx.createAnalyser();
        analyserNode.fftSize = 128;
        analyserNode.smoothingTimeConstant = 0.82;

        const gainA = ctx.createGain();
        const gainB = ctx.createGain();
        gainA.gain.value = activeDeckRef.current === "A" ? 1 : 0;
        gainB.gain.value = activeDeckRef.current === "B" ? 1 : 0;

        const srcA = ctx.createMediaElementSource(aA);
        const srcB = ctx.createMediaElementSource(aB);

        srcA.connect(gainA);
        srcB.connect(gainB);
        gainA.connect(bassSwap);
        gainB.connect(bassSwap);

        let chainHead: AudioNode = bassSwap;
        for (const node of eqNodes) {
          chainHead.connect(node);
          chainHead = node;
        }

        // Branch 1: Pure Direct
        chainHead.connect(pureDirectGain);
        pureDirectGain.connect(analyserNode);

        // Branch 2: Anti-clipping Limiter
        chainHead.connect(limiter);
        limiter.connect(limiterGain);
        limiterGain.connect(analyserNode);

        // Branch 3: Loudness Normalization
        chainHead.connect(normComp);
        normComp.connect(normMakeup);
        normMakeup.connect(normGain);
        normGain.connect(analyserNode);

        analyserNode.connect(ctx.destination);

        audioCtxRef.current = ctx;
        gainARef.current = gainA;
        gainBRef.current = gainB;
        djBassSwapFilterRef.current = bassSwap;
        bandFiltersRef.current = eqNodes;
        pureDirectGainRef.current = pureDirectGain;
        limiterGainRef.current = limiterGain;
        normGainRef.current = normGain;
        setAnalyser(analyserNode);
      }

      if (audioCtxRef.current?.state === "suspended") {
        void audioCtxRef.current.resume();
      }
    } catch {
      // Fallback safely if Web Audio creation isn't supported
    }
  }, [eq, loudnessNorm, pureDirect]);

  const speakDjTransition = useCallback((track: Track, vibeLabel?: string) => {
    const script = vibeLabel
      ? `已切換至 ${vibeLabel}，接下來為您無縫混音播放 ${track.artist} 的 ${track.title}`
      : `接下來無縫接歌，帶來 ${track.artist} 的 ${track.title}`;
    setDjComment(script);

    if (!djVoiceRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(script);
      utter.lang = "zh-TW";
      utter.rate = 1.04;
      utter.pitch = 1.0;
      utter.volume = 0.88;
      window.speechSynthesis.speak(utter);
    } catch {
      // ignore speech synthesis errors on headless/unsupported webviews
    }
  }, []);

  const refreshEngineStatus = useCallback(
    async (forceRedetect = false, showFeedback = false) => {
      if (forceRedetect) {
        setDetectingEngine(true);
      }
      try {
        const status = await getEngineStatus(forceRedetect);
        setEngineStatus(status);
        if (status.proxyPort) {
          proxyPortRef.current = status.proxyPort;
        }
        if (showFeedback) {
          const ytdlpLabel = status.ytdlpAvailable
            ? `yt-dlp ${status.ytdlpVersion}`
            : "純 Rust InnerTube 備援";
          const proxyLabel = status.proxyPort ? `127.0.0.1:${status.proxyPort}` : "未啟動";
          showToast(`引擎偵測完成：${ytdlpLabel} · Proxy ${proxyLabel}`);
        }
      } catch (err) {
        if (showFeedback) {
          showToast(`引擎偵測失敗（目前可能非 Tauri 執行環境）: ${String(err)}`, true);
        }
      } finally {
        if (forceRedetect) {
          setDetectingEngine(false);
        }
      }
      try {
        const cs = await getCacheStats();
        setCacheStats(cs);
      } catch {
        // ignore
      }
    },
    [showToast]
  );

  const handleCheckUpdates = useCallback(
    async (silent = false) => {
      setCheckingUpdate(true);
      try {
        const res = await checkForUpdates();
        setUpdateStatus(res);
        if (!silent) {
          if (res.appUpdateAvailable || res.ytdlpUpdateAvailable) {
            showToast("偵測到可用的新版本或串流核心更新！");
          } else {
            showToast("目前已是最新版本");
          }
        }
      } catch (err) {
        if (!silent) {
          showToast(`檢查更新失敗: ${String(err)}`, true);
        }
      } finally {
        setCheckingUpdate(false);
      }
    },
    [showToast]
  );

  const handleOpenExternalUrl = useCallback(
    async (url: string) => {
      try {
        await openExternalUrl(url);
      } catch {
        const win = window.open(url, "_blank", "noopener,noreferrer");
        if (!win) {
          showToast(`無法自動開啟瀏覽器，請手動前往：${url}`, true);
        }
      }
    },
    [showToast]
  );

  const handleRunCoreUpdate = useCallback(async () => {
    setUpdatingCore(true);
    try {
      const res = await runCoreUpdate();
      showToast(res.message, !res.success);
      await refreshEngineStatus(true, false);
      await handleCheckUpdates(true);
    } catch (err) {
      showToast(`更新失敗: ${String(err)}`, true);
    } finally {
      setUpdatingCore(false);
    }
  }, [handleCheckUpdates, refreshEngineStatus, showToast]);

  const handleRunAppUpdate = useCallback(async () => {
    setUpdatingApp(true);
    try {
      const res = await runAppUpdate();
      showToast(res.message, !res.success);
      if (!res.appUpdateLaunched) {
        if (res.releaseUrl && res.releaseUrl.toLowerCase().endsWith(".apk")) {
          await handleOpenExternalUrl(res.releaseUrl);
        }
        await handleCheckUpdates(true);
      }
    } catch (err) {
      showToast(`應用程式更新失敗: ${String(err)}`, true);
    } finally {
      setUpdatingApp(false);
    }
  }, [handleCheckUpdates, handleOpenExternalUrl, showToast]);

  const loadHome = useCallback(
    async (seedArtist?: string) => {
      setHomeLoading(true);
      try {
        const sections = await getHomeDiscovery(seedArtist);
        setHomeSections(sections);
      } catch (err) {
        showToast(`載入探索首頁失敗: ${String(err)}`, true);
      } finally {
        setHomeLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    void getVersion()
      .then((v) => {
        if (v) setAppVersion(v);
      })
      .catch(() => {});
    void refreshEngineStatus();
    void handleCheckUpdates(true);

    loadUserStore()
      .then((store) => {
        if (store.favorites.length > 0) {
          setFavorites(store.favorites);
        }
        if (store.history.length > 0) {
          setHistory(store.history);
        }
        if (store.playlists && store.playlists.length > 0) {
          setPlaylists(store.playlists);
          setSelectedPlaylistId(store.playlists[0].id);
        }
        if (store.searchHistory && store.searchHistory.length > 0) {
          setSearchHistory(store.searchHistory);
        }
        if (store.lyricsOffsets) {
          setLyricsOffsetsMap(store.lyricsOffsets);
        }
        if (store.listeningStats) {
          setListeningStats(store.listeningStats);
        }
        if (store.localFolderPath) {
          setLocalFolderPath(store.localFolderPath);
        }
        if (store.localTracks && store.localTracks.length > 0) {
          setLocalTracks(store.localTracks);
        }

        if (store.settings) {
          setVolume(store.settings.volume ?? 0.85);
          setAutoRadio(store.settings.autoRadio ?? true);
          setRepeatMode((store.settings.repeatMode as RepeatMode) || "off");
          setShuffle(Boolean(store.settings.shuffle));
          setAudioQuality((store.settings.audioQuality as AudioQuality) || "lossless");
          setGlassMode((store.settings.glassMode as GlassMode) || "acrylic");
          setCrossfadeSec(store.settings.crossfadeSec ?? 5);
          setDjVoiceEnabled(store.settings.djVoiceEnabled ?? true);
          setDjVibe((store.settings.djVibe as DjVibeId) || "club");
          if (store.settings.eq) {
            setEq(store.settings.eq);
          }
          setCloseToTray(store.settings.closeToTray ?? true);
          setLoudnessNorm(Boolean(store.settings.loudnessNorm));
          if (store.settings.visualizerStyle) {
            setVisualizerStyle(store.settings.visualizerStyle);
          }
        }

        const topArtistEntry = Object.entries(store.listeningStats?.artistPlayCounts ?? {}).sort(
          (a, b) => b[1] - a[1]
        )[0]?.[0];
        const seedArtist =
          topArtistEntry || store.history[0]?.artist || store.favorites[0]?.artist || undefined;
        void loadHome(seedArtist);

        if (queueRef.current.length === 0 && store.lastQueue.length > 0) {
          const validIdx = Math.max(
            0,
            Math.min(store.lastIndex >= 0 ? store.lastIndex : 0, store.lastQueue.length - 1)
          );
          const restored = store.lastQueue[validIdx];
          queueRef.current = store.lastQueue;
          currentIndexRef.current = validIdx;
          setQueue(store.lastQueue);
          setCurrentIndex(validIdx);
          setDuration(restored.durationSeconds || 0);
          setCurrentTime(store.lastPositionSec || 0);
          restoredSeekSecRef.current = store.lastPositionSec || 0;
          setLyricsOffset(store.lyricsOffsets?.[restored.videoId] ?? 0);

          if (!restored.localFilePath && !restored.videoId.startsWith("local-")) {
            const reqId = ++playRequestIdRef.current;
            void getSongDetail(restored.videoId)
              .then((meta) => {
                if (playRequestIdRef.current === reqId) setSongDetail(meta);
              })
              .catch(() => {});
            void getLyrics(
              restored.videoId,
              restored.title,
              restored.artist,
              restored.durationSeconds,
              "auto"
            )
              .then((lyr) => {
                if (playRequestIdRef.current === reqId) setLyrics(lyr);
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {
        void loadHome();
      })
      .finally(() => {
        storeLoadedRef.current = true;
      });
  }, [refreshEngineStatus, loadHome, handleCheckUpdates]);

  // Listen to single-instance focus event
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen("instance-focus", () => {
      if (!cancelled) {
        showToast("已喚醒現有 AetherMusic 視窗");
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [showToast]);

  // Live search suggestions debounced
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2 || navTab !== "search") {
      setSearchSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getSearchSuggestions(q)
        .then((list) => {
          if (!cancelled) setSearchSuggestions(list);
        })
        .catch(() => {});
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, navTab]);

  // Listening stats tracker (Sound Capsule)
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const timer = window.setInterval(() => {
      listenAccumSecRef.current += 5;
      if (listenAccumSecRef.current >= 15) {
        const secs = listenAccumSecRef.current;
        listenAccumSecRef.current = 0;
        void recordListeningStatDb(currentTrack, secs, currentMonthKey())
          .then((stats) => setListeningStats(stats))
          .catch(() => {});
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isPlaying, currentTrack]);

  // Sleep timer countdown & 10s smooth fade-out
  useEffect(() => {
    if (sleepMode !== "timer") return;
    const timer = window.setInterval(() => {
      setSleepRemainingSec((prev) => {
        if (prev <= 1) {
          const a = audioARef.current;
          const b = audioBRef.current;
          if (a) a.pause();
          if (b) b.pause();
          setIsPlaying(false);
          setSleepMode("off");
          showToast("⏰ 睡眠定時器已結束，已為您自動停止播放");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sleepMode, showToast]);

  const startSleepTimer = useCallback(
    (minutes: number | "track" | "off") => {
      setSleepMenuOpen(false);
      if (minutes === "off") {
        setSleepMode("off");
        setSleepRemainingSec(0);
        showToast("已取消睡眠定時器");
      } else if (minutes === "track") {
        setSleepMode("track");
        setSleepRemainingSec(0);
        showToast("🌙 已設定：播完當前歌曲後自動停止");
      } else {
        setSleepMode("timer");
        setSleepRemainingSec(minutes * 60);
        showToast(`⏰ 睡眠定時器已啟動：${minutes} 分鐘後漸弱停止`);
      }
    },
    [showToast]
  );

  const toggleMiniMode = useCallback(async () => {
    const next = !miniMode;
    setMiniMode(next);
    try {
      await setMiniPlayerMode(next);
    } catch {
      // non-desktop fallback
    }
  }, [miniMode]);

  const openEntityPage = useCallback(
    async (kind: "artist" | "album", name: string) => {
      const clean = name.trim();
      if (!clean || clean === "未知藝人" || clean === "單曲") return;
      if (navTab !== "entity") {
        setEntityReturnTab(navTab);
      }
      setNavTab("entity");
      setEntityLoading(true);
      setEntityDetail(null);
      try {
        const detail = await getEntityDetail(kind, clean);
        setEntityDetail(detail);
      } catch (err) {
        showToast(`無法載入「${clean}」詳細資訊: ${String(err)}`, true);
      } finally {
        setEntityLoading(false);
      }
    },
    [navTab, showToast]
  );

  const appendRecommendations = useCallback(
    async (seedVideoId: string, autoPlayFirstNew = false): Promise<boolean> => {
      if (recInFlightRef.current || seedVideoId.startsWith("local-")) return false;
      recInFlightRef.current = true;
      setFetchingRecs(true);
      try {
        const recs = await getRecommendations(seedVideoId);
        const existingIds = new Set(queueRef.current.map((t) => t.videoId));
        let fresh = recs.filter(
          (r) => !existingIds.has(r.videoId) && !playedIdsRef.current.has(r.videoId)
        );
        if (fresh.length === 0) {
          fresh = recs.filter((r) => !existingIds.has(r.videoId));
        }
        const toAdd = fresh.slice(0, 12).map((t) => ({ ...t, isAutoRecommended: true }));
        if (toAdd.length === 0) {
          return false;
        }

        const startNewIndex = queueRef.current.length;
        const nextQueue = [...queueRef.current, ...toAdd];
        queueRef.current = nextQueue;
        setQueue(nextQueue);

        if (!toAdd[0].localFileUrl && !toAdd[0].localFilePath) {
          prefetchStream(toAdd[0].videoId, qualityRef.current).catch(() => {});
        }

        if (autoPlayFirstNew) {
          setTimeout(() => {
            void playIndexRef.current(startNewIndex, false);
          }, 0);
        } else {
          showToast(`✨ 已透過 YTMAPI 自動推薦加入 ${toAdd.length} 首相關歌曲`);
        }
        return true;
      } catch (err) {
        if (autoPlayFirstNew) {
          showToast(`無法載入相關推薦歌曲: ${String(err)}`, true);
        }
        return false;
      } finally {
        recInFlightRef.current = false;
        setFetchingRecs(false);
      }
    },
    [showToast]
  );

  const syncOsMediaSession = useCallback(
    (track: Track | null, playing: boolean, posSec: number, durSec: number) => {
      if (!track) return;
      const resolvedDur = durSec > 0 ? durSec : track.durationSeconds || 0;
      const safePos = Math.max(0, Number.isFinite(posSec) ? posSec : 0);

      updateMediaSession({
        title: track.title,
        artist: track.artist,
        album: track.album || "AetherMusic",
        coverUrl: track.thumbnailUrl || null,
        durationSecs: resolvedDur,
        positionSecs: safePos,
        isPlaying: playing,
      }).catch(() => {});

      try {
        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album || "AetherMusic",
            artwork: track.thumbnailUrl
              ? [{ src: track.thumbnailUrl, sizes: "512x512", type: "image/jpeg" }]
              : [],
          });
          navigator.mediaSession.playbackState = playing ? "playing" : "paused";
          if (resolvedDur > 0 && "setPositionState" in navigator.mediaSession) {
            navigator.mediaSession.setPositionState({
              duration: resolvedDur,
              playbackRate: 1.0,
              position: Math.min(safePos, resolvedDur),
            });
          }
        }
      } catch {
        // ignore unsupported browser mediaSession fields
      }
    },
    []
  );

  const loadMetadataAndLyrics = useCallback(async (track: Track, reqId: number) => {
    setLyricsOffset(lyricsOffsetsRef.current[track.videoId] ?? 0);

    if (track.localFileUrl || track.localFilePath || track.videoId.startsWith("local-")) {
      setSongDetail(null);
      setLyrics({
        videoId: track.videoId,
        syncedLines: [],
        plainText: `本機無損音檔播放中\n曲目：${track.title}\n藝人：${track.artist}`,
        source: "Local Lossless",
        hasSynced: false,
      });
      setLyricsLoading(false);
      return;
    }

    setLyricsLoading(true);

    getSongDetail(track.videoId)
      .then((meta) => {
        if (playRequestIdRef.current !== reqId) return;
        setSongDetail(meta);
      })
      .catch(() => {});

    try {
      const lyr = await getLyrics(
        track.videoId,
        track.title,
        track.artist,
        track.durationSeconds,
        "auto"
      );
      if (playRequestIdRef.current !== reqId) return;
      setLyrics(lyr);
    } catch {
      if (playRequestIdRef.current !== reqId) return;
      setLyrics({
        videoId: track.videoId,
        syncedLines: [],
        plainText: "",
        source: "None",
        hasSynced: false,
      });
    } finally {
      if (playRequestIdRef.current === reqId) {
        setLyricsLoading(false);
      }
    }
  }, []);

  const cancelPendingCrossfade = useCallback(() => {
    if (crossfadeCleanupTimerRef.current !== null) {
      window.clearTimeout(crossfadeCleanupTimerRef.current);
      crossfadeCleanupTimerRef.current = null;
    }
    setCrossfadeActive(false);
  }, []);

  const resolveLocalTrackProxyUrl = useCallback(async (track: Track): Promise<string> => {
    if (track.localFileUrl) return track.localFileUrl;
    if (track.localFilePath) {
      let port = proxyPortRef.current;
      if (!port) {
        const st = await getEngineStatus();
        port = st.proxyPort;
        proxyPortRef.current = port;
      }
      if (port > 0) {
        return `http://127.0.0.1:${port}/local?path=${encodeURIComponent(track.localFilePath)}`;
      }
    }
    return "";
  }, []);

  const playQueueIndex = useCallback(
    async (idx: number, useCrossfade = false, skipAutoRec = false, resumeSeekSec = 0) => {
      const targetQueue = queueRef.current;
      if (idx < 0 || idx >= targetQueue.length) return;
      const track = targetQueue[idx];

      cancelPendingCrossfade();

      // Flush accumulated listening seconds for previous track
      if (listenAccumSecRef.current >= 5 && currentIndexRef.current >= 0) {
        const prevTrack = queueRef.current[currentIndexRef.current];
        const secs = listenAccumSecRef.current;
        listenAccumSecRef.current = 0;
        if (prevTrack) {
          void recordListeningStatDb(prevTrack, secs, currentMonthKey())
            .then((stats) => setListeningStats(stats))
            .catch(() => {});
        }
      }

      const reqId = ++playRequestIdRef.current;
      crossfadeTriggeredReqRef.current = -1;
      cacheTriggeredReqRef.current = -1;
      gaplessPreloadedReqRef.current = -1;
      restoredSeekSecRef.current = 0;
      currentIndexRef.current = idx;
      setCurrentIndex(idx);
      setIsBuffering(true);
      setCurrentTime(resumeSeekSec > 0 ? resumeSeekSec : 0);
      setDuration(track.durationSeconds || 0);
      setLyrics(null);
      setSongDetail(null);

      playedIdsRef.current.add(track.videoId);
      setHistory((prev) => [track, ...prev.filter((t) => t.videoId !== track.videoId)].slice(0, 80));
      if (!track.videoId.startsWith("local-") || track.localFilePath) {
        recordPlayHistoryDb(track)
          .then((persisted) => {
            if (persisted.length > 0) setHistory(persisted);
          })
          .catch(() => {});
      }

      if (recordedTrackForStatRef.current !== `${track.videoId}-${idx}`) {
        recordedTrackForStatRef.current = `${track.videoId}-${idx}`;
        void recordListeningStatDb(track, 0, currentMonthKey())
          .then((stats) => setListeningStats(stats))
          .catch(() => {});
      }

      void loadMetadataAndLyrics(track, reqId);
      syncOsMediaSession(track, true, resumeSeekSec, track.durationSeconds || 0);

      const remaining = targetQueue.length - 1 - idx;
      if (
        !skipAutoRec &&
        autoRadioRef.current &&
        remaining <= 1 &&
        !track.localFileUrl &&
        !track.localFilePath
      ) {
        void appendRecommendations(track.videoId, false);
      } else if (
        idx + 1 < targetQueue.length &&
        !targetQueue[idx + 1].localFileUrl &&
        !targetQueue[idx + 1].localFilePath
      ) {
        prefetchStream(targetQueue[idx + 1].videoId, qualityRef.current).catch(() => {});
      }

      try {
        let playUrl = "";
        if (track.localFileUrl || track.localFilePath) {
          playUrl = await resolveLocalTrackProxyUrl(track);
          if (playRequestIdRef.current !== reqId) return;
          setStreamInfo({
            videoId: track.videoId,
            proxyUrl: playUrl,
            directUrl: playUrl,
            mimeType: "audio/flac",
            acodec: track.album || "Local Lossless",
            abr: "Native",
            sampleRate: "48+ kHz",
            bitDepth: "24/32-bit Lossless",
            qualityLabel: track.localFilePath ? "本機無損庫" : "本機無損母帶",
            engineUsed: track.localFilePath ? "local-proxy" : "local-file",
          });
        } else {
          const info = await getStreamUrl(track.videoId, qualityRef.current);
          if (playRequestIdRef.current !== reqId) return;
          setStreamInfo(info);
          playUrl = info.proxyUrl;
        }

        ensureAudioGraph();

        const preloaded = gaplessPreloadedUrlRef.current;
        const canUseGaplessDeck =
          !useCrossfade &&
          preloaded &&
          preloaded.videoId === track.videoId &&
          preloaded.url === playUrl;
        gaplessPreloadedUrlRef.current = null;

        const outgoingDeck = activeDeckRef.current;
        const incomingDeck =
          useCrossfade || canUseGaplessDeck ? getStandbyDeck() : outgoingDeck;
        const outAudio = outgoingDeck === "A" ? audioARef.current : audioBRef.current;
        const inAudio = incomingDeck === "A" ? audioARef.current : audioBRef.current;
        const outGain = outgoingDeck === "A" ? gainARef.current : gainBRef.current;
        const inGain = incomingDeck === "A" ? gainARef.current : gainBRef.current;

        if (!inAudio) return;

        // Hard cut / gapless switch: stop the other deck cleanly
        if (!useCrossfade) {
          const otherAudio = incomingDeck === "A" ? audioBRef.current : audioARef.current;
          const otherGain = incomingDeck === "A" ? gainBRef.current : gainARef.current;
          if (otherAudio) {
            otherAudio.pause();
            otherAudio.currentTime = 0;
          }
          if (audioCtxRef.current && inGain && otherGain) {
            const t = audioCtxRef.current.currentTime;
            inGain.gain.cancelScheduledValues(t);
            inGain.gain.setValueAtTime(1, t);
            otherGain.gain.cancelScheduledValues(t);
            otherGain.gain.setValueAtTime(0, t);
          }
        }

        activeDeckRef.current = incomingDeck;
        setActiveDeck(incomingDeck);

        if (!canUseGaplessDeck || inAudio.src !== playUrl) {
          inAudio.src = playUrl;
        }
        inAudio.currentTime = 0;

        if (resumeSeekSec > 0) {
          const applySeek = () => {
            if (playRequestIdRef.current !== reqId) return;
            if (Number.isFinite(inAudio.duration) && resumeSeekSec < inAudio.duration) {
              inAudio.currentTime = resumeSeekSec;
            }
          };
          inAudio.addEventListener("loadedmetadata", applySeek, { once: true });
        }

        if (useCrossfade && audioCtxRef.current && outGain && inGain && incomingDeck !== outgoingDeck) {
          const fadeDur = Math.max(1.5, Math.min(12, crossfadeSecRef.current));
          const now = audioCtxRef.current.currentTime;

          inGain.gain.cancelScheduledValues(now);
          inGain.gain.setValueAtTime(0.001, now);
          inGain.gain.linearRampToValueAtTime(1, now + fadeDur);

          outGain.gain.cancelScheduledValues(now);
          outGain.gain.setValueAtTime(outGain.gain.value || 1, now);
          outGain.gain.linearRampToValueAtTime(0.001, now + fadeDur);

          // Dedicated DJ Bass-Swap dip without altering user's 10-band EQ
          if (djBassSwapFilterRef.current) {
            djBassSwapFilterRef.current.gain.setTargetAtTime(-4.5, now, 0.25);
            djBassSwapFilterRef.current.gain.setTargetAtTime(0, now + fadeDur * 0.65, 0.35);
          }

          setCrossfadeActive(true);
          if (djEnabledRef.current) {
            speakDjTransition(track);
          }

          await inAudio.play();
          if (playRequestIdRef.current !== reqId) return;
          setIsPlaying(true);
          setIsBuffering(false);
          syncOsMediaSession(track, true, inAudio.currentTime, inAudio.duration || track.durationSeconds);

          crossfadeCleanupTimerRef.current = window.setTimeout(() => {
            if (outAudio) {
              outAudio.pause();
              outAudio.currentTime = 0;
            }
            setCrossfadeActive(false);
          }, fadeDur * 1000 + 80);
        } else {
          if (audioCtxRef.current && inGain) {
            const now = audioCtxRef.current.currentTime;
            inGain.gain.cancelScheduledValues(now);
            inGain.gain.setValueAtTime(1, now);
          }
          await inAudio.play();
          if (playRequestIdRef.current !== reqId) return;
          setIsPlaying(true);
          setIsBuffering(false);
          syncOsMediaSession(track, true, inAudio.currentTime, inAudio.duration || track.durationSeconds);
        }

        window.setTimeout(() => void refreshEngineStatus(), 4000);
      } catch (err) {
        if (playRequestIdRef.current !== reqId) return;
        setIsBuffering(false);
        setIsPlaying(false);
        syncOsMediaSession(track, false, 0, track.durationSeconds);
        showToast(`串流播放失敗 (${track.title}): ${String(err)}`, true);
      }
    },
    [
      appendRecommendations,
      cancelPendingCrossfade,
      ensureAudioGraph,
      getStandbyDeck,
      loadMetadataAndLyrics,
      refreshEngineStatus,
      resolveLocalTrackProxyUrl,
      showToast,
      speakDjTransition,
      syncOsMediaSession,
    ]
  );

  const playIndexRef = useRef(playQueueIndex);
  playIndexRef.current = playQueueIndex;

  const playSingleTrack = useCallback(
    (track: Track) => {
      const lead = { ...track, isAutoRecommended: false };
      const initialQueue = [lead];
      queueRef.current = initialQueue;
      setQueue(initialQueue);
      void playQueueIndex(0, false, true);

      if (!track.localFileUrl && !track.localFilePath && !track.videoId.startsWith("local-")) {
        const capturedReqId = playRequestIdRef.current;
        setFetchingRecs(true);
        getRecommendations(track.videoId)
          .then((recs) => {
            if (playRequestIdRef.current !== capturedReqId) return;
            const filtered = recs
              .filter((r) => r.videoId !== track.videoId)
              .slice(0, 15)
              .map((r) => ({ ...r, isAutoRecommended: true }));
            if (filtered.length > 0) {
              const nextQueue = [lead, ...filtered];
              queueRef.current = nextQueue;
              setQueue(nextQueue);
              prefetchStream(filtered[0].videoId, qualityRef.current).catch(() => {});
            }
          })
          .catch(() => {})
          .finally(() => {
            if (playRequestIdRef.current === capturedReqId) {
              setFetchingRecs(false);
            }
          });
      }
    },
    [playQueueIndex]
  );

  const playTrackFromList = useCallback(
    (track: Track, list?: Track[]) => {
      if (list && list.length > 0) {
        const foundIdx = list.findIndex((t) => t.videoId === track.videoId);
        const nextQueue = list.map((t) => ({ ...t, isAutoRecommended: false }));
        const targetIdx = foundIdx >= 0 ? foundIdx : 0;
        queueRef.current = nextQueue;
        setQueue(nextQueue);
        void playQueueIndex(targetIdx, false);
      } else {
        const existingIdx = queueRef.current.findIndex((t) => t.videoId === track.videoId);
        if (existingIdx >= 0) {
          void playQueueIndex(existingIdx, false);
          return;
        }
        const nextQueue = [...queueRef.current, { ...track, isAutoRecommended: false }];
        const targetIdx = nextQueue.length - 1;
        queueRef.current = nextQueue;
        setQueue(nextQueue);
        void playQueueIndex(targetIdx, false);
      }
    },
    [playQueueIndex]
  );

  const addTrackNext = useCallback(
    (track: Track) => {
      const cleanTrack = { ...track, isAutoRecommended: false };
      setQueue((prev) => {
        const filtered = prev.filter((t) => t.videoId !== cleanTrack.videoId);
        const curIdx = currentIndexRef.current;
        if (curIdx < 0 || curIdx >= filtered.length) {
          const next = [...filtered, cleanTrack];
          queueRef.current = next;
          return next;
        }
        const insertAt = Math.min(curIdx + 1, filtered.length);
        const next = [...filtered.slice(0, insertAt), cleanTrack, ...filtered.slice(insertAt)];
        queueRef.current = next;
        return next;
      });
      if (!cleanTrack.localFileUrl && !cleanTrack.localFilePath) {
        prefetchStream(cleanTrack.videoId, qualityRef.current).catch(() => {});
      }
      showToast(`已排入下一首播放: ${cleanTrack.title}`);
    },
    [showToast]
  );

  const addTrackToQueue = useCallback(
    (track: Track) => {
      const cleanTrack = { ...track, isAutoRecommended: false };
      let added = false;
      setQueue((prev) => {
        if (prev.some((t) => t.videoId === cleanTrack.videoId)) {
          return prev;
        }
        added = true;
        const next = [...prev, cleanTrack];
        queueRef.current = next;
        return next;
      });
      if (added) {
        showToast(`已加入佇列: ${cleanTrack.title}`);
      } else {
        showToast(`歌曲已在佇列中: ${cleanTrack.title}`);
      }
    },
    [showToast]
  );

  const removeFromQueue = useCallback((idx: number) => {
    setQueue((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      queueRef.current = next;

      const cur = currentIndexRef.current;
      if (idx < cur) {
        currentIndexRef.current = cur - 1;
        setCurrentIndex(cur - 1);
      } else if (idx === cur) {
        if (next.length === 0) {
          currentIndexRef.current = -1;
          setCurrentIndex(-1);
          setIsPlaying(false);
          if (audioARef.current) {
            audioARef.current.pause();
            audioARef.current.src = "";
          }
          if (audioBRef.current) {
            audioBRef.current.pause();
            audioBRef.current.src = "";
          }
        } else {
          const nextIdx = Math.min(idx, next.length - 1);
          setTimeout(() => void playIndexRef.current(nextIdx, false), 0);
        }
      }
      return next;
    });
  }, []);

  const clearUpcomingQueue = useCallback(() => {
    const cur = currentIndexRef.current;
    const q = queueRef.current;
    if (cur >= 0 && cur < q.length) {
      const kept = [q[cur]];
      queueRef.current = kept;
      setQueue(kept);
      currentIndexRef.current = 0;
      setCurrentIndex(0);
    } else {
      queueRef.current = [];
      setQueue([]);
      currentIndexRef.current = -1;
      setCurrentIndex(-1);
    }
    showToast("已清空待播佇列");
  }, [showToast]);

  const toggleFavorite = useCallback((track: Track) => {
    setFavorites((prev) => {
      const exists = prev.some((t) => t.videoId === track.videoId);
      if (exists) {
        return prev.filter((t) => t.videoId !== track.videoId);
      }
      return [{ ...track, isAutoRecommended: false }, ...prev];
    });
    toggleFavoriteDb(track)
      .then((persisted) => {
        setFavorites(persisted);
      })
      .catch(() => {});
  }, []);

  // Custom Playlist CRUD & Dedup Helpers
  const commitPlaylists = useCallback((next: CustomPlaylist[]) => {
    setPlaylists(next);
    void savePlaylistsDb(next).catch(() => {});
  }, []);

  const handleCreatePlaylist = useCallback(
    (nameInput?: string, initialTracks: Track[] = []) => {
      const cleanName = (nameInput ?? newPlaylistName).trim();
      if (!cleanName) {
        showToast("請輸入歌單名稱", true);
        return;
      }
      const created: CustomPlaylist = {
        id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        coverUrl: initialTracks[0]?.thumbnailUrl || null,
        createdAtMs: Date.now(),
        tracks: initialTracks,
      };
      const next = [created, ...playlists];
      commitPlaylists(next);
      setSelectedPlaylistId(created.id);
      if (!nameInput) setNewPlaylistName("");
      showToast(`✅ 已建立歌單「${cleanName}」`);
    },
    [commitPlaylists, newPlaylistName, playlists, showToast]
  );

  const handleAddTrackToPlaylist = useCallback(
    (playlistId: string, track: Track) => {
      const target = playlists.find((p) => p.id === playlistId);
      if (!target) return;
      if (target.tracks.some((t) => t.videoId === track.videoId)) {
        showToast(`「${track.title}」已在歌單「${target.name}」中（偵測重複，已略過）`);
        return;
      }
      const clean = { ...track, isAutoRecommended: false };
      const next = playlists.map((p) =>
        p.id === playlistId
          ? {
              ...p,
              coverUrl: p.coverUrl || clean.thumbnailUrl || null,
              tracks: [...p.tracks, clean],
            }
          : p
      );
      commitPlaylists(next);
      showToast(`已加入歌單「${target.name}」: ${track.title}`);
    },
    [commitPlaylists, playlists, showToast]
  );

  const handleDeduplicatePlaylist = useCallback(
    (playlistId: string) => {
      const target = playlists.find((p) => p.id === playlistId);
      if (!target) return;
      const seen = new Set<string>();
      const unique: Track[] = [];
      for (const t of target.tracks) {
        const key = `${t.videoId}::${t.title.toLowerCase()}`;
        if (!seen.has(t.videoId) && !seen.has(key)) {
          seen.add(t.videoId);
          seen.add(key);
          unique.push(t);
        }
      }
      const removed = target.tracks.length - unique.length;
      if (removed === 0) {
        showToast("此歌單沒有重複歌曲");
        return;
      }
      const next = playlists.map((p) => (p.id === playlistId ? { ...p, tracks: unique } : p));
      commitPlaylists(next);
      showToast(`🧹 已一鍵移除 ${removed} 首重複歌曲`);
    },
    [commitPlaylists, playlists, showToast]
  );

  const handleImportPlaylistUrl = useCallback(async () => {
    const raw = importPlaylistUrl.trim();
    if (!raw) return;
    setImportingPlaylist(true);
    try {
      const [title, tracks] = await importYoutubePlaylist(raw);
      handleCreatePlaylist(title, tracks);
      setImportPlaylistUrl("");
      showToast(`✨ 已匯入播放清單「${title}」（共 ${tracks.length} 首）`);
    } catch (err) {
      showToast(`匯入播放清單失敗: ${String(err)}`, true);
    } finally {
      setImportingPlaylist(false);
    }
  }, [handleCreatePlaylist, importPlaylistUrl, showToast]);

  const handleScanLocalLibrary = useCallback(
    async (customPath?: string) => {
      setScanningLocal(true);
      try {
        const [resolvedPath, tracks] = await scanLocalMusic(
          customPath !== undefined ? customPath : localFolderPath || undefined
        );
        setLocalFolderPath(resolvedPath);
        setLocalTracks(tracks);
        showToast(`🎵 掃描完成：在「${resolvedPath}」找到 ${tracks.length} 首本機無損/音訊檔`);
      } catch (err) {
        showToast(`掃描本機音樂資料夾失敗: ${String(err)}`, true);
      } finally {
        setScanningLocal(false);
      }
    },
    [localFolderPath, showToast]
  );

  const handleDownloadTrack = useCallback(
    async (track: Track) => {
      if (track.localFileUrl || track.localFilePath || track.videoId.startsWith("local-")) {
        showToast("此為本機音檔，無需下載");
        return;
      }
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.add(track.videoId);
        return next;
      });
      showToast(`正在下載離線音檔並封裝封面與標籤: ${track.title}...`);
      try {
        const res = await downloadTrack(track, qualityRef.current);
        showToast(`✅ 已離線儲存 (${res.format}): ${res.filePath}`);
        void refreshEngineStatus();
      } catch (err) {
        showToast(`離線下載失敗 (${track.title}): ${String(err)}`, true);
      } finally {
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(track.videoId);
          return next;
        });
      }
    },
    [refreshEngineStatus, showToast]
  );

  const handleNext = useCallback(
    async (allowCrossfade = false) => {
      const q = queueRef.current;
      const cur = currentIndexRef.current;
      if (q.length === 0) return;

      if (shuffleRef.current && q.length > 1) {
        let rand = Math.floor(Math.random() * q.length);
        if (rand === cur) {
          rand = (cur + 1) % q.length;
        }
        await playQueueIndex(rand, allowCrossfade);
        return;
      }

      if (cur + 1 < q.length) {
        await playQueueIndex(cur + 1, allowCrossfade);
        return;
      }

      if (
        autoRadioRef.current &&
        cur >= 0 &&
        q[cur] &&
        !q[cur].localFileUrl &&
        !q[cur].localFilePath
      ) {
        showToast("佇列已播完，正在為您自動推薦相關音樂...");
        const added = await appendRecommendations(q[cur].videoId, true);
        if (added) return;
      }

      if (repeatModeRef.current === "all") {
        await playQueueIndex(0, allowCrossfade);
      } else {
        setIsPlaying(false);
        if (cur >= 0 && q[cur]) {
          syncOsMediaSession(q[cur], false, 0, q[cur].durationSeconds);
        }
      }
    },
    [appendRecommendations, playQueueIndex, showToast, syncOsMediaSession]
  );

  const handlePrev = useCallback(() => {
    const audio = getActiveAudio();
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      setCurrentTime(0);
      if (currentTrack) {
        syncOsMediaSession(
          currentTrack,
          !audio.paused,
          0,
          audio.duration || currentTrack.durationSeconds
        );
      }
      return;
    }
    const q = queueRef.current;
    const cur = currentIndexRef.current;
    if (q.length === 0) return;
    if (cur > 0) {
      void playQueueIndex(cur - 1, false);
    } else if (repeatModeRef.current === "all") {
      void playQueueIndex(q.length - 1, false);
    }
  }, [currentTrack, getActiveAudio, playQueueIndex, syncOsMediaSession]);

  const togglePlayPause = useCallback(async () => {
    const audio = getActiveAudio();
    if (!audio) return;
    if (!currentTrack) {
      if (queueRef.current.length > 0) {
        await playQueueIndex(0, false);
      }
      return;
    }
    if (!audio.src || audio.src === window.location.href) {
      if (currentIndexRef.current >= 0) {
        const resumePos = restoredSeekSecRef.current > 0 ? restoredSeekSecRef.current : 0;
        await playQueueIndex(currentIndexRef.current, false, true, resumePos);
      }
      return;
    }
    if (audio.paused) {
      ensureAudioGraph();
      try {
        await audio.play();
        setIsPlaying(true);
        syncOsMediaSession(
          currentTrack,
          true,
          audio.currentTime,
          audio.duration || currentTrack.durationSeconds
        );
      } catch {
        // ignore
      }
    } else {
      audio.pause();
      setIsPlaying(false);
      syncOsMediaSession(
        currentTrack,
        false,
        audio.currentTime,
        audio.duration || currentTrack.durationSeconds
      );
    }
  }, [currentTrack, ensureAudioGraph, getActiveAudio, playQueueIndex, syncOsMediaSession]);

  const maybeTriggerCacheForAudio = useCallback(
    (deck: "A" | "B", audioEl: HTMLAudioElement) => {
      if (deck !== activeDeckRef.current) return;
      if (cacheTriggeredReqRef.current === playRequestIdRef.current) return;
      const track = queueRef.current[currentIndexRef.current];
      if (!track || track.localFileUrl || track.localFilePath || track.videoId.startsWith("local-")) {
        return;
      }
      const dur = audioEl.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;

      const playedRatio = audioEl.currentTime / dur;
      let maxBuffered = 0;
      for (let i = 0; i < audioEl.buffered.length; i++) {
        const end = audioEl.buffered.end(i);
        if (end > maxBuffered) maxBuffered = end;
      }
      const bufferedRatio = maxBuffered / dur;

      if (playedRatio >= 0.8 || bufferedRatio >= 0.8) {
        cacheTriggeredReqRef.current = playRequestIdRef.current;
        triggerAudioCache(track.videoId, qualityRef.current)
          .then((cachedNow) => {
            if (cachedNow) void refreshEngineStatus();
          })
          .catch(() => {});
      }
    },
    [refreshEngineStatus]
  );

  const handleTrackEnded = useCallback(
    async (deck: "A" | "B") => {
      if (deck !== activeDeckRef.current) return;
      const finishedTrack = queueRef.current[currentIndexRef.current];
      if (
        finishedTrack &&
        !finishedTrack.localFileUrl &&
        !finishedTrack.localFilePath &&
        !finishedTrack.videoId.startsWith("local-") &&
        cacheTriggeredReqRef.current !== playRequestIdRef.current
      ) {
        cacheTriggeredReqRef.current = playRequestIdRef.current;
        triggerAudioCache(finishedTrack.videoId, qualityRef.current)
          .then((cachedNow) => {
            if (cachedNow) void refreshEngineStatus();
          })
          .catch(() => {});
      }

      if (sleepModeRef.current === "track") {
        setIsPlaying(false);
        setSleepMode("off");
        showToast("🌙 已播完當前歌曲並為您停止播放");
        return;
      }

      if (repeatModeRef.current === "one") {
        const audio = getActiveAudio();
        if (audio) {
          audio.currentTime = 0;
          await audio.play().catch(() => {});
          setIsPlaying(true);
          if (finishedTrack) {
            syncOsMediaSession(
              finishedTrack,
              true,
              0,
              audio.duration || finishedTrack.durationSeconds
            );
          }
        }
        return;
      }
      await handleNext(false);
    },
    [getActiveAudio, handleNext, refreshEngineStatus, showToast, syncOsMediaSession]
  );

  const maybePreloadGaplessNext = useCallback(async () => {
    if (gaplessPreloadedReqRef.current === playRequestIdRef.current) return;
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    const nextIdx =
      idx + 1 < q.length ? idx + 1 : repeatModeRef.current === "all" && q.length > 0 ? 0 : -1;
    if (nextIdx < 0 || nextIdx === idx) return;

    const upcoming = q[nextIdx];
    if (!upcoming) return;

    gaplessPreloadedReqRef.current = playRequestIdRef.current;
    const capturedReq = playRequestIdRef.current;
    try {
      const url =
        upcoming.localFileUrl || upcoming.localFilePath
          ? await resolveLocalTrackProxyUrl(upcoming)
          : (await getStreamUrl(upcoming.videoId, qualityRef.current)).proxyUrl;

      if (!url || playRequestIdRef.current !== capturedReq) return;
      const standbyDeck = getStandbyDeck();
      const standbyEl = standbyDeck === "A" ? audioARef.current : audioBRef.current;
      if (!standbyEl) return;
      standbyEl.src = url;
      standbyEl.load();
      gaplessPreloadedUrlRef.current = {
        videoId: upcoming.videoId,
        url,
        deck: standbyDeck,
      };
    } catch {
      // fallback gracefully on ended
    }
  }, [getStandbyDeck, resolveLocalTrackProxyUrl]);

  const handleTimeUpdateForDeck = useCallback(
    (deck: "A" | "B", audioEl: HTMLAudioElement) => {
      if (deck !== activeDeckRef.current) return;
      const curTime = audioEl.currentTime;
      const dur = audioEl.duration;
      setCurrentTime(curTime);
      maybeTriggerCacheForAudio(deck, audioEl);

      const nowMs = Date.now();
      if (nowMs - lastSmtcSyncAtRef.current >= 4000) {
        lastSmtcSyncAtRef.current = nowMs;
        const track = queueRef.current[currentIndexRef.current];
        if (track) {
          syncOsMediaSession(
            track,
            !audioEl.paused,
            curTime,
            Number.isFinite(dur) ? dur : track.durationSeconds
          );
        }
      }

      const effectiveFade = djEnabledRef.current
        ? Math.max(3, crossfadeSecRef.current)
        : crossfadeSecRef.current;

      if (effectiveFade === 0 && Number.isFinite(dur) && dur > 8 && dur - curTime <= 10) {
        void maybePreloadGaplessNext();
      }

      if (
        effectiveFade > 0 &&
        Number.isFinite(dur) &&
        dur > effectiveFade + 5 &&
        repeatModeRef.current !== "one"
      ) {
        const remaining = dur - curTime;
        if (
          remaining <= effectiveFade &&
          remaining > 0.4 &&
          crossfadeTriggeredReqRef.current !== playRequestIdRef.current
        ) {
          const q = queueRef.current;
          const idx = currentIndexRef.current;
          if (idx + 1 < q.length) {
            crossfadeTriggeredReqRef.current = playRequestIdRef.current;
            void playQueueIndex(idx + 1, true);
          }
        }
      }
    },
    [maybePreloadGaplessNext, maybeTriggerCacheForAudio, playQueueIndex, syncOsMediaSession]
  );

  const startDjVibe = useCallback(
    async (vibe: DjVibeOption) => {
      setDjVibe(vibe.id);
      setDjEnabled(true);
      setAutoRadio(true);
      if (crossfadeSecRef.current === 0) {
        setCrossfadeSec(5);
      }
      setDjLoading(true);
      try {
        const tracks = await searchMusic(vibe.query, "songs");
        if (tracks.length === 0) {
          showToast("暫時找不到此 DJ 風格曲目", true);
          return;
        }
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        const seed = shuffled[0];
        let recs: Track[] = [];
        if (seed && !seed.localFileUrl) {
          recs = await getRecommendations(seed.videoId).catch(() => []);
        }
        const seen = new Set<string>([seed.videoId]);
        const merged: Track[] = [seed];
        for (const t of [...recs, ...shuffled.slice(1)]) {
          if (!seen.has(t.videoId)) {
            seen.add(t.videoId);
            merged.push(t);
          }
        }
        const djQueue = merged.map((t) => ({ ...t, isAutoRecommended: true }));
        queueRef.current = djQueue;
        setQueue(djQueue);
        speakDjTransition(djQueue[0], vibe.label);
        await playQueueIndex(0, isPlaying, true);
      } catch (err) {
        showToast(`啟動 AI DJ Mix 失敗: ${String(err)}`, true);
      } finally {
        setDjLoading(false);
      }
    },
    [isPlaying, playQueueIndex, showToast, speakDjTransition]
  );

  const handleToggleDj = useCallback(() => {
    if (djEnabled) {
      setDjEnabled(false);
      showToast("已關閉 AI DJ Mix 自動混音");
    } else {
      const vibe = DJ_VIBES.find((v) => v.id === djVibe) ?? DJ_VIBES[0];
      void startDjVibe(vibe);
    }
  }, [djEnabled, djVibe, showToast, startDjVibe]);

  const handleImportLocalLossless = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const imported: Track[] = Array.from(files).map((file, idx) => {
        const cleanName = file.name.replace(/\.[^.]+$/, "");
        return {
          videoId: `local-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          title: cleanName,
          artist: "本機無損音檔",
          album: file.name.split(".").pop()?.toUpperCase() || "LOSSLESS",
          durationText: "Local",
          durationSeconds: 0,
          thumbnailUrl: currentTrack?.thumbnailUrl || "",
          isAutoRecommended: false,
          localFileUrl: URL.createObjectURL(file),
          isLosslessLocal: true,
        };
      });

      const startIdx = queueRef.current.length;
      const nextQueue = [...queueRef.current, ...imported];
      queueRef.current = nextQueue;
      setQueue(nextQueue);
      showToast(`已匯入 ${imported.length} 首本機無損音檔`);
      void playQueueIndex(startIdx, false);
    },
    [currentTrack?.thumbnailUrl, playQueueIndex, showToast]
  );

  const handleSearchSubmit = useCallback(
    async (e?: React.FormEvent, overrideQuery?: string, overrideFilter?: SearchFilter) => {
      if (e) e.preventDefault();
      const q = (overrideQuery ?? searchQuery).trim();
      const f = overrideFilter ?? searchFilter;
      if (!q) return;

      setNavTab("search");
      setSearchLoading(true);
      setSearchSuggestions([]);
      setSearchHistory((prev) => {
        const next = [q, ...prev.filter((item) => item !== q)].slice(0, 14);
        void saveSearchHistoryDb(next).catch(() => {});
        return next;
      });

      try {
        const res = await searchMusic(q, f);
        setSearchResults(res);
      } catch (err) {
        showToast(`搜尋失敗: ${String(err)}`, true);
      } finally {
        setSearchLoading(false);
      }
    },
    [searchFilter, searchQuery, showToast]
  );

  const seekTo = useCallback(
    (sec: number) => {
      const audio = getActiveAudio();
      if (!audio) return;
      const clamped = Math.max(0, Math.min(sec, audio.duration || sec));
      audio.currentTime = clamped;
      setCurrentTime(clamped);
      if (currentTrack) {
        syncOsMediaSession(
          currentTrack,
          isPlaying,
          clamped,
          audio.duration || currentTrack.durationSeconds
        );
      }
    },
    [currentTrack, getActiveAudio, isPlaying, syncOsMediaSession]
  );

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => (prev === "off" ? "all" : prev === "all" ? "one" : "off"));
  }, []);

  const updateLyricOffsetForCurrent = useCallback(
    (nextOffset: number) => {
      setLyricsOffset(nextOffset);
      if (currentTrack) {
        setLyricsOffsetsMap((prev) => {
          const updated = { ...prev };
          if (Math.abs(nextOffset) < 0.01) delete updated[currentTrack.videoId];
          else updated[currentTrack.videoId] = nextOffset;
          return updated;
        });
        void saveLyricsOffsetDb(currentTrack.videoId, nextOffset).catch(() => {});
      }
    },
    [currentTrack]
  );

  const togglePlayPauseRef = useRef(togglePlayPause);
  togglePlayPauseRef.current = togglePlayPause;
  const handleNextRef = useRef(handleNext);
  handleNextRef.current = handleNext;
  const handlePrevRef = useRef(handlePrev);
  handlePrevRef.current = handlePrev;
  const seekToRef = useRef(seekTo);
  seekToRef.current = seekTo;
  const persistSnapshotRef = useRef(persistSnapshot);
  persistSnapshotRef.current = persistSnapshot;
  const toggleMiniModeRef = useRef(toggleMiniMode);
  toggleMiniModeRef.current = toggleMiniMode;

  // Keyboard & global shortcut combinations (Ctrl/Cmd+Alt+Space / Left / Right / M + Media Keys)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "MediaTrackNext") {
        e.preventDefault();
        void handleNextRef.current(false);
        return;
      }
      if (e.key === "MediaTrackPrevious") {
        e.preventDefault();
        handlePrevRef.current();
        return;
      }
      if (e.key === "MediaPlayPause") {
        e.preventDefault();
        void togglePlayPauseRef.current();
        return;
      }
      if (e.key === "MediaStop") {
        e.preventDefault();
        const audio = getActiveAudio();
        if (audio) audio.pause();
        setIsPlaying(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.altKey) {
        if (e.code === "Space") {
          e.preventDefault();
          void togglePlayPauseRef.current();
          return;
        }
        if (e.code === "ArrowRight") {
          e.preventDefault();
          void handleNextRef.current(djEnabledRef.current || crossfadeSecRef.current > 0);
          return;
        }
        if (e.code === "ArrowLeft") {
          e.preventDefault();
          handlePrevRef.current();
          return;
        }
        if (e.code === "KeyM") {
          e.preventDefault();
          void toggleMiniModeRef.current();
          return;
        }
      }

      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.code === "Space") {
        e.preventDefault();
        void togglePlayPause();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seekTo(currentTime + 5);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekTo(currentTime - 5);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentTime, getActiveAudio, seekTo, togglePlayPause]);

  // OS Media Controls (Windows SMTC / macOS Now Playing / Linux MPRIS / Chromium MediaSession)
  useEffect(() => {
    try {
      if ("mediaSession" in navigator) {
        const ms = navigator.mediaSession;
        ms.setActionHandler("play", () => {
          const audio = getActiveAudio();
          if (!audio || audio.paused) {
            void togglePlayPauseRef.current();
          }
        });
        ms.setActionHandler("pause", () => {
          const audio = getActiveAudio();
          if (audio && !audio.paused) {
            void togglePlayPauseRef.current();
          }
        });
        ms.setActionHandler("previoustrack", () => handlePrevRef.current());
        ms.setActionHandler("nexttrack", () => void handleNextRef.current(false));
        ms.setActionHandler("seekto", (details) => {
          if (typeof details.seekTime === "number") {
            seekToRef.current(details.seekTime);
          }
        });
        ms.setActionHandler("seekbackward", (details) => {
          const cur = getActiveAudio()?.currentTime ?? 0;
          seekToRef.current(cur - (details.seekOffset || 10));
        });
        ms.setActionHandler("seekforward", (details) => {
          const cur = getActiveAudio()?.currentTime ?? 0;
          seekToRef.current(cur + (details.seekOffset || 10));
        });
      }
    } catch {
      // ignore unsupported MediaSession action handlers
    }

    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      try {
        if (cancelled) return;
        const u1 = await listen<string>("smtc-action", (event) => {
          const action = event.payload;
          const audio = getActiveAudio();
          if (action === "play") {
            if (!audio || audio.paused) void togglePlayPauseRef.current();
          } else if (action === "pause" || action === "stop") {
            if (audio && !audio.paused) void togglePlayPauseRef.current();
          } else if (action === "toggle") {
            void togglePlayPauseRef.current();
          } else if (action === "next") {
            void handleNextRef.current(djEnabledRef.current || crossfadeSecRef.current > 0);
          } else if (action === "prev") {
            handlePrevRef.current();
          }
        });
        const u2 = await listen<number>("smtc-seek", (event) => {
          if (typeof event.payload === "number") {
            seekToRef.current(event.payload);
          }
        });
        const u3 = await listen<number>("smtc-seek-relative", (event) => {
          if (typeof event.payload === "number") {
            const cur = getActiveAudio()?.currentTime ?? 0;
            seekToRef.current(cur + event.payload);
          }
        });
        const u4 = await listen("app-will-close", () => {
          persistSnapshotRef.current();
        });
        if (cancelled) {
          u1();
          u2();
          u3();
          u4();
        } else {
          unlisteners.push(u1, u2, u3, u4);
        }
      } catch {
        // non-Tauri browser preview environment
      }
    })();

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [getActiveAudio]);

  // Compute active lyric line index
  const activeLyricIndex = useMemo(() => {
    if (!lyrics?.hasSynced || lyrics.syncedLines.length === 0) return -1;
    const adjustedMs = (currentTime + lyricsOffset) * 1000;
    let active = -1;
    for (let i = 0; i < lyrics.syncedLines.length; i++) {
      if (lyrics.syncedLines[i].timeMs <= adjustedMs) {
        active = i;
      } else {
        break;
      }
    }
    return active;
  }, [currentTime, lyrics, lyricsOffset]);

  useEffect(() => {
    if (activeLyricIndex < 0) return;
    if (navTab === "lyrics") {
      lyricsMainActiveRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (sidePanelOpen && sideTab === "lyrics") {
      lyricsSideActiveRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLyricIndex, navTab, sidePanelOpen, sideTab]);

  // Derived collections for Home Jump Back In, Search highlights, Playlists, and Sound Capsule
  const jumpBackInTracks = useMemo(() => {
    const merged: Track[] = [];
    const seen = new Set<string>();
    for (const t of [...history, ...favorites]) {
      if (seen.add(t.videoId)) merged.push(t);
      if (merged.length >= 10) break;
    }
    return merged;
  }, [favorites, history]);

  const searchEntityHighlights = useMemo(() => {
    if (searchFilter !== "artists" && searchFilter !== "albums") return [];
    const items: Array<{ name: string; sub: string; thumb: string; kind: "artist" | "album" }> = [];
    const seen = new Set<string>();
    for (const t of searchResults) {
      if (searchFilter === "artists") {
        if (t.artist && t.artist !== "未知藝人" && seen.add(t.artist.toLowerCase())) {
          items.push({
            name: t.artist,
            sub: `代表曲：${t.title}`,
            thumb: t.thumbnailUrl,
            kind: "artist",
          });
        }
      } else if (t.album && t.album !== "單曲" && seen.add(t.album.toLowerCase())) {
        items.push({
          name: t.album,
          sub: t.artist,
          thumb: t.thumbnailUrl,
          kind: "album",
        });
      }
      if (items.length >= 6) break;
    }
    return items;
  }, [searchFilter, searchResults]);

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === selectedPlaylistId) ?? playlists[0] ?? null,
    [playlists, selectedPlaylistId]
  );

  const displayedPlaylistTracks = useMemo(() => {
    if (!activePlaylist) return [];
    let list = [...activePlaylist.tracks];
    const kw = playlistFilter.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(kw) ||
          t.artist.toLowerCase().includes(kw) ||
          t.album.toLowerCase().includes(kw)
      );
    }
    if (playlistSort === "title") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (playlistSort === "artist") {
      list.sort((a, b) => a.artist.localeCompare(b.artist));
    }
    return list;
  }, [activePlaylist, playlistFilter, playlistSort]);

  const soundCapsuleData = useMemo(() => {
    const trackLookup = new Map<string, Track>();
    for (const t of [...history, ...favorites, ...localTracks, ...queue]) {
      if (!trackLookup.has(t.videoId)) trackLookup.set(t.videoId, t);
    }
    const topTracks = Object.entries(listeningStats.trackPlayCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([vid, count]) => ({ track: trackLookup.get(vid), vid, count }))
      .filter((x): x is { track: Track; vid: string; count: number } => Boolean(x.track));

    const topArtists = Object.entries(listeningStats.artistPlayCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const monthSec = listeningStats.monthlyListenSeconds[currentMonthKey()] ?? 0;
    const totalPlays = Object.values(listeningStats.trackPlayCounts).reduce((a, b) => a + b, 0);
    return { topTracks, topArtists, monthSec, totalPlays };
  }, [favorites, history, listeningStats, localTracks, queue]);

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const volumePct = (muted ? 0 : volume) * 100;

  const createDeckHandlers = (deck: "A" | "B") => ({
    onTimeUpdate: (e: React.SyntheticEvent<HTMLAudioElement>) =>
      handleTimeUpdateForDeck(deck, e.currentTarget),
    onProgress: (e: React.SyntheticEvent<HTMLAudioElement>) =>
      maybeTriggerCacheForAudio(deck, e.currentTarget),
    onDurationChange: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      if (activeDeckRef.current === deck) {
        const d = e.currentTarget.duration;
        if (Number.isFinite(d) && d > 0) setDuration(d);
      }
    },
    onPlaying: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      if (activeDeckRef.current !== deck) return;
      setIsPlaying(true);
      setIsBuffering(false);
      const track = queueRef.current[currentIndexRef.current];
      if (track) {
        syncOsMediaSession(
          track,
          true,
          e.currentTarget.currentTime,
          e.currentTarget.duration || track.durationSeconds
        );
      }
    },
    onPause: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      if (activeDeckRef.current !== deck || crossfadeActive) return;
      setIsPlaying(false);
      const track = queueRef.current[currentIndexRef.current];
      if (track) {
        syncOsMediaSession(
          track,
          false,
          e.currentTarget.currentTime,
          e.currentTarget.duration || track.durationSeconds
        );
      }
      persistSnapshot();
    },
    onWaiting: () => {
      if (activeDeckRef.current === deck) setIsBuffering(true);
    },
    onCanPlay: () => {
      if (activeDeckRef.current === deck) setIsBuffering(false);
    },
    onEnded: () => void handleTrackEnded(deck),
    onError: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const el = e.currentTarget;
      if (
        activeDeckRef.current === deck &&
        streamInfo?.directUrl &&
        el.src !== streamInfo.directUrl &&
        !el.src.startsWith("blob:")
      ) {
        el.src = streamInfo.directUrl;
        void el.play().catch(() => {
          setIsBuffering(false);
          setIsPlaying(false);
        });
        return;
      }
      if (activeDeckRef.current === deck) {
        setIsBuffering(false);
        setIsPlaying(false);
      }
    },
  });

  return (
    <div className="app-shell" data-glass={glassMode}>
      {showSplash && !miniMode && <StartupSplash onFinish={() => setShowSplash(false)} />}

      {/* Dual-Deck Audio Elements (always mounted even in Mini Player mode) */}
      <audio
        ref={audioARef}
        crossOrigin="anonymous"
        preload="auto"
        {...createDeckHandlers("A")}
      />
      <audio
        ref={audioBRef}
        crossOrigin="anonymous"
        preload="auto"
        {...createDeckHandlers("B")}
      />

      {miniMode ? (
        <div className="mini-player-shell">
          <div className="mini-player-top">
            {currentTrack ? (
              <AlbumArt
                thumbnailUrl={currentTrack.thumbnailUrl}
                videoId={currentTrack.videoId}
                title={currentTrack.title}
                artist={currentTrack.artist}
                className="mini-player-art"
              />
            ) : (
              <div className="mini-player-art" style={{ background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Disc3 size={24} />
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>
                {currentTrack?.title || "AetherMusic 迷你播放器"}
              </div>
              <div className="truncate" style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                {currentTrack?.artist || "尚未播放曲目"}
              </div>
            </div>
            <button
              type="button"
              className="ctrl-btn"
              title="還原完整視窗"
              onClick={() => void toggleMiniMode()}
            >
              <Maximize2 size={16} />
            </button>
          </div>

          <div className="progress-row">
            <span className="time-label tabular-nums">{formatTime(currentTime)}</span>
            <input
              type="range"
              className="range-slider"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.1}
              value={Math.min(currentTime, duration > 0 ? duration : 100)}
              style={{ "--progress": `${progressPct}%` } as React.CSSProperties}
              onChange={(e) => seekTo(Number(e.target.value))}
              disabled={!currentTrack}
            />
            <span className="time-label tabular-nums">{formatTime(duration)}</span>
          </div>

          <div className="mini-player-controls">
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              v{appVersion} · Deck {activeDeck}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" className="ctrl-btn" onClick={handlePrev} disabled={!currentTrack}>
                <SkipBack size={16} fill="currentColor" />
              </button>
              <button
                type="button"
                className="play-main-btn"
                style={{ width: 34, height: 34 }}
                onClick={() => void togglePlayPause()}
              >
                {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
              </button>
              <button
                type="button"
                className="ctrl-btn"
                onClick={() => void handleNext(djEnabled || crossfadeSec > 0)}
                disabled={!currentTrack}
              >
                <SkipForward size={16} fill="currentColor" />
              </button>
            </div>
            <SpectrumCanvas analyser={analyser} isPlaying={isPlaying} variant="mini" mode={visualizerStyle} />
          </div>
        </div>
      ) : (
        <>
          <div className="aurora-mesh" />
          <div
            className="ambient-backdrop"
            style={{
              backgroundImage: currentTrack
                ? `url("${currentTrack.thumbnailUrl || buildFallbackCoverSvgDataUrl(currentTrack.title, currentTrack.artist, currentTrack.videoId)}")`
                : undefined,
            }}
          />

          <div className={`main-workspace ${sidePanelOpen ? "" : "panel-collapsed"}`}>
            {/* Left Navigation Sidebar */}
            <aside className="sidebar">
              <div className="sidebar-scroll">
                <div className="brand-header">
                  <div className="brand-logo">
                    <img src={appIconUrl} alt="AetherMusic" className="brand-logo-img" />
                  </div>
                  <div className="brand-title-group">
                    <div className="brand-name truncate">AetherMusic</div>
                    <div className="brand-sub truncate">Pure Direct · AI DJ · Cross-Platform</div>
                  </div>
                </div>

                <nav className="nav-section">
                  <div className="nav-section-label">探索與混音</div>
                  <button
                    type="button"
                    className={`nav-item ${navTab === "home" ? "active" : ""}`}
                    onClick={() => setNavTab("home")}
                  >
                    <Home size={17} />
                    <span className="truncate">探索首頁</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${navTab === "search" ? "active" : ""}`}
                    onClick={() => setNavTab("search")}
                  >
                    <Search size={17} />
                    <span className="truncate">搜尋音樂</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${navTab === "dj" ? "active" : ""}`}
                    onClick={() => setNavTab("dj")}
                  >
                    <Radio size={17} />
                    <span className="truncate">AI DJ Mix</span>
                    <span className={`nav-badge ${djEnabled ? "dj" : ""}`}>
                      {djEnabled ? "LIVE" : "DJ"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${navTab === "lyrics" ? "active" : ""}`}
                    onClick={() => setNavTab("lyrics")}
                  >
                    <Mic2 size={17} />
                    <span className="truncate">動態歌詞</span>
                    {lyrics?.hasSynced && <span className="nav-badge">SYNC</span>}
                  </button>
                </nav>

                <nav className="nav-section">
                  <div className="nav-section-label">媒體與系統</div>
                  <button
                    type="button"
                    className={`nav-item ${navTab === "queue" ? "active" : ""}`}
                    onClick={() => setNavTab("queue")}
                  >
                    <ListMusic size={17} />
                    <span className="truncate">播放佇列</span>
                    <span className="nav-badge tabular-nums">{queue.length}</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${navTab === "library" ? "active" : ""}`}
                    onClick={() => setNavTab("library")}
                  >
                    <Library size={17} />
                    <span className="truncate">收藏與紀錄</span>
                    <span className="nav-badge tabular-nums">{favorites.length}</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-item ${navTab === "settings" ? "active" : ""}`}
                    onClick={() => setNavTab("settings")}
                  >
                    <Settings size={17} />
                    <span className="truncate">音質・更新・授權</span>
                    {(updateStatus?.appUpdateAvailable || updateStatus?.ytdlpUpdateAvailable) && (
                      <span className="nav-badge dj">NEW</span>
                    )}
                  </button>
                </nav>

                <div className="sidebar-footer">
                  <div className="status-row">
                    <div className="status-dot-wrap">
                      <span
                        className={`status-dot ${engineStatus?.ytmapiReady !== false ? "ok" : "warn"}`}
                      />
                      <span className="truncate">YTMAPI / InnerTube</span>
                    </div>
                    <span style={{ color: "#10b981", fontWeight: 600 }}>就緒</span>
                  </div>
                  <div className="status-row">
                    <div className="status-dot-wrap">
                      <span className="status-dot ok" />
                      <span className="truncate">
                        {engineStatus?.ytdlpAvailable ? "yt-dlp 串流" : "純 Rust 串流"}
                      </span>
                    </div>
                    <span className="truncate" style={{ maxWidth: 82, color: "var(--text-secondary)" }}>
                      {engineStatus?.ytdlpAvailable
                        ? engineStatus.ytdlpVersion
                        : engineStatus?.platform || "active"}
                    </span>
                  </div>
                  <div className="status-row" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                    <span className="tabular-nums">
                      v{appVersion} · Deck {activeDeck}
                    </span>
                    <span className="tabular-nums">
                      {engineStatus?.proxyPort ? `:${engineStatus.proxyPort}` : ""}
                    </span>
                  </div>
                </div>
              </div>
            </aside>

            {/* Center Main Workspace */}
            <main className="center-pane">
              <header className="top-header">
                <form className="search-form" onSubmit={(e) => void handleSearchSubmit(e)}>
                  <Search size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <input
                    type="text"
                    className="search-input"
                    placeholder="搜尋歌曲、藝人、專輯或歌單 (YTMAPI)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      style={{ color: "var(--text-muted)", display: "flex" }}
                      title="清除搜尋"
                    >
                      <X size={14} />
                    </button>
                  )}
                  <button type="submit" className="search-submit-btn">
                    搜尋
                  </button>
                </form>

                <div className="header-actions">
                  <button
                    type="button"
                    className={`icon-pill-btn ${audioQuality === "lossless" ? "active" : ""}`}
                    onClick={() => {
                      const next: AudioQuality =
                        audioQuality === "lossless"
                          ? "high"
                          : audioQuality === "high"
                            ? "standard"
                            : "lossless";
                      setAudioQuality(next);
                      showToast(
                        next === "lossless"
                          ? "已切換為最高音質串流 (Pure Direct)"
                          : next === "high"
                            ? "已切換為極高音質模式 (AAC/M4A)"
                            : "已切換為標準省流模式"
                      );
                    }}
                    title="切換音質檔位 (最高音質 / 極高 / 標準)"
                  >
                    <Sparkles size={13} />
                    <span>
                      {audioQuality === "lossless"
                        ? "最高音質"
                        : audioQuality === "high"
                          ? "高音質"
                          : "標準省流"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`icon-pill-btn ${glassMode === "acrylic" ? "active" : ""}`}
                    onClick={() => setGlassMode((m) => (m === "acrylic" ? "lite" : "acrylic"))}
                    title="切換質感深色霧面 / 純淨極簡深黑"
                  >
                    <span>{glassMode === "acrylic" ? "深色霧面" : "純淨深黑"}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-pill-btn"
                    onClick={() => void toggleMiniMode()}
                    title="切換精簡迷你播放器模式 (Ctrl+Alt+M)"
                  >
                    <Minimize2 size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-pill-btn"
                    onClick={() => setSidePanelOpen((v) => !v)}
                    title={sidePanelOpen ? "收合右側面板" : "展開右側面板"}
                  >
                    {sidePanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                  </button>
                </div>
              </header>

              <div className="center-scroll">
                {toast && (
                  <div className={`toast-banner ${toast.isError ? "error" : ""}`}>
                    <span className="truncate">{toast.message}</span>
                    <button type="button" onClick={() => setToast(null)}>
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* HOME VIEW */}
                {navTab === "home" && (
                  <div>
                    <section className="hero-banner">
                      <div style={{ minWidth: 0 }}>
                        <div className="hero-eyebrow">
                          <Compass size={14} />
                          <span>PURE DIRECT 無壓縮直通 × 10-BAND EQ × AI DJ MIX · v{appVersion}</span>
                        </div>
                        <h1 className="hero-title truncate">
                          {currentTrack ? `正在聆聽：${currentTrack.title}` : "探索無界雲端音樂"}
                        </h1>
                        <p className="hero-desc">
                          {currentTrack
                            ? `${currentTrack.artist}${streamInfo ? ` · ${streamInfo.qualityLabel} (${streamInfo.acodec})` : ""}`
                            : "支援 yt-dlp + 純 Rust InnerTube 跨平臺串流、無縫 Gapless/Crossfade 混音、10 段 EQ 與動態頻譜。"}
                        </p>
                        <div className="hero-actions">
                          <button
                            type="button"
                            className="primary-btn"
                            onClick={() => {
                              if (!djEnabled) {
                                setNavTab("dj");
                                handleToggleDj();
                              } else {
                                setNavTab("dj");
                              }
                            }}
                          >
                            <Radio size={15} />
                            {djEnabled ? "前往 AI DJ 混音台" : "啟動 AI DJ 連播"}
                          </button>
                          {currentTrack ? (
                            <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => setNavTab("lyrics")}
                            >
                              <Mic2 size={15} />
                              動態歌詞與頻譜
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => void loadHome(soundCapsuleData.topArtists[0]?.[0])}
                              disabled={homeLoading}
                            >
                              <RefreshCw size={15} className={homeLoading ? "spin" : ""} />
                              重新整理推薦
                            </button>
                          )}
                        </div>
                      </div>

                      {currentTrack && (
                        <AlbumArt
                          thumbnailUrl={currentTrack.thumbnailUrl}
                          videoId={currentTrack.videoId}
                          title={currentTrack.title}
                          artist={currentTrack.artist}
                          className="hero-art"
                        />
                      )}
                    </section>

                    <div className="filter-bar">
                      <div className="chip-row">
                        {QUICK_GENRES.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className="chip-btn"
                            onClick={() => {
                              setSearchQuery(tag);
                              void handleSearchSubmit(undefined, tag, searchFilter);
                            }}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Jump Back In (近期常聽) */}
                    {jumpBackInTracks.length > 0 && (
                      <section className="section-block">
                        <div className="section-header">
                          <div style={{ minWidth: 0 }}>
                            <h2 className="section-title truncate">近期常聽 · Jump Back In</h2>
                            <p className="section-sub truncate">快速回到您最近播放與收藏的心愛曲目</p>
                          </div>
                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: "6px 12px", fontSize: 12 }}
                            onClick={() => playTrackFromList(jumpBackInTracks[0], jumpBackInTracks)}
                          >
                            <Play size={13} fill="currentColor" />
                            全部播放
                          </button>
                        </div>
                        <div className="card-grid">
                          {jumpBackInTracks.map((track) => {
                            const isCurrent = currentTrack?.videoId === track.videoId;
                            return (
                              <div key={`jbi-${track.videoId}`} className={`music-card ${isCurrent ? "playing" : ""}`}>
                                <div className="card-cover-wrap">
                                  <AlbumArt
                                    thumbnailUrl={track.thumbnailUrl}
                                    videoId={track.videoId}
                                    title={track.title}
                                    artist={track.artist}
                                    className="card-cover"
                                  />
                                  <div className="card-overlay-actions">
                                    <button
                                      type="button"
                                      className="card-mini-btn"
                                      title="加入待播佇列"
                                      onClick={() => addTrackToQueue(track)}
                                    >
                                      <Plus size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      className="card-play-fab"
                                      title="立即播放"
                                      onClick={() =>
                                        isCurrent ? void togglePlayPause() : playSingleTrack(track)
                                      }
                                    >
                                      {isCurrent && isPlaying ? (
                                        <Pause size={16} fill="currentColor" />
                                      ) : (
                                        <Play size={16} fill="currentColor" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                <div className="card-meta">
                                  <div className="card-title truncate" title={track.title}>
                                    {track.title}
                                  </div>
                                  <button
                                    type="button"
                                    className="card-artist entity-link truncate"
                                    onClick={() => void openEntityPage("artist", track.artist)}
                                  >
                                    {track.artist}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {/* Moods & Genres Quick Discovery */}
                    <section className="section-block">
                      <div className="section-header">
                        <div>
                          <h2 className="section-title">依曲風與心情探索</h2>
                          <p className="section-sub">一鍵切換最適合此刻心境的雲端曲庫</p>
                        </div>
                      </div>
                      <div className="mood-grid">
                        {MOOD_CARDS.map((m) => (
                          <button
                            key={m.title}
                            type="button"
                            className="mood-card"
                            style={{ background: m.gradient }}
                            onClick={() => {
                              setSearchQuery(m.query);
                              void handleSearchSubmit(undefined, m.query, "songs");
                            }}
                          >
                            <span>{m.title}</span>
                            <span className="mood-card-sub">{m.sub}</span>
                          </button>
                        ))}
                      </div>
                    </section>

                    {homeLoading && homeSections.length === 0 ? (
                      <div className="empty-state">
                        <Loader2 size={28} className="spin" />
                        <div>正在從 YouTube Music API 動態編排個人化歌單...</div>
                      </div>
                    ) : (
                      homeSections.map((sec) => (
                        <section key={sec.title} className="section-block">
                          <div className="section-header">
                            <div style={{ minWidth: 0 }}>
                              <h2 className="section-title truncate">{sec.title}</h2>
                              <p className="section-sub truncate">{sec.subtitle}</p>
                            </div>
                            <button
                              type="button"
                              className="secondary-btn"
                              style={{ padding: "6px 12px", fontSize: 12 }}
                              onClick={() => {
                                if (sec.tracks.length > 0) {
                                  playTrackFromList(sec.tracks[0], sec.tracks);
                                }
                              }}
                            >
                              <Play size={13} fill="currentColor" />
                              全部播放
                            </button>
                          </div>

                          <div className="card-grid">
                            {sec.tracks.map((track) => {
                              const isCurrent = currentTrack?.videoId === track.videoId;
                              return (
                                <div
                                  key={track.videoId}
                                  className={`music-card ${isCurrent ? "playing" : ""}`}
                                >
                                  <div className="card-cover-wrap">
                                    <AlbumArt
                                      thumbnailUrl={track.thumbnailUrl}
                                      videoId={track.videoId}
                                      title={track.title}
                                      artist={track.artist}
                                      className="card-cover"
                                    />
                                    <div className="card-overlay-actions">
                                      <button
                                        type="button"
                                        className="card-mini-btn"
                                        title="加入待播佇列"
                                        onClick={() => addTrackToQueue(track)}
                                      >
                                        <Plus size={15} />
                                      </button>
                                      <button
                                        type="button"
                                        className="card-play-fab"
                                        title="立即串流播放"
                                        onClick={() => {
                                          if (isCurrent) {
                                            void togglePlayPause();
                                          } else {
                                            playSingleTrack(track);
                                          }
                                        }}
                                      >
                                        {isCurrent && isPlaying ? (
                                          <Pause size={16} fill="currentColor" />
                                        ) : (
                                          <Play size={16} fill="currentColor" />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                  <div className="card-meta">
                                    <div className="card-title truncate" title={track.title}>
                                      {track.title}
                                    </div>
                                    <button
                                      type="button"
                                      className="card-artist entity-link truncate"
                                      title={`瀏覽藝人「${track.artist}」`}
                                      onClick={() => void openEntityPage("artist", track.artist)}
                                    >
                                      {track.artist}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))
                    )}
                  </div>
                )}

                {/* SEARCH VIEW */}
                {navTab === "search" && (
                  <div>
                    <div className="filter-bar">
                      <div className="chip-row">
                        {(
                          [
                            ["songs", "歌曲"],
                            ["artists", "藝人"],
                            ["albums", "專輯"],
                            ["playlists", "播放清單"],
                            ["videos", "音樂影片 / MV"],
                            ["all", "綜合結果"],
                          ] as const
                        ).map(([key, label]) => (
                          <button
                            key={key}
                            type="button"
                            className={`chip-btn ${searchFilter === key ? "active" : ""}`}
                            onClick={() => {
                              setSearchFilter(key);
                              if (searchQuery.trim()) {
                                void handleSearchSubmit(undefined, searchQuery, key);
                              }
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="chip-row">
                        {QUICK_GENRES.slice(0, 5).map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className="chip-btn"
                            onClick={() => {
                              setSearchQuery(tag);
                              void handleSearchSubmit(undefined, tag, searchFilter);
                            }}
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Live Search Suggestions */}
                    {searchSuggestions.length > 0 && (
                      <div className="suggestion-bar">
                        <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginRight: 4 }}>
                          即時建議：
                        </span>
                        {searchSuggestions.map((sug) => (
                          <button
                            key={sug}
                            type="button"
                            className="chip-btn"
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => {
                              setSearchQuery(sug);
                              void handleSearchSubmit(undefined, sug, searchFilter);
                            }}
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Search History */}
                    {searchHistory.length > 0 && (
                      <div className="suggestion-bar">
                        <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginRight: 4 }}>
                          搜尋紀錄：
                        </span>
                        {searchHistory.slice(0, 8).map((item) => (
                          <button
                            key={item}
                            type="button"
                            className="chip-btn"
                            style={{ padding: "4px 10px", fontSize: 11.5 }}
                            onClick={() => {
                              setSearchQuery(item);
                              void handleSearchSubmit(undefined, item, searchFilter);
                            }}
                          >
                            {item}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="chip-btn"
                          style={{ padding: "4px 8px", fontSize: 11, marginLeft: "auto" }}
                          onClick={() => {
                            setSearchHistory([]);
                            void saveSearchHistoryDb([]).catch(() => {});
                          }}
                        >
                          清除紀錄
                        </button>
                      </div>
                    )}

                    {/* Artist / Album quick highlight cards when filtering */}
                    {searchEntityHighlights.length > 0 && (
                      <section className="section-block" style={{ marginBottom: 18 }}>
                        <div className="section-header">
                          <h2 className="section-title">
                            {searchFilter === "artists" ? "符合的藝人專頁" : "符合的專輯專頁"}
                          </h2>
                        </div>
                        <div className="card-grid">
                          {searchEntityHighlights.map((ent) => (
                            <button
                              key={`${ent.kind}-${ent.name}`}
                              type="button"
                              className="music-card"
                              style={{ textAlign: "left" }}
                              onClick={() => void openEntityPage(ent.kind, ent.name)}
                            >
                              <div className="card-cover-wrap">
                                <AlbumArt
                                  thumbnailUrl={ent.thumb}
                                  videoId={ent.name}
                                  title={ent.name}
                                  artist={ent.sub}
                                  className="card-cover"
                                />
                              </div>
                              <div className="card-meta">
                                <div className="card-title truncate">{ent.name}</div>
                                <div className="card-artist truncate">{ent.sub}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}

                    {searchLoading ? (
                      <div className="empty-state">
                        <Loader2 size={28} className="spin" />
                        <div>正在透過 YTMAPI 搜尋「{searchQuery}」...</div>
                      </div>
                    ) : searchResults.length > 0 ? (
                      <TrackTable
                        tracks={searchResults}
                        currentVideoId={currentTrack?.videoId}
                        favoriteIds={favoriteIds}
                        downloadingIds={downloadingIds}
                        playlists={playlists}
                        onPlayTrack={(t) => playSingleTrack(t)}
                        onPlayNext={addTrackNext}
                        onAddToQueue={addTrackToQueue}
                        onToggleFavorite={toggleFavorite}
                        onDownloadTrack={handleDownloadTrack}
                        onClickArtist={(a) => void openEntityPage("artist", a)}
                        onClickAlbum={(alb) => void openEntityPage("album", alb)}
                        onAddToPlaylist={handleAddTrackToPlaylist}
                      />
                    ) : (
                      <div className="empty-state">
                        <Search size={34} />
                        <div>在上方輸入歌手、專輯、歌曲或關鍵字，立即透過 YTMAPI 搜尋串流音樂。</div>
                      </div>
                    )}
                  </div>
                )}

                {/* ARTIST / ALBUM DETAIL VIEW */}
                {navTab === "entity" && (
                  <div>
                    <div style={{ marginBottom: 14 }}>
                      <button
                        type="button"
                        className="secondary-btn"
                        style={{ padding: "6px 12px", fontSize: 12.5 }}
                        onClick={() => setNavTab(entityReturnTab)}
                      >
                        <ArrowLeft size={14} />
                        返回上一頁
                      </button>
                    </div>

                    {entityLoading ? (
                      <div className="empty-state">
                        <Loader2 size={28} className="spin" />
                        <div>正在載入歌手 / 專輯詳細資料...</div>
                      </div>
                    ) : entityDetail ? (
                      <div>
                        <section className="entity-hero">
                          <AlbumArt
                            thumbnailUrl={entityDetail.thumbnailUrl}
                            videoId={entityDetail.name}
                            title={entityDetail.name}
                            artist={entityDetail.subtitle}
                            className="entity-hero-cover"
                          />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="hero-eyebrow">
                              {entityDetail.kind === "album" ? <Disc3 size={14} /> : <User size={14} />}
                              <span>{entityDetail.kind === "album" ? "ALBUM DETAIL" : "ARTIST PAGE"}</span>
                            </div>
                            <h1 className="hero-title truncate">{entityDetail.name}</h1>
                            <p className="hero-desc" style={{ marginBottom: 12 }}>
                              {entityDetail.subtitle} · {entityDetail.description}
                            </p>
                            <div className="hero-actions">
                              {entityDetail.tracks.length > 0 && (
                                <button
                                  type="button"
                                  className="primary-btn"
                                  onClick={() =>
                                    playTrackFromList(entityDetail.tracks[0], entityDetail.tracks)
                                  }
                                >
                                  <Play size={14} fill="currentColor" />
                                  全部播放 ({entityDetail.tracks.length})
                                </button>
                              )}
                              <button
                                type="button"
                                className="secondary-btn"
                                onClick={() =>
                                  handleCreatePlaylist(entityDetail.name, entityDetail.tracks)
                                }
                                disabled={entityDetail.tracks.length === 0}
                              >
                                <FolderPlus size={14} />
                                收藏為個人歌單
                              </button>
                            </div>
                          </div>
                        </section>

                        <section className="section-block">
                          <div className="section-header">
                            <h2 className="section-title">熱門曲目</h2>
                          </div>
                          <TrackTable
                            tracks={entityDetail.tracks}
                            currentVideoId={currentTrack?.videoId}
                            favoriteIds={favoriteIds}
                            downloadingIds={downloadingIds}
                            playlists={playlists}
                            onPlayTrack={(t) => playTrackFromList(t, entityDetail.tracks)}
                            onPlayNext={addTrackNext}
                            onAddToQueue={addTrackToQueue}
                            onToggleFavorite={toggleFavorite}
                            onDownloadTrack={handleDownloadTrack}
                            onClickArtist={(a) => void openEntityPage("artist", a)}
                            onClickAlbum={(alb) => void openEntityPage("album", alb)}
                            onAddToPlaylist={handleAddTrackToPlaylist}
                          />
                        </section>

                        {entityDetail.albums.length > 0 && (
                          <section className="section-block">
                            <div className="section-header">
                              <h2 className="section-title">相關專輯</h2>
                            </div>
                            <div className="card-grid">
                              {entityDetail.albums.map((alb) => (
                                <button
                                  key={alb.name}
                                  type="button"
                                  className="music-card"
                                  style={{ textAlign: "left" }}
                                  onClick={() => void openEntityPage("album", alb.name)}
                                >
                                  <div className="card-cover-wrap">
                                    <AlbumArt
                                      thumbnailUrl={alb.thumbnailUrl}
                                      videoId={alb.name}
                                      title={alb.name}
                                      artist={alb.subtitle}
                                      className="card-cover"
                                    />
                                  </div>
                                  <div className="card-meta">
                                    <div className="card-title truncate">{alb.name}</div>
                                    <div className="card-artist truncate">{alb.subtitle}</div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </section>
                        )}

                        {entityDetail.relatedArtists.length > 0 && (
                          <section className="section-block">
                            <div className="section-header">
                              <h2 className="section-title">相似藝人推薦</h2>
                            </div>
                            <div className="card-grid">
                              {entityDetail.relatedArtists.map((art) => (
                                <button
                                  key={art.name}
                                  type="button"
                                  className="music-card"
                                  style={{ textAlign: "left" }}
                                  onClick={() => void openEntityPage("artist", art.name)}
                                >
                                  <div className="card-cover-wrap">
                                    <AlbumArt
                                      thumbnailUrl={art.thumbnailUrl}
                                      videoId={art.name}
                                      title={art.name}
                                      artist={art.subtitle}
                                      className="card-cover"
                                    />
                                  </div>
                                  <div className="card-meta">
                                    <div className="card-title truncate">{art.name}</div>
                                    <div className="card-artist truncate">{art.subtitle}</div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </section>
                        )}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <User size={34} />
                        <div>尚無可顯示的藝人或專輯資訊</div>
                      </div>
                    )}
                  </div>
                )}

                {/* SPOTIFY-STYLE AI DJ MIX VIEW */}
                {navTab === "dj" && (
                  <DjMixConsole
                    currentTrack={currentTrack}
                    nextTrack={nextTrack}
                    isPlaying={isPlaying}
                    analyser={analyser}
                    djEnabled={djEnabled}
                    djVibe={djVibe}
                    djLoading={djLoading}
                    djComment={djComment}
                    djVoiceEnabled={djVoiceEnabled}
                    crossfadeSec={crossfadeSec}
                    crossfadeActive={crossfadeActive}
                    eq={eq}
                    loudnessNorm={loudnessNorm}
                    visualizerStyle={visualizerStyle}
                    onToggleDj={handleToggleDj}
                    onSelectVibe={(v) => void startDjVibe(v)}
                    onToggleDjVoice={() => setDjVoiceEnabled((v) => !v)}
                    onChangeCrossfadeSec={setCrossfadeSec}
                    onChangeEq={setEq}
                    onSaveCustomEq={() => {
                      const currentBands = resolveEqBands(eq);
                      setEq((prev) => ({
                        ...prev,
                        preset: "custom",
                        bands: [...currentBands],
                        customBands: [...currentBands],
                      }));
                      showToast("✅ 已儲存自訂 10 段式 EQ 曲線");
                    }}
                    onToggleLoudnessNorm={() => {
                      const next = !loudnessNorm;
                      setLoudnessNorm(next);
                      showToast(next ? "已開啟音量標準化平衡" : "已關閉音量標準化");
                    }}
                    onChangeVisualizerStyle={setVisualizerStyle}
                    onSpeakNow={() => {
                      if (currentTrack) {
                        const vibeLabel = DJ_VIBES.find((v) => v.id === djVibe)?.label;
                        speakDjTransition(currentTrack, vibeLabel);
                      }
                    }}
                    onTriggerCrossfadeNext={() => void handleNext(true)}
                    onImportLocalLossless={handleImportLocalLossless}
                  />
                )}

                {/* IMMERSIVE LYRICS VIEW */}
                {navTab === "lyrics" && (
                  <div className="lyrics-stage">
                    <div className="lyrics-left-col">
                      <div className={`lyrics-cover-frame ${isPlaying ? "playing" : ""}`}>
                        {currentTrack ? (
                          <AlbumArt
                            thumbnailUrl={currentTrack.thumbnailUrl}
                            videoId={currentTrack.videoId}
                            title={currentTrack.title}
                            artist={currentTrack.artist}
                          />
                        ) : (
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--text-muted)",
                            }}
                          >
                            <Disc3 size={64} />
                          </div>
                        )}
                      </div>

                      <div className="lyrics-song-meta">
                        <h2 className="lyrics-song-title truncate">
                          {currentTrack ? currentTrack.title : "尚未播放歌曲"}
                        </h2>
                        <p className="lyrics-song-artist truncate">
                          {currentTrack ? (
                            <>
                              <button
                                type="button"
                                className="entity-link"
                                onClick={() => void openEntityPage("artist", currentTrack.artist)}
                              >
                                {currentTrack.artist}
                              </button>
                              {currentTrack.album ? ` · ${currentTrack.album}` : ""}
                            </>
                          ) : (
                            "請先從探索首頁或搜尋選擇歌曲"
                          )}
                        </p>
                      </div>

                      <SpectrumCanvas
                        analyser={analyser}
                        isPlaying={isPlaying}
                        variant="stage"
                        mode={visualizerStyle}
                      />

                      {lyrics?.hasSynced && (
                        <div className="lyrics-tools" style={{ alignItems: "center" }}>
                          <button
                            type="button"
                            className="chip-btn"
                            onClick={() =>
                              updateLyricOffsetForCurrent(Number((lyricsOffset - 0.5).toFixed(1)))
                            }
                          >
                            -0.5s
                          </button>
                          <span
                            className="tabular-nums"
                            style={{ fontSize: 12, color: "var(--text-secondary)" }}
                            title="會為這首歌自動記憶專屬偏移秒數"
                          >
                            偏移 {lyricsOffset >= 0 ? `+${lyricsOffset.toFixed(1)}` : lyricsOffset.toFixed(1)}s
                          </span>
                          <button
                            type="button"
                            className="chip-btn"
                            onClick={() =>
                              updateLyricOffsetForCurrent(Number((lyricsOffset + 0.5).toFixed(1)))
                            }
                          >
                            +0.5s
                          </button>
                          {lyricsOffset !== 0 && (
                            <button
                              type="button"
                              className="chip-btn"
                              onClick={() => updateLyricOffsetForCurrent(0)}
                            >
                              重設
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="lyrics-right-col">
                      <div className="lyrics-right-header">
                        <span>
                          {lyrics?.hasSynced
                            ? "時間軸同步歌詞 (點擊任一句即可跳轉時間)"
                            : "動態歌詞"}
                        </span>
                        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                          {lyrics?.source && lyrics.source !== "None" ? lyrics.source : ""}
                          {lyricsLoading && <Loader2 size={14} className="spin" style={{ marginLeft: 6 }} />}
                        </span>
                      </div>

                      <div className="lyrics-scroll-container">
                        {!currentTrack ? (
                          <div className="empty-state">
                            <Mic2 size={32} />
                            <div>播放任一首音樂後，這裡會顯示即時同步動態歌詞</div>
                          </div>
                        ) : lyricsLoading ? (
                          <div className="empty-state">
                            <Loader2 size={28} className="spin" />
                            <div>正在智慧比對並載入最佳同步歌詞...</div>
                          </div>
                        ) : lyrics?.hasSynced && lyrics.syncedLines.length > 0 ? (
                          lyrics.syncedLines.map((line, i) => {
                            const isActive = i === activeLyricIndex;
                            return (
                              <button
                                key={`${line.timeMs}-${i}`}
                                ref={isActive ? lyricsMainActiveRef : null}
                                type="button"
                                className={`lyric-line-btn ${isActive ? "active" : ""}`}
                                onClick={() => seekTo(Math.max(0, line.timeMs / 1000 - lyricsOffset))}
                              >
                                {line.text}
                              </button>
                            );
                          })
                        ) : lyrics?.plainText ? (
                          <pre className="plain-lyrics-text">{lyrics.plainText}</pre>
                        ) : (
                          <div className="empty-state">
                            <Mic2 size={32} />
                            <div>此曲目暫無可用歌詞</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* QUEUE VIEW */}
                {navTab === "queue" && (
                  <div>
                    <div className="section-header">
                      <div>
                        <h2 className="section-title">播放佇列 ({queue.length})</h2>
                        <p className="section-sub">支援雙擊播放、插播下一首、拖曳排序與離線下載</p>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {currentTrack && !currentTrack.localFileUrl && !currentTrack.localFilePath && (
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => void appendRecommendations(currentTrack.videoId, false)}
                            disabled={fetchingRecs}
                          >
                            {fetchingRecs ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                            擴充推薦曲目
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={clearUpcomingQueue}
                          disabled={queue.length <= 1}
                        >
                          <Trash2 size={14} />
                          清空待播
                        </button>
                      </div>
                    </div>

                    {queue.length === 0 ? (
                      <div className="empty-state">
                        <ListMusic size={34} />
                        <div>播放佇列目前是空的，前往首頁或搜尋加入音樂吧！</div>
                      </div>
                    ) : (
                      <TrackTable
                        tracks={queue}
                        currentVideoId={currentTrack?.videoId}
                        favoriteIds={favoriteIds}
                        downloadingIds={downloadingIds}
                        playlists={playlists}
                        onPlayTrack={(_, idx) => void playQueueIndex(idx, false)}
                        onPlayNext={addTrackNext}
                        onAddToQueue={addTrackToQueue}
                        onToggleFavorite={toggleFavorite}
                        onDownloadTrack={handleDownloadTrack}
                        onRemoveAt={removeFromQueue}
                        onClickArtist={(a) => void openEntityPage("artist", a)}
                        onClickAlbum={(alb) => void openEntityPage("album", alb)}
                        onAddToPlaylist={handleAddTrackToPlaylist}
                        onReorder={(fromIdx, toIdx) => {
                          setQueue((prev) => {
                            const next = [...prev];
                            const [moved] = next.splice(fromIdx, 1);
                            next.splice(toIdx, 0, moved);
                            queueRef.current = next;
                            const curVid = currentTrack?.videoId;
                            if (curVid) {
                              const newCur = next.findIndex((t) => t.videoId === curVid);
                              if (newCur >= 0) {
                                currentIndexRef.current = newCur;
                                setCurrentIndex(newCur);
                              }
                            }
                            return next;
                          });
                        }}
                        showAutoBadge
                      />
                    )}
                  </div>
                )}

                {/* LIBRARY VIEW: Favorites, Custom Playlists, Local Scanner & Sound Capsule */}
                {navTab === "library" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    <div className="subtab-bar">
                      {(
                        [
                          ["favorites", `收藏與紀錄 (${favorites.length})`, Heart],
                          ["playlists", `自訂歌單 (${playlists.length})`, ListMusic],
                          ["local", `本機音樂庫 (${localTracks.length})`, FileMusic],
                          ["stats", "聆聽統計 (Sound Capsule)", BarChart3],
                        ] as const
                      ).map(([key, label, Icon]) => (
                        <button
                          key={key}
                          type="button"
                          className={`chip-btn ${librarySubTab === key ? "active" : ""}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                          onClick={() => setLibrarySubTab(key)}
                        >
                          <Icon size={13} />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>

                    {librarySubTab === "favorites" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                        <section>
                          <div className="section-header">
                            <div>
                              <h2 className="section-title">我的收藏 ({favorites.length})</h2>
                              <p className="section-sub">儲存在本機的喜愛歌曲清單</p>
                            </div>
                            {favorites.length > 0 && (
                              <button
                                type="button"
                                className="primary-btn"
                                style={{ padding: "7px 14px", fontSize: 12 }}
                                onClick={() => playTrackFromList(favorites[0], favorites)}
                              >
                                <Play size={13} fill="currentColor" />
                                播放全部收藏
                              </button>
                            )}
                          </div>
                          {favorites.length === 0 ? (
                            <div className="empty-state" style={{ padding: 24 }}>
                              <Heart size={28} />
                              <div>尚未收藏任何歌曲，點擊歌曲愛心即可加入。</div>
                            </div>
                          ) : (
                            <TrackTable
                              tracks={favorites}
                              currentVideoId={currentTrack?.videoId}
                              favoriteIds={favoriteIds}
                              downloadingIds={downloadingIds}
                              playlists={playlists}
                              onPlayTrack={(t) => playTrackFromList(t, favorites)}
                              onPlayNext={addTrackNext}
                              onAddToQueue={addTrackToQueue}
                              onToggleFavorite={toggleFavorite}
                              onDownloadTrack={handleDownloadTrack}
                              onClickArtist={(a) => void openEntityPage("artist", a)}
                              onClickAlbum={(alb) => void openEntityPage("album", alb)}
                              onAddToPlaylist={handleAddTrackToPlaylist}
                            />
                          )}
                        </section>

                        <section>
                          <div className="section-header">
                            <div>
                              <h2 className="section-title">最近播放紀錄 ({history.length})</h2>
                              <p className="section-sub">近期串流與本機播放過的曲目</p>
                            </div>
                            {history.length > 0 && (
                              <button
                                type="button"
                                className="secondary-btn"
                                style={{ padding: "6px 12px", fontSize: 12 }}
                                onClick={() => {
                                  setHistory([]);
                                  void clearPlayHistoryDb().catch(() => {});
                                }}
                              >
                                <Trash2 size={13} />
                                清除紀錄
                              </button>
                            )}
                          </div>
                          {history.length === 0 ? (
                            <div className="empty-state" style={{ padding: 24 }}>
                              <Disc3 size={28} />
                              <div>尚無播放紀錄。</div>
                            </div>
                          ) : (
                            <TrackTable
                              tracks={history}
                              currentVideoId={currentTrack?.videoId}
                              favoriteIds={favoriteIds}
                              downloadingIds={downloadingIds}
                              playlists={playlists}
                              onPlayTrack={(t) => playTrackFromList(t, history)}
                              onPlayNext={addTrackNext}
                              onAddToQueue={addTrackToQueue}
                              onToggleFavorite={toggleFavorite}
                              onDownloadTrack={handleDownloadTrack}
                              onClickArtist={(a) => void openEntityPage("artist", a)}
                              onClickAlbum={(alb) => void openEntityPage("album", alb)}
                              onAddToPlaylist={handleAddTrackToPlaylist}
                            />
                          )}
                        </section>
                      </div>
                    )}

                    {librarySubTab === "playlists" && (
                      <div className="playlist-shell">
                        <div className="panel-card playlist-sidebar-card">
                          <h3 style={{ margin: 0, fontSize: 15 }}>我的個人歌單</h3>

                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              type="text"
                              className="text-field"
                              style={{ flex: 1 }}
                              placeholder="輸入新歌單名稱..."
                              value={newPlaylistName}
                              onChange={(e) => setNewPlaylistName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleCreatePlaylist();
                              }}
                            />
                            <button
                              type="button"
                              className="primary-btn"
                              style={{ padding: "7px 11px", fontSize: 12 }}
                              onClick={() => handleCreatePlaylist()}
                            >
                              <Plus size={14} />
                              建立
                            </button>
                          </div>

                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              type="text"
                              className="text-field"
                              style={{ flex: 1 }}
                              placeholder="貼上 YouTube 歌單網址匯入..."
                              value={importPlaylistUrl}
                              onChange={(e) => setImportPlaylistUrl(e.target.value)}
                            />
                            <button
                              type="button"
                              className="secondary-btn"
                              style={{ padding: "7px 10px", fontSize: 12 }}
                              onClick={() => void handleImportPlaylistUrl()}
                              disabled={importingPlaylist || !importPlaylistUrl.trim()}
                              title="一鍵批量匯入 YouTube / YouTube Music 公開播放清單"
                            >
                              {importingPlaylist ? (
                                <Loader2 size={13} className="spin" />
                              ) : (
                                <Link2 size={13} />
                              )}
                              匯入
                            </button>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                            {playlists.length === 0 ? (
                              <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>
                                尚未建立任何個人歌單，可在上方新建或匯入 YouTube 歌單。
                              </div>
                            ) : (
                              playlists.map((pl) => (
                                <button
                                  key={pl.id}
                                  type="button"
                                  className={`playlist-list-item ${activePlaylist?.id === pl.id ? "active" : ""}`}
                                  onClick={() => {
                                    setSelectedPlaylistId(pl.id);
                                    setRenamingPlaylist(false);
                                  }}
                                >
                                  {pl.coverUrl ? (
                                    <img
                                      src={pl.coverUrl}
                                      alt={pl.name}
                                      className="playlist-mini-cover"
                                    />
                                  ) : (
                                    <div className="playlist-mini-cover">
                                      <Music size={16} />
                                    </div>
                                  )}
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                                      {pl.name}
                                    </div>
                                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                      {pl.tracks.length} 首曲目
                                    </div>
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="panel-card">
                          {!activePlaylist ? (
                            <div className="empty-state">
                              <ListMusic size={32} />
                              <div>建立或選擇一個歌單即可管理、排序、去重與匯出。</div>
                            </div>
                          ) : (
                            <>
                              <div className="section-header" style={{ marginBottom: 6 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                                  {activePlaylist.coverUrl ? (
                                    <img
                                      src={activePlaylist.coverUrl}
                                      alt={activePlaylist.name}
                                      style={{
                                        width: 68,
                                        height: 68,
                                        borderRadius: 12,
                                        objectFit: "cover",
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: 68,
                                        height: 68,
                                        borderRadius: 12,
                                        background: "rgba(255,255,255,0.08)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <ListMusic size={28} />
                                    </div>
                                  )}
                                  <div style={{ minWidth: 0 }}>
                                    {renamingPlaylist ? (
                                      <div style={{ display: "flex", gap: 6 }}>
                                        <input
                                          type="text"
                                          className="text-field"
                                          value={renamePlaylistName}
                                          onChange={(e) => setRenamePlaylistName(e.target.value)}
                                        />
                                        <button
                                          type="button"
                                          className="primary-btn"
                                          style={{ padding: "5px 10px", fontSize: 12 }}
                                          onClick={() => {
                                            const trimmed = renamePlaylistName.trim();
                                            if (trimmed) {
                                              commitPlaylists(
                                                playlists.map((p) =>
                                                  p.id === activePlaylist.id
                                                    ? { ...p, name: trimmed }
                                                    : p
                                                )
                                              );
                                              showToast(`已重新命名歌單為「${trimmed}」`);
                                            }
                                            setRenamingPlaylist(false);
                                          }}
                                        >
                                          確認
                                        </button>
                                      </div>
                                    ) : (
                                      <h2 className="section-title truncate">{activePlaylist.name}</h2>
                                    )}
                                    <p className="section-sub">
                                      共 {activePlaylist.tracks.length} 首曲目 · 支援拖曳調整順序
                                    </p>
                                  </div>
                                </div>

                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {activePlaylist.tracks.length > 0 && (
                                    <button
                                      type="button"
                                      className="primary-btn"
                                      style={{ padding: "6px 12px", fontSize: 12 }}
                                      onClick={() =>
                                        playTrackFromList(
                                          displayedPlaylistTracks[0] ?? activePlaylist.tracks[0],
                                          displayedPlaylistTracks
                                        )
                                      }
                                    >
                                      <Play size={13} fill="currentColor" />
                                      播放
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    style={{ padding: "6px 10px", fontSize: 12 }}
                                    onClick={() => {
                                      setRenamePlaylistName(activePlaylist.name);
                                      setRenamingPlaylist((v) => !v);
                                    }}
                                    title="重新命名"
                                  >
                                    <Edit3 size={13} />
                                  </button>
                                  <label
                                    className="secondary-btn"
                                    style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer" }}
                                    title="上傳自訂歌單封面"
                                  >
                                    <ImagePlus size={13} />
                                    <input
                                      type="file"
                                      accept="image/*"
                                      style={{ display: "none" }}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const reader = new FileReader();
                                        reader.onload = () => {
                                          if (typeof reader.result === "string") {
                                            commitPlaylists(
                                              playlists.map((p) =>
                                                p.id === activePlaylist.id
                                                  ? { ...p, coverUrl: reader.result as string }
                                                  : p
                                              )
                                            );
                                            showToast("已更新歌單自訂封面");
                                          }
                                        };
                                        reader.readAsDataURL(file);
                                        e.target.value = "";
                                      }}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    style={{ padding: "6px 10px", fontSize: 12 }}
                                    onClick={() => handleDeduplicatePlaylist(activePlaylist.id)}
                                    title="一鍵移除重複歌曲"
                                  >
                                    <CopyCheck size={13} />
                                    去重
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    style={{ padding: "6px 10px", fontSize: 12 }}
                                    onClick={() => {
                                      void exportPlaylistFile(activePlaylist, "json")
                                        .then((p) => showToast(`✅ 已匯出 JSON：${p}`))
                                        .catch((err) => showToast(`匯出失敗: ${String(err)}`, true));
                                    }}
                                    title="匯出為 JSON 備份"
                                  >
                                    <FileJson size={13} />
                                    JSON
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    style={{ padding: "6px 10px", fontSize: 12 }}
                                    onClick={() => {
                                      void exportPlaylistFile(activePlaylist, "m3u")
                                        .then((p) => showToast(`✅ 已匯出 M3U：${p}`))
                                        .catch((err) => showToast(`匯出失敗: ${String(err)}`, true));
                                    }}
                                    title="匯出為 M3U 播放清單"
                                  >
                                    M3U
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary-btn"
                                    style={{ padding: "6px 10px", fontSize: 12, color: "#fda4af" }}
                                    onClick={() => {
                                      const next = playlists.filter((p) => p.id !== activePlaylist.id);
                                      commitPlaylists(next);
                                      setSelectedPlaylistId(next[0]?.id ?? "");
                                      showToast(`已刪除歌單「${activePlaylist.name}」`);
                                    }}
                                    title="刪除歌單"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>

                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                <input
                                  type="text"
                                  className="text-field"
                                  style={{ flex: 1, minWidth: 160 }}
                                  placeholder="歌單內即時關鍵字過濾..."
                                  value={playlistFilter}
                                  onChange={(e) => setPlaylistFilter(e.target.value)}
                                />
                                <select
                                  className="text-field"
                                  value={playlistSort}
                                  onChange={(e) =>
                                    setPlaylistSort(e.target.value as "order" | "title" | "artist")
                                  }
                                >
                                  <option value="order" style={{ background: "#0d111d" }}>
                                    依加入順序（可拖曳）
                                  </option>
                                  <option value="title" style={{ background: "#0d111d" }}>
                                    依歌名排序
                                  </option>
                                  <option value="artist" style={{ background: "#0d111d" }}>
                                    依藝人排序
                                  </option>
                                </select>
                              </div>

                              {displayedPlaylistTracks.length === 0 ? (
                                <div className="empty-state" style={{ padding: 24 }}>
                                  <Music size={26} />
                                  <div>此歌單尚無符合條件的歌曲。</div>
                                </div>
                              ) : (
                                <TrackTable
                                  tracks={displayedPlaylistTracks}
                                  currentVideoId={currentTrack?.videoId}
                                  favoriteIds={favoriteIds}
                                  downloadingIds={downloadingIds}
                                  onPlayTrack={(t) => playTrackFromList(t, displayedPlaylistTracks)}
                                  onPlayNext={addTrackNext}
                                  onAddToQueue={addTrackToQueue}
                                  onToggleFavorite={toggleFavorite}
                                  onDownloadTrack={handleDownloadTrack}
                                  onClickArtist={(a) => void openEntityPage("artist", a)}
                                  onClickAlbum={(alb) => void openEntityPage("album", alb)}
                                  onRemoveAt={(idx) => {
                                    const targetTrack = displayedPlaylistTracks[idx];
                                    if (!targetTrack) return;
                                    commitPlaylists(
                                      playlists.map((p) =>
                                        p.id === activePlaylist.id
                                          ? {
                                              ...p,
                                              tracks: p.tracks.filter(
                                                (x) => x.videoId !== targetTrack.videoId
                                              ),
                                            }
                                          : p
                                      )
                                    );
                                  }}
                                  onReorder={
                                    playlistSort === "order" && !playlistFilter.trim()
                                      ? (fromIdx, toIdx) => {
                                          const reordered = [...activePlaylist.tracks];
                                          const [moved] = reordered.splice(fromIdx, 1);
                                          reordered.splice(toIdx, 0, moved);
                                          commitPlaylists(
                                            playlists.map((p) =>
                                              p.id === activePlaylist.id
                                                ? { ...p, tracks: reordered }
                                                : p
                                            )
                                          );
                                        }
                                      : undefined
                                  }
                                />
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {librarySubTab === "local" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <section className="panel-card">
                          <div className="section-header" style={{ marginBottom: 4 }}>
                            <div>
                              <h2 className="section-title">本機無損音樂庫掃描 (Local Files)</h2>
                              <p className="section-sub">
                                自動解析 FLAC / WAV / MP3 / M4A / OGG 的 ID3 / Vorbis / MP4 標籤與內嵌封面
                              </p>
                            </div>
                            <label className="secondary-btn" style={{ padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
                              <FolderPlus size={14} />
                              單次選擇音檔
                              <input
                                type="file"
                                accept=".flac,.wav,.alac,.aiff,.m4a,.mp3,.ogg,.opus"
                                multiple
                                style={{ display: "none" }}
                                onChange={(e) => handleImportLocalLossless(e.target.files)}
                              />
                            </label>
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <input
                              type="text"
                              className="text-field"
                              style={{ flex: 1, minWidth: 220 }}
                              placeholder="輸入音樂資料夾路徑（留空則自動掃描系統「音樂」資料夾）..."
                              value={localFolderPath}
                              onChange={(e) => setLocalFolderPath(e.target.value)}
                            />
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() => void handleScanLocalLibrary()}
                              disabled={scanningLocal}
                            >
                              {scanningLocal ? (
                                <Loader2 size={14} className="spin" />
                              ) : (
                                <FolderSearch size={14} />
                              )}
                              {scanningLocal ? "掃描中..." : "掃描本機音樂資料夾"}
                            </button>
                            {localTracks.length > 0 && (
                              <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => playTrackFromList(localTracks[0], localTracks)}
                              >
                                <Play size={13} fill="currentColor" />
                                全部播放 ({localTracks.length})
                              </button>
                            )}
                          </div>
                        </section>

                        {localTracks.length === 0 ? (
                          <div className="empty-state">
                            <FileMusic size={32} />
                            <div>尚未掃描到本機音檔，請輸入路徑並點擊「掃描本機音樂資料夾」。</div>
                          </div>
                        ) : (
                          <TrackTable
                            tracks={localTracks}
                            currentVideoId={currentTrack?.videoId}
                            favoriteIds={favoriteIds}
                            playlists={playlists}
                            onPlayTrack={(t) => playTrackFromList(t, localTracks)}
                            onPlayNext={addTrackNext}
                            onAddToQueue={addTrackToQueue}
                            onToggleFavorite={toggleFavorite}
                            onAddToPlaylist={handleAddTrackToPlaylist}
                          />
                        )}
                      </div>
                    )}

                    {librarySubTab === "stats" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <section className="capsule-grid">
                          <div className="capsule-stat-card">
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              本月聆聽時長 ({currentMonthKey()})
                            </span>
                            <span className="capsule-stat-val tabular-nums">
                              {formatListenDuration(soundCapsuleData.monthSec)}
                            </span>
                          </div>
                          <div className="capsule-stat-card">
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              累計總聆聽時長
                            </span>
                            <span className="capsule-stat-val tabular-nums">
                              {formatListenDuration(listeningStats.totalListenSeconds)}
                            </span>
                          </div>
                          <div className="capsule-stat-card">
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              累計播放次數
                            </span>
                            <span className="capsule-stat-val tabular-nums">
                              {soundCapsuleData.totalPlays} 次
                            </span>
                          </div>
                        </section>

                        <section className="panel-card">
                          <h3 style={{ margin: 0, fontSize: 15 }}>最愛藝人排行 (Top Artists)</h3>
                          {soundCapsuleData.topArtists.length === 0 ? (
                            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                              播放幾首歌曲後，系統將自動為您統計最常聆聽的藝人排行。
                            </div>
                          ) : (
                            <div className="chip-row">
                              {soundCapsuleData.topArtists.map(([artist, cnt], idx) => (
                                <button
                                  key={artist}
                                  type="button"
                                  className="chip-btn"
                                  onClick={() => void openEntityPage("artist", artist)}
                                >
                                  #{idx + 1} {artist} · {cnt} 次
                                </button>
                              ))}
                            </div>
                          )}
                        </section>

                        <section>
                          <div className="section-header">
                            <div>
                              <h2 className="section-title">最常播放歌曲 Top 10</h2>
                              <p className="section-sub">依本機累計播放次數自動排行</p>
                            </div>
                          </div>
                          {soundCapsuleData.topTracks.length === 0 ? (
                            <div className="empty-state" style={{ padding: 24 }}>
                              <BarChart3 size={28} />
                              <div>尚無足夠的播放統計資料。</div>
                            </div>
                          ) : (
                            <TrackTable
                              tracks={soundCapsuleData.topTracks.map((x) => ({
                                ...x.track,
                                album: `${x.track.album || "單曲"} · 播放 ${x.count} 次`,
                              }))}
                              currentVideoId={currentTrack?.videoId}
                              favoriteIds={favoriteIds}
                              downloadingIds={downloadingIds}
                              playlists={playlists}
                              onPlayTrack={(t) =>
                                playTrackFromList(
                                  t,
                                  soundCapsuleData.topTracks.map((x) => x.track)
                                )
                              }
                              onPlayNext={addTrackNext}
                              onAddToQueue={addTrackToQueue}
                              onToggleFavorite={toggleFavorite}
                              onDownloadTrack={handleDownloadTrack}
                              onClickArtist={(a) => void openEntityPage("artist", a)}
                              onAddToPlaylist={handleAddTrackToPlaylist}
                            />
                          )}
                        </section>
                      </div>
                    )}
                  </div>
                )}

                {/* SETTINGS, AUDIO QUALITY, AUTO-UPDATER & CROSS-PLATFORM VIEW */}
                {navTab === "settings" && (
                  <div className="settings-grid">
                    <div className="panel-card">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <h3 style={{ margin: 0, fontSize: 16 }}>音質引擎與介面外觀設定</h3>
                        <span className="quality-badge">
                          {engineStatus ? `${engineStatus.platform} / ${engineStatus.arch}` : "Cross-Platform"}
                        </span>
                      </div>

                      <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                        串流音質來源優先順序：
                      </div>
                      <div className="chip-row">
                        {(
                          [
                            ["lossless", "最高音質 (48kHz Opus / 最高位元率)"],
                            ["high", "高音質 (AAC/M4A)"],
                            ["standard", "標準省流"],
                          ] as const
                        ).map(([q, lbl]) => (
                          <button
                            key={q}
                            type="button"
                            className={`chip-btn ${audioQuality === q ? "active" : ""}`}
                            onClick={() => setAudioQuality(q)}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>

                      <div className="auto-radio-card" style={{ marginTop: 2 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                            Pure Direct 無壓縮原音直通
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                            繞過動態壓縮限幅器，保留完整瞬態動態與音場細節（建議開啟）
                          </div>
                        </div>
                        <button
                          type="button"
                          className={`toggle-switch ${pureDirect ? "on" : ""}`}
                          onClick={() => {
                            const next = !pureDirect;
                            setPureDirect(next);
                            showToast(
                              next
                                ? "已啟用 Pure Direct 無壓縮原音直通"
                                : "已啟用防破音安全限幅器 (Limiter)"
                            );
                          }}
                          aria-label="切換 Pure Direct 無壓縮原音直通"
                        >
                          <span className="toggle-knob" />
                        </button>
                      </div>

                      <div className="auto-radio-card" style={{ marginTop: 2 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                            音量標準化 (Loudness Normalization)
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                            自動平衡不同曲目間的響度落差，夜間或混排播放更舒適
                          </div>
                        </div>
                        <button
                          type="button"
                          className={`toggle-switch ${loudnessNorm ? "on" : ""}`}
                          onClick={() => setLoudnessNorm((v) => !v)}
                          aria-label="切換音量標準化"
                        >
                          <span className="toggle-knob" />
                        </button>
                      </div>

                      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 }}>
                        介面外觀風格：
                      </div>
                      <div className="chip-row">
                        <button
                          type="button"
                          className={`chip-btn ${glassMode === "acrylic" ? "active" : ""}`}
                          onClick={() => setGlassMode("acrylic")}
                        >
                          質感深色霧面 (Acrylic / Mica)
                        </button>
                        <button
                          type="button"
                          className={`chip-btn ${glassMode === "lite" ? "active" : ""}`}
                          onClick={() => setGlassMode("lite")}
                        >
                          純淨極簡深黑 (Solid)
                        </button>
                      </div>

                      {streamInfo && (
                        <>
                          <div className="info-kv">
                            <span className="info-k">目前音訊規格</span>
                            <span className="info-v">
                              {streamInfo.qualityLabel} ({streamInfo.acodec} · {streamInfo.abr})
                            </span>
                          </div>
                          <div className="info-kv">
                            <span className="info-k">處理路徑 / 引擎</span>
                            <span className="info-v">
                              {loudnessNorm
                                ? "Loudness Norm"
                                : pureDirect
                                  ? "Pure Direct 直通"
                                  : "EQ Limiter"}{" "}
                              · {streamInfo.engineUsed}
                            </span>
                          </div>
                        </>
                      )}

                      <div className="auto-radio-card" style={{ marginTop: 4 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                            關閉視窗時縮小至系統匣 (背景播放)
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                            點擊右上角關閉時保留常駐列與系統媒體控制
                          </div>
                        </div>
                        <button
                          type="button"
                          className={`toggle-switch ${closeToTray ? "on" : ""}`}
                          onClick={() => {
                            const next = !closeToTray;
                            setCloseToTray(next);
                            void setCloseToTrayCmd(next).catch(() => {});
                            showToast(next ? "已啟用縮小至系統匣背景播放" : "關閉視窗時將直接退出程式");
                          }}
                          aria-label="切換關閉時最小化至系統匣"
                        >
                          <span className="toggle-knob" />
                        </button>
                      </div>
                    </div>

                    {/* Audio Cache Stats Panel */}
                    <div className="panel-card">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <HardDrive size={18} style={{ color: "var(--accent-secondary)" }} />
                          <h3 style={{ margin: 0, fontSize: 16 }}>音訊智慧快取與離線空間</h3>
                        </div>
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ padding: "6px 11px", fontSize: 12 }}
                          onClick={() => {
                            void clearAudioCache()
                              .then(() => {
                                showToast("已清空本機串流音訊快取");
                                void refreshEngineStatus();
                              })
                              .catch((err) => showToast(`清理快取失敗: ${String(err)}`, true));
                          }}
                        >
                          <Trash2 size={13} />
                          清理音訊快取
                        </button>
                      </div>

                      <div className="info-kv">
                        <span className="info-k">已快取曲目數</span>
                        <span className="info-v tabular-nums">
                          {cacheStats ? `${cacheStats.entryCount} 首` : "統計中..."}
                        </span>
                      </div>
                      <div className="info-kv">
                        <span className="info-k">快取佔用空間 / LRU 上限</span>
                        <span className="info-v tabular-nums">
                          {cacheStats
                            ? `${formatBytes(cacheStats.totalBytes)} / ${formatBytes(cacheStats.maxBytes)}`
                            : "0 B / 2.00 GB"}
                        </span>
                      </div>
                      {cacheStats?.cacheDir && (
                        <div className="code-pill" title={cacheStats.cacheDir}>
                          {cacheStats.cacheDir}
                        </div>
                      )}
                      <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                        播放達 80% 或完整緩衝後自動寫入本機快取，重播秒開零等待；超出上限時自動依 LRU 機制清除最久未播音檔。
                      </p>
                    </div>

                    {/* Auto-Updater Panel */}
                    <div className="panel-card">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <ArrowUpCircle size={18} style={{ color: "var(--accent-secondary)" }} />
                          <h3 style={{ margin: 0, fontSize: 16 }}>自動檢查與核心更新</h3>
                        </div>
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ padding: "6px 11px", fontSize: 12 }}
                          onClick={() => void handleCheckUpdates(false)}
                          disabled={checkingUpdate}
                        >
                          <RefreshCw size={13} className={checkingUpdate ? "spin" : ""} />
                          檢查更新
                        </button>
                      </div>

                      <div className="info-kv">
                        <span className="info-k">AetherMusic 目前版本</span>
                        <span className="info-v tabular-nums">
                          v{updateStatus?.currentAppVersion || appVersion}
                          {updateStatus?.latestAppVersion && updateStatus.appUpdateAvailable
                            ? ` → 最新 v${updateStatus.latestAppVersion}`
                            : updateStatus?.latestAppVersion
                              ? " (已是最新)"
                              : ""}
                        </span>
                      </div>
                      <div className="info-kv">
                        <span className="info-k">串流核心 (yt-dlp / InnerTube)</span>
                        <span className="info-v tabular-nums">
                          {updateStatus?.ytdlpCurrentVersion || engineStatus?.ytdlpVersion || "Rust InnerTube"}
                          {updateStatus?.ytdlpLatestVersion && updateStatus.ytdlpUpdateAvailable
                            ? ` → 最新 ${updateStatus.ytdlpLatestVersion}`
                            : ""}
                        </span>
                      </div>
                      {updateStatus?.releaseNotes && (
                        <div className="code-pill" title={updateStatus.releaseNotes}>
                          {updateStatus.releaseNotes}
                        </div>
                      )}

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {updateStatus?.appUpdateAvailable && (
                          <button
                            type="button"
                            className="primary-btn"
                            style={{ padding: "8px 14px", fontSize: 12.5 }}
                            onClick={() => void handleRunAppUpdate()}
                            disabled={updatingApp || updatingCore}
                          >
                            {updatingApp ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                            {updatingApp
                              ? "下載並安裝更新中..."
                              : `一鍵更新 AetherMusic v${updateStatus.latestAppVersion}`}
                          </button>
                        )}
                        <button
                          type="button"
                          className={updateStatus?.appUpdateAvailable ? "secondary-btn" : "primary-btn"}
                          style={{ padding: "8px 14px", fontSize: 12.5 }}
                          onClick={() => void handleRunCoreUpdate()}
                          disabled={updatingCore || updatingApp}
                        >
                          {updatingCore ? <Loader2 size={14} className="spin" /> : <ArrowUpCircle size={14} />}
                          {updatingCore ? "更新串流核心中..." : "一鍵更新串流核心"}
                        </button>
                        {updateStatus?.releaseUrl && (
                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: "8px 14px", fontSize: 12.5 }}
                            onClick={() => void handleOpenExternalUrl(updateStatus.releaseUrl)}
                          >
                            前往 GitHub Releases
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Engine Status & GPL-3.0 */}
                    <div className="panel-card">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <ShieldCheck size={18} style={{ color: "var(--accent-secondary)" }} />
                          <h3 style={{ margin: 0, fontSize: 16 }}>跨平臺引擎與 GPL-3.0 授權</h3>
                        </div>
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ padding: "6px 11px", fontSize: 12, flexShrink: 0 }}
                          onClick={() => void refreshEngineStatus(true, true)}
                          disabled={detectingEngine}
                        >
                          <RefreshCw size={13} className={detectingEngine ? "spin" : ""} />
                          {detectingEngine ? "偵測中..." : "重新偵測"}
                        </button>
                      </div>
                      <div className="info-kv">
                        <span className="info-k">跨平臺架構</span>
                        <span className="info-v">Windows / macOS / Linux / Android (Tauri v2)</span>
                      </div>
                      <div className="info-kv">
                        <span className="info-k">全域快捷鍵</span>
                        <span className="info-v" style={{ fontSize: 11.5 }}>
                          Ctrl/Cmd+Alt+Space (播放) · M (迷你視窗)
                        </span>
                      </div>
                      <div className="info-kv">
                        <span className="info-k">本地 Range 代理伺服器</span>
                        <span className="info-v tabular-nums">
                          {engineStatus?.proxyPort
                            ? `http://127.0.0.1:${engineStatus.proxyPort}`
                            : "未啟動"}
                        </span>
                      </div>
                      {engineStatus?.ytdlpPath && (
                        <div className="code-pill" title={engineStatus.ytdlpPath}>
                          {engineStatus.ytdlpPath}
                        </div>
                      )}
                      <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                        採用 <strong>GNU General Public License v3.0 (GPL-3.0)</strong> 開源授權發佈。
                      </p>
                      <div className="code-pill">
                        https://github.com/hankyleisplay/AetherMusic.git
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </main>

            {/* Right Persistent Panel */}
            {sidePanelOpen && (
              <aside className="side-panel">
                <div className="side-panel-tabs">
                  <button
                    type="button"
                    className={`side-tab-btn ${sideTab === "queue" ? "active" : ""}`}
                    onClick={() => setSideTab("queue")}
                  >
                    佇列 ({queue.length})
                  </button>
                  <button
                    type="button"
                    className={`side-tab-btn ${sideTab === "lyrics" ? "active" : ""}`}
                    onClick={() => setSideTab("lyrics")}
                  >
                    歌詞
                  </button>
                  <button
                    type="button"
                    className={`side-tab-btn ${sideTab === "info" ? "active" : ""}`}
                    onClick={() => setSideTab("info")}
                  >
                    歌曲資訊
                  </button>
                </div>

                <div className="side-panel-body">
                  {sideTab === "queue" && (
                    <>
                      <div className="auto-radio-card">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                            <Sparkles size={13} style={{ color: "var(--accent-secondary)" }} />
                            <span>自動推薦接續播放</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                            佇列播完時由 YTMAPI 自動載入
                          </div>
                        </div>
                        <button
                          type="button"
                          className={`toggle-switch ${autoRadio ? "on" : ""}`}
                          onClick={() => setAutoRadio((v) => !v)}
                          aria-label="切換自動推薦"
                        >
                          <span className="toggle-knob" />
                        </button>
                      </div>

                      {currentTrack && !currentTrack.localFileUrl && !currentTrack.localFilePath && (
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "7px 12px" }}
                          onClick={() => void appendRecommendations(currentTrack.videoId, false)}
                          disabled={fetchingRecs}
                        >
                          {fetchingRecs ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                          <span>{fetchingRecs ? "正在推薦..." : "立即擴充相關推薦曲目"}</span>
                        </button>
                      )}

                      {queue.length === 0 ? (
                        <div className="empty-state" style={{ padding: "28px 10px" }}>
                          <ListMusic size={26} />
                          <div style={{ fontSize: 12.5 }}>佇列尚無歌曲</div>
                        </div>
                      ) : (
                        queue.map((track, idx) => {
                          const isCur = idx === currentIndex;
                          return (
                            <div
                              key={`${track.videoId}-${idx}`}
                              className={`queue-item ${isCur ? "current" : ""}`}
                              onDoubleClick={() => void playQueueIndex(idx, false)}
                            >
                              <AlbumArt
                                thumbnailUrl={track.thumbnailUrl}
                                videoId={track.videoId}
                                title={track.title}
                                artist={track.artist}
                                className="queue-thumb"
                              />
                              <div
                                className="queue-info"
                                style={{ cursor: "pointer" }}
                                onClick={() => void playQueueIndex(idx, false)}
                              >
                                <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>
                                  {track.title}
                                </div>
                                <div className="truncate" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                                  {track.artist}
                                </div>
                                {track.isAutoRecommended && (
                                  <span className="auto-tag">
                                    <Sparkles size={9} /> 自動推薦
                                  </span>
                                )}
                              </div>
                              {!track.localFileUrl &&
                                !track.localFilePath &&
                                !track.videoId.startsWith("local-") && (
                                  <button
                                    type="button"
                                    className="action-icon-btn"
                                    title="下載離線音檔 (含封面與標籤)"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleDownloadTrack(track);
                                    }}
                                    disabled={downloadingIds.has(track.videoId)}
                                  >
                                    {downloadingIds.has(track.videoId) ? (
                                      <Loader2 size={13} className="spin" />
                                    ) : (
                                      <Download size={13} />
                                    )}
                                  </button>
                                )}
                              <button
                                type="button"
                                className="action-icon-btn"
                                title="移除"
                                onClick={() => removeFromQueue(idx)}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </>
                  )}

                  {sideTab === "lyrics" && (
                    <>
                      {!currentTrack ? (
                        <div className="empty-state">
                          <Mic2 size={26} />
                          <div style={{ fontSize: 12.5 }}>播放歌曲後即可檢視即時歌詞</div>
                        </div>
                      ) : lyricsLoading ? (
                        <div className="empty-state">
                          <Loader2 size={24} className="spin" />
                          <div style={{ fontSize: 12.5 }}>載入歌詞中...</div>
                        </div>
                      ) : lyrics?.hasSynced && lyrics.syncedLines.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 4px" }}>
                          {lyrics.syncedLines.map((line, i) => {
                            const active = i === activeLyricIndex;
                            return (
                              <div
                                key={`${line.timeMs}-${i}`}
                                ref={active ? lyricsSideActiveRef : null}
                                onClick={() => seekTo(Math.max(0, line.timeMs / 1000 - lyricsOffset))}
                                style={{
                                  cursor: "pointer",
                                  padding: "6px 8px",
                                  borderRadius: 8,
                                  fontSize: active ? 14.5 : 13,
                                  fontWeight: active ? 700 : 500,
                                  color: active ? "#fff" : "rgba(255,255,255,0.48)",
                                  background: active ? "rgba(var(--accent-rgb-1), 0.3)" : "transparent",
                                  lineHeight: 1.5,
                                  transition: "all 0.16s ease",
                                }}
                              >
                                {line.text}
                              </div>
                            );
                          })}
                        </div>
                      ) : lyrics?.plainText ? (
                        <pre className="plain-lyrics-text" style={{ fontSize: 13, lineHeight: 1.75 }}>
                          {lyrics.plainText}
                        </pre>
                      ) : (
                        <div className="empty-state">
                          <Mic2 size={26} />
                          <div style={{ fontSize: 12.5 }}>暫無可用歌詞</div>
                        </div>
                      )}
                    </>
                  )}

                  {sideTab === "info" && (
                    <>
                      {!currentTrack ? (
                        <div className="empty-state">
                          <Info size={26} />
                          <div style={{ fontSize: 12.5 }}>播放歌曲後將顯示 YTMAPI 曲目詳細資訊</div>
                        </div>
                      ) : (
                        <>
                          <div className="info-card">
                            <AlbumArt
                              thumbnailUrl={songDetail?.thumbnailUrl || currentTrack.thumbnailUrl}
                              videoId={currentTrack.videoId}
                              title={songDetail?.title || currentTrack.title}
                              artist={songDetail?.artist || currentTrack.artist}
                              style={{
                                width: "100%",
                                aspectRatio: "1 / 1",
                                borderRadius: 10,
                                objectFit: "cover",
                              }}
                            />
                            <div style={{ fontSize: 15, fontWeight: 700 }}>
                              {songDetail?.title || currentTrack.title}
                            </div>
                            <button
                              type="button"
                              className="entity-link"
                              style={{ fontSize: 12.5, color: "var(--text-secondary)" }}
                              onClick={() =>
                                void openEntityPage("artist", songDetail?.artist || currentTrack.artist)
                              }
                            >
                              {songDetail?.artist || currentTrack.artist}
                            </button>
                            <div className="info-kv">
                              <span className="info-k">專輯</span>
                              <span className="info-v truncate">
                                {songDetail?.album || currentTrack.album || "單曲 / 未分類"}
                              </span>
                            </div>
                            <div className="info-kv">
                              <span className="info-k">播放熱度</span>
                              <span className="info-v">{songDetail?.viewCountText || "—"}</span>
                            </div>
                            <div className="info-kv">
                              <span className="info-k">音訊規格</span>
                              <span className="info-v">
                                {streamInfo
                                  ? `${streamInfo.acodec} · ${streamInfo.abr} · ${streamInfo.sampleRate}`
                                  : "解析中"}
                              </span>
                            </div>
                            <div className="info-kv">
                              <span className="info-k">串流引擎</span>
                              <span className="info-v">{streamInfo?.engineUsed || "—"}</span>
                            </div>
                          </div>

                          {songDetail && songDetail.relatedTracks.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: "var(--text-secondary)",
                                  padding: "4px 2px",
                                }}
                              >
                                YTMAPI 相關歌曲推薦
                              </div>
                              {songDetail.relatedTracks.slice(0, 8).map((rel) => (
                                <div
                                  key={rel.videoId}
                                  className="queue-item"
                                  onClick={() => playSingleTrack(rel)}
                                  style={{ cursor: "pointer" }}
                                >
                                  <AlbumArt
                                    thumbnailUrl={rel.thumbnailUrl}
                                    videoId={rel.videoId}
                                    title={rel.title}
                                    artist={rel.artist}
                                    className="queue-thumb"
                                  />
                                  <div className="queue-info">
                                    <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>
                                      {rel.title}
                                    </div>
                                    <div
                                      className="truncate"
                                      style={{ fontSize: 11, color: "var(--text-secondary)" }}
                                    >
                                      {rel.artist}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="action-icon-btn"
                                    title="加入佇列"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      addTrackToQueue(rel);
                                    }}
                                  >
                                    <Plus size={13} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </aside>
            )}
          </div>

          {/* Sleep Timer Popover */}
          {sleepMenuOpen && (
            <div className="sleep-popover">
              <div className="playlist-popover-title" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Clock size={12} />
                睡眠定時器 (結束前 10 秒漸弱)
              </div>
              {([15, 30, 45, 60] as const).map((mins) => (
                <button
                  key={mins}
                  type="button"
                  className="playlist-popover-item"
                  onClick={() => startSleepTimer(mins)}
                >
                  {mins} 分鐘後停止
                </button>
              ))}
              <button
                type="button"
                className="playlist-popover-item"
                onClick={() => startSleepTimer("track")}
              >
                播完當前歌曲後停止
              </button>
              {sleepMode !== "off" && (
                <button
                  type="button"
                  className="playlist-popover-item"
                  style={{ color: "#fda4af" }}
                  onClick={() => startSleepTimer("off")}
                >
                  關閉定時器
                </button>
              )}
            </div>
          )}

          {/* Bottom Fixed Transport Bar with Mini Live Spectrum */}
          <footer className="player-bar">
            <div className="player-left">
              {currentTrack ? (
                <>
                  <AlbumArt
                    thumbnailUrl={currentTrack.thumbnailUrl}
                    videoId={currentTrack.videoId}
                    title={currentTrack.title}
                    artist={currentTrack.artist}
                    className="player-cover"
                    onClick={() => setNavTab("lyrics")}
                    style={{ cursor: "pointer" }}
                  />
                  <div className="player-track-meta">
                    <div
                      className="player-title truncate"
                      title={currentTrack.title}
                      onClick={() => setNavTab("lyrics")}
                      style={{ cursor: "pointer" }}
                    >
                      {currentTrack.title}
                    </div>
                    <div className="player-artist-row">
                      <button
                        type="button"
                        className="player-artist entity-link truncate"
                        title={currentTrack.artist}
                        onClick={() => void openEntityPage("artist", currentTrack.artist)}
                      >
                        {currentTrack.artist}
                      </button>
                      {streamInfo && (
                        <span className="quality-badge">
                          {streamInfo.engineUsed === "local-file" ||
                          streamInfo.engineUsed === "local-proxy" ||
                          streamInfo.acodec.toLowerCase().includes("flac")
                            ? "無損"
                            : pureDirect
                              ? `Direct · ${streamInfo.abr}`
                              : streamInfo.abr}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`action-icon-btn ${favoriteIds.has(currentTrack.videoId) ? "liked" : ""}`}
                    title="收藏 / 取消收藏"
                    onClick={() => toggleFavorite(currentTrack)}
                  >
                    <Heart
                      size={16}
                      fill={favoriteIds.has(currentTrack.videoId) ? "currentColor" : "none"}
                    />
                  </button>
                  {!currentTrack.localFileUrl &&
                    !currentTrack.localFilePath &&
                    !currentTrack.videoId.startsWith("local-") && (
                      <button
                        type="button"
                        className="action-icon-btn"
                        title="下載離線音檔 (含封面與標籤)"
                        onClick={() => void handleDownloadTrack(currentTrack)}
                        disabled={downloadingIds.has(currentTrack.videoId)}
                      >
                        {downloadingIds.has(currentTrack.videoId) ? (
                          <Loader2 size={15} className="spin" />
                        ) : (
                          <Download size={15} />
                        )}
                      </button>
                    )}
                </>
              ) : (
                <div className="player-track-meta">
                  <div className="player-title truncate">AetherMusic v{appVersion}</div>
                  <div className="player-artist truncate">Pure Direct 無壓縮音訊 · AI DJ Mix</div>
                </div>
              )}
            </div>

            <div className="player-center">
              <div className="transport-controls">
                <button
                  type="button"
                  className={`ctrl-btn ${shuffle ? "active" : ""}`}
                  title="隨機播放"
                  onClick={() => setShuffle((s) => !s)}
                >
                  <Shuffle size={16} />
                </button>
                <button
                  type="button"
                  className="ctrl-btn"
                  title="上一首"
                  onClick={handlePrev}
                  disabled={!currentTrack}
                >
                  <SkipBack size={18} fill="currentColor" />
                </button>
                <button
                  type="button"
                  className="play-main-btn"
                  title={isPlaying ? "暫停 (Space)" : "播放 (Space)"}
                  onClick={() => void togglePlayPause()}
                >
                  {isBuffering ? (
                    <Loader2 size={18} className="spin" />
                  ) : isPlaying ? (
                    <Pause size={18} fill="currentColor" />
                  ) : (
                    <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />
                  )}
                </button>
                <button
                  type="button"
                  className="ctrl-btn"
                  title="下一首"
                  onClick={() => void handleNext(djEnabled || crossfadeSec > 0)}
                  disabled={!currentTrack}
                >
                  <SkipForward size={18} fill="currentColor" />
                </button>
                <button
                  type="button"
                  className={`ctrl-btn ${repeatMode !== "off" ? "active" : ""}`}
                  title={`重複模式: ${repeatMode === "off" ? "關閉" : repeatMode === "all" ? "列表循環" : "單曲循環"}`}
                  onClick={cycleRepeatMode}
                >
                  {repeatMode === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
                </button>
              </div>

              <div className="progress-row">
                <span className="time-label tabular-nums">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  className="range-slider"
                  min={0}
                  max={duration > 0 ? duration : 100}
                  step={0.1}
                  value={Math.min(currentTime, duration > 0 ? duration : 100)}
                  style={{ "--progress": `${progressPct}%` } as React.CSSProperties}
                  onChange={(e) => seekTo(Number(e.target.value))}
                  disabled={!currentTrack}
                />
                <span className="time-label tabular-nums">{formatTime(duration)}</span>
              </div>
            </div>

            <div className="player-right">
              <SpectrumCanvas
                analyser={analyser}
                isPlaying={isPlaying}
                variant="mini"
                mode={visualizerStyle}
              />
              <button
                type="button"
                className={`ctrl-btn ${sleepMode !== "off" ? "active" : ""}`}
                title={
                  sleepMode === "timer"
                    ? `睡眠定時剩餘 ${formatTime(sleepRemainingSec)}`
                    : sleepMode === "track"
                      ? "播完本首停止"
                      : "睡眠定時器"
                }
                onClick={() => setSleepMenuOpen((v) => !v)}
              >
                <Moon size={16} />
              </button>
              <button
                type="button"
                className={`ctrl-btn ${navTab === "dj" ? "active" : ""}`}
                title="AI DJ Mix 混音台"
                onClick={() => setNavTab(navTab === "dj" ? "home" : "dj")}
              >
                <Radio size={16} />
              </button>
              <button
                type="button"
                className={`ctrl-btn ${navTab === "lyrics" ? "active" : ""}`}
                title="動態歌詞視圖"
                onClick={() => setNavTab(navTab === "lyrics" ? "home" : "lyrics")}
              >
                <Mic2 size={16} />
              </button>
              <button
                type="button"
                className={`ctrl-btn ${sidePanelOpen && sideTab === "queue" ? "active" : ""}`}
                title="播放佇列面板"
                onClick={() => {
                  if (!sidePanelOpen) {
                    setSidePanelOpen(true);
                    setSideTab("queue");
                  } else if (sideTab !== "queue") {
                    setSideTab("queue");
                  } else {
                    setSidePanelOpen(false);
                  }
                }}
              >
                <ListMusic size={16} />
              </button>
              <div className="volume-wrap">
                <button
                  type="button"
                  className="ctrl-btn"
                  title={muted ? "取消靜音" : "靜音"}
                  onClick={() => setMuted((m) => !m)}
                >
                  {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  className="range-slider"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  style={{ "--progress": `${volumePct}%` } as React.CSSProperties}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    if (v > 0 && muted) setMuted(false);
                  }}
                />
              </div>
            </div>
          </footer>

          {/* Mobile / Android Bottom Navigation Bar */}
          <nav className="mobile-bottom-nav" aria-label="行動導覽列">
            <button
              type="button"
              className={`mobile-nav-btn ${navTab === "home" ? "active" : ""}`}
              onClick={() => setNavTab("home")}
            >
              <Home size={18} />
              <span>首頁</span>
            </button>
            <button
              type="button"
              className={`mobile-nav-btn ${navTab === "search" ? "active" : ""}`}
              onClick={() => setNavTab("search")}
            >
              <Search size={18} />
              <span>搜尋</span>
            </button>
            <button
              type="button"
              className={`mobile-nav-btn ${navTab === "dj" ? "active" : ""}`}
              onClick={() => setNavTab("dj")}
            >
              <Radio size={18} />
              <span>DJ Mix</span>
            </button>
            <button
              type="button"
              className={`mobile-nav-btn ${navTab === "lyrics" ? "active" : ""}`}
              onClick={() => setNavTab("lyrics")}
            >
              <Mic2 size={18} />
              <span>歌詞</span>
            </button>
            <button
              type="button"
              className={`mobile-nav-btn ${navTab === "queue" ? "active" : ""}`}
              onClick={() => setNavTab("queue")}
            >
              <ListMusic size={18} />
              <span>佇列</span>
            </button>
            <button
              type="button"
              className={`mobile-nav-btn ${navTab === "library" || navTab === "settings" ? "active" : ""}`}
              onClick={() => setNavTab(navTab === "library" ? "settings" : "library")}
            >
              <Library size={18} />
              <span>媒體庫</span>
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

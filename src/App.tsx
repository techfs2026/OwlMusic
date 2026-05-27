import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Cassette from "./components/Cassette";
import SpectrumGL from "./components/SpectrumGL";
import LyricsView from "./components/LyricsView";
import Icon from "./components/Icon";
import { api, LyricLine, ScannedTrack, TrackInfo, TrackMetadata } from "./lib/api";
import { fmtTime, parseName } from "./lib/utils";

interface PlaylistItem {
  path: string;
  name: string;
  /** Title: tag value if known, else parsed from filename. Always non-empty. */
  title: string;
  /** Artist: tag value if known, else parsed; null when neither source has one. */
  artist: string | null;
}

const STATE_POLL_MS = 200;
const SPEC_POLL_MS = 33;

export default function App() {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [plIndex, setPlIndex] = useState(0);

  const [metadata, setMetadata] = useState<TrackMetadata | null>(null);
  const [format, setFormat] = useState<{
    sourceSr: number;
    sourceCh: number;
    sourceBits: number | null;
    outputSr: number;
    outputCh: number;
    bitPerfect: boolean;
  } | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);

  const [bars, setBars] = useState<number[]>(() => new Array(48).fill(0));
  const [error, setError] = useState<string | null>(null);

  const [loadProgress, setLoadProgress] = useState<{
    cur: number;
    tot: number;
    label: string;
  } | null>(null);

  const seekDragRef = useRef(false);
  const [seekValue, setSeekValue] = useState(0);

  const [showPlaylist, setShowPlaylist] = useState(false);
  const playlistWrapRef = useRef<HTMLDivElement | null>(null);
  const playlistRef = useRef<PlaylistItem[]>([]);
  const plIndexRef = useRef(0);
  const wasPlayingRef = useRef(false);

  // Lyrics + view toggle. `userPickedView` is true once the user has manually
  // toggled in this session — until then we auto-select based on whether the
  // current track has an .lrc. After that, we respect the user's choice and
  // simply fall back to spectrum on tracks without lyrics.
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [view, setView] = useState<"spectrum" | "lyrics">("spectrum");
  const userPickedViewRef = useRef(false);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);
  useEffect(() => {
    plIndexRef.current = plIndex;
  }, [plIndex]);

  const currentTrack = playlist[plIndex];

  const display = useMemo(() => {
    if (!currentTrack) return { title: "", artist: "" };
    const t = metadata?.title?.trim() || currentTrack.title;
    const a = metadata?.artist?.trim() || currentTrack.artist || "";
    return { title: t, artist: a };
  }, [metadata, currentTrack]);

  const coverDataUrl = useMemo(() => {
    if (!metadata?.cover_base64) return null;
    const mime = metadata.cover_mime || "image/jpeg";
    return `data:${mime};base64,${metadata.cover_base64}`;
  }, [metadata]);

  // Energy for reel spin: mean of bars (0..1).
  const energy = useMemo(() => {
    if (!bars.length) return 0;
    let sum = 0;
    for (const b of bars) sum += b;
    return Math.min(1, sum / bars.length);
  }, [bars]);

  // ── Track loading (ref-stored so closures over playlist stay fresh) ──────
  const loadAtRef = useRef<(idx: number, list?: PlaylistItem[]) => Promise<void>>(
    async () => { },
  );
  useEffect(() => {
    loadAtRef.current = async (idx: number, list?: PlaylistItem[]) => {
      const useList = list ?? playlist;
      if (!useList.length) return;
      const safe = ((idx % useList.length) + useList.length) % useList.length;
      setPlIndex(safe);
      const t = useList[safe];
      setError(null);
      try {
        const info: TrackInfo = await api.openFile(t.path);
        setMetadata(info.metadata);
        setDuration(info.duration_secs);
        setFormat({
          sourceSr: info.source_sample_rate,
          sourceCh: info.source_channels,
          sourceBits: info.source_bits_per_sample,
          outputSr: info.output_sample_rate,
          outputCh: info.output_channels,
          bitPerfect: info.bit_perfect,
        });
        setPosition(0);
        setSeekValue(0);
        setPlaying(true);

        // Load lyrics (soft-fails to []). Auto-switch the view until the user
        // expresses a preference: lyrics if present, otherwise spectrum.
        try {
          const ly = await api.readLyrics(t.path);
          console.log(`[lyrics] ${t.path} → ${ly.length} lines`);
          setLyrics(ly);
          if (!userPickedViewRef.current) {
            setView(ly.length > 0 ? "lyrics" : "spectrum");
          }
        } catch (err) {
          console.error("[lyrics] read_lyrics failed:", err);
          setLyrics([]);
          if (!userPickedViewRef.current) setView("spectrum");
        }
      } catch (e) {
        setError(`无法播放该文件: ${e}`);
      }
    };
  }, [playlist]);

  // ── State + spectrum polling ──────────────────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        const s = await api.getState();
        const isPlaying = s.state === "playing";
        setPosition(s.position_secs);
        setDuration((d) => (s.duration_secs > 0 ? s.duration_secs : d));
        setPlaying(isPlaying);
        if (!seekDragRef.current && s.duration_secs > 0) {
          setSeekValue(Math.floor((s.position_secs / s.duration_secs) * 1000));
        }
        // Auto-advance: track was playing, has now stopped near the end → next.
        // List loops because loadAt wraps the index modulo playlist length.
        if (
          wasPlayingRef.current &&
          !isPlaying &&
          s.duration_secs > 0 &&
          s.position_secs >= s.duration_secs - 0.6 &&
          playlistRef.current.length > 0
        ) {
          loadAtRef.current(plIndexRef.current + 1);
        }
        wasPlayingRef.current = isPlaying;
      } catch { }
    }, STATE_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        setBars(await api.getSpectrum());
      } catch { }
    }, SPEC_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;
      setLoadProgress({ cur: 0, tot: 0, label: "READING FOLDER…" });
      const tracks: ScannedTrack[] = await api.scanFolder(selected);
      if (!tracks.length) {
        setLoadProgress(null);
        setError("没有找到音频文件");
        return;
      }
      const items: PlaylistItem[] = tracks.map((t) => {
        const parsed = parseName(t.name);
        const tagTitle = t.title?.trim();
        const tagArtist = t.artist?.trim();
        return {
          path: t.path,
          name: t.name,
          title: tagTitle || parsed.title,
          artist: tagArtist || parsed.artist,
        };
      });
      const total = items.length;
      const step = Math.max(1, Math.floor(total / 12));
      let i = 0;
      const tick = () => {
        i = Math.min(total, i + step);
        setLoadProgress({
          cur: i,
          tot: total,
          label: i < total ? "READING FOLDER…" : "LOADING…",
        });
        if (i < total) {
          requestAnimationFrame(tick);
        } else {
          setLoadProgress(null);
          setPlaylist(items);
          setPlIndex(0);
          setTimeout(() => loadAtRef.current(0, items), 0);
        }
      };
      requestAnimationFrame(tick);
    } catch (e) {
      setLoadProgress(null);
      setError(`${e}`);
    }
  }, []);

  const handlePlayPause = useCallback(async () => {
    if (!currentTrack) {
      await handleOpenFolder();
      return;
    }
    try {
      if (playing) {
        await api.pause();
        setPlaying(false);
      } else {
        await api.play();
        setPlaying(true);
      }
    } catch (e) {
      setError(`${e}`);
    }
  }, [playing, currentTrack, handleOpenFolder]);

  const handlePrev = useCallback(() => {
    if (playlist.length > 1) loadAtRef.current(plIndex - 1);
    else if (currentTrack) api.seek(0).catch(() => { });
  }, [playlist.length, plIndex, currentTrack]);

  const handleNext = useCallback(() => {
    if (playlist.length > 1) loadAtRef.current(plIndex + 1);
  }, [playlist.length, plIndex]);

  const handleSeek = useCallback(
    (val: number) => {
      if (!duration) return;
      const secs = (val / 1000) * duration;
      api.seek(secs).catch((e) => setError(`${e}`));
      setPosition(secs);
    },
    [duration],
  );

  const handleSeekSecs = useCallback(
    (secs: number) => {
      if (!duration) return;
      const clamped = Math.max(0, Math.min(duration, secs));
      api.seek(clamped).catch((e) => setError(`${e}`));
      setPosition(clamped);
      setSeekValue(Math.floor((clamped / duration) * 1000));
    },
    [duration],
  );

  const handleToggleView = useCallback(() => {
    userPickedViewRef.current = true;
    setView((v) => (v === "spectrum" ? "lyrics" : "spectrum"));
  }, []);

  const handleVolume = useCallback((v: number) => {
    setVolume(v);
    api.setVolume(v).catch(() => { });
  }, []);

  // Close the playlist dropdown when clicking outside of it.
  useEffect(() => {
    if (!showPlaylist) return;
    const onDown = (e: MouseEvent) => {
      if (
        playlistWrapRef.current &&
        !playlistWrapRef.current.contains(e.target as Node)
      ) {
        setShowPlaylist(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showPlaylist]);

  const handlePickTrack = useCallback((idx: number) => {
    setShowPlaylist(false);
    loadAtRef.current(idx);
  }, []);


  return (
    <div id="app">
      {/* TOP BAR */}
      <div id="topbar">
        <span className="brand">MusicOwl</span>
        <span className="ver">v0.1</span>
        <div style={{ flex: 1 }} />
        {playlist.length > 0 && (
          <div className="pl-indicator-wrap" ref={playlistWrapRef}>
            <button
              id="pl-indicator"
              className={showPlaylist ? "open" : ""}
              onClick={() => setShowPlaylist((v) => !v)}
              title="切换播放列表"
            >
              {plIndex + 1}/{playlist.length}
              <Icon name="chevron-down" size={11} />
            </button>
            {showPlaylist && (
              <div className="pl-dropdown" role="listbox">
                {playlist.map((item, idx) => (
                  <button
                    key={`${item.path}-${idx}`}
                    className={`pl-item${idx === plIndex ? " active" : ""}`}
                    onClick={() => handlePickTrack(idx)}
                  >
                    <span className="pl-item-num">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="pl-item-text">
                      <span className="pl-item-title">
                        {item.title || item.name}
                      </span>
                      {item.artist && (
                        <span className="pl-item-artist">{item.artist}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          className="top-btn"
          onClick={handleOpenFolder}
          title="选择专辑文件夹（自动加载音频、封面、歌词）"
        >
          <Icon name="folder-open" size={14} />
          <span>打开专辑</span>
        </button>
      </div>

      {/* MAIN STAGE */}
      <div id="main-window">
        <Cassette
          title={display.title}
          artist={display.artist}
          playing={playing}
          energy={energy}
          coverDataUrl={coverDataUrl}
          sampleRateHz={format?.sourceSr ?? 0}
          bitsPerSample={format?.sourceBits ?? null}
          channelCount={format?.sourceCh ?? 0}
          durationSecs={duration}
          positionSecs={position}
          bitPerfect={format?.bitPerfect ?? null}
        />

        <div id="spectrum-area">
          <div id="spec-wrap">
            {view === "spectrum" ? (
              <>
                <SpectrumGL bars={bars} active={playing} />
                <div className="spec-grid-line" style={{ top: "25%" }} />
                <div className="spec-grid-line" style={{ top: "50%" }} />
                <div className="spec-grid-line" style={{ top: "75%" }} />
              </>
            ) : (
              <LyricsView
                lyrics={lyrics}
                positionSecs={position}
                onSeek={handleSeekSecs}
              />
            )}
            {lyrics.length > 0 && (
              <button
                className="view-toggle"
                onClick={handleToggleView}
                title={view === "spectrum" ? "切换到歌词" : "切换到频谱"}
              >
                <span className={view === "spectrum" ? "active" : ""}>频谱</span>
                <span className="sep">·</span>
                <span className={view === "lyrics" ? "active" : ""}>歌词</span>
              </button>
            )}
            {!currentTrack && !loadProgress && (
              <button
                type="button"
                className="empty-hint"
                onClick={handleOpenFolder}
                title="选择专辑文件夹（自动加载音频、封面、歌词）"
              >
                <div className="empty-hint-title">按专辑播放</div>
                <div className="empty-hint-sub">
                  选择一个文件夹 · 自动识别音频、封面与歌词
                </div>
                <div className="empty-hint-cta">
                  <Icon name="folder-open" size={14} />
                  <span>打开专辑</span>
                </div>
              </button>
            )}
          </div>
        </div>

        <div id="loading-overlay" className={loadProgress ? "show" : ""}>
          <div id="prog-label">{loadProgress?.label ?? "READING FOLDER…"}</div>
          <div id="prog-track">
            <div
              id="prog-bar"
              style={{
                width: loadProgress
                  ? `${loadProgress.tot > 0
                    ? Math.round((loadProgress.cur / loadProgress.tot) * 100)
                    : 0
                  }%`
                  : "0%",
              }}
            />
          </div>
          <div id="prog-count">
            {loadProgress?.cur ?? 0} / {loadProgress?.tot ?? 0}
          </div>
        </div>
      </div>

      {/* BOTTOM: playlist + controls */}
      <div id="bottom">

        <div id="controls">
          <button
            className="ctrl-btn"
            onClick={handlePrev}
            title="上一首"
            disabled={!currentTrack}
          >
            <Icon name="skip-back" size={18} />
          </button>
          <button id="play-btn" onClick={handlePlayPause} title="播放 / 暂停">
            <Icon name={playing ? "pause" : "play"} size={24} />
          </button>
          <button
            className="ctrl-btn"
            onClick={handleNext}
            title="下一首"
            disabled={!currentTrack}
          >
            <Icon name="skip-forward" size={18} />
          </button>
          <span className="time-lbl">{fmtTime(position)}</span>
          <input
            type="range"
            id="seek"
            min={0}
            max={1000}
            step={1}
            value={seekValue}
            style={{ "--val": seekValue / 10 } as React.CSSProperties}
            onMouseDown={() => (seekDragRef.current = true)}
            onTouchStart={() => (seekDragRef.current = true)}
            onMouseUp={() => (seekDragRef.current = false)}
            onTouchEnd={() => (seekDragRef.current = false)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSeekValue(v);
              handleSeek(v);
            }}
          />
          <span className="time-lbl">{fmtTime(duration)}</span>
          <div id="vol-wrap">
            <Icon name={volume === 0 ? "volume-muted" : "volume"} size={16} />
            <input
              type="range"
              id="vol"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              style={{ "--val": Math.round(volume * 100) } as React.CSSProperties}
              onChange={(e) => handleVolume(Number(e.target.value) / 100)}
            />
          </div>
        </div>

        <div id="error-bar" className={error ? "show" : ""}>
          {error ? `⚠ ${error}` : ""}
        </div>
      </div>
    </div>
  );
}
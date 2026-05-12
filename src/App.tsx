import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Cassette from "./components/Cassette";
import SpectrumGL from "./components/SpectrumGL";
import Icon from "./components/Icon";
import { api, ScannedTrack, TrackMetadata } from "./lib/api";
import { fmtTime, parseName, trim } from "./lib/utils";

interface PlaylistItem {
  path: string;
  name: string;
  fallbackTitle: string;
  fallbackArtist: string;
}

const AUDIO_EXTS = /\.(mp3|m4a|ogg|wav|flac|aac|opus|weba|webm)$/i;
const STATE_POLL_MS = 200;
const SPEC_POLL_MS = 33;

export default function App() {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [plIndex, setPlIndex] = useState(0);

  const [metadata, setMetadata] = useState<TrackMetadata | null>(null);
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

  const currentTrack = playlist[plIndex];

  const display = useMemo(() => {
    if (!currentTrack) return { title: "", artist: "" };
    const t = metadata?.title?.trim() || currentTrack.fallbackTitle;
    const a = metadata?.artist?.trim() || currentTrack.fallbackArtist;
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

  // Real dB readout: backend maps -90..0 dBFS into bars[i] in [0,1].
  // We take the peak bar as the loudest band, convert back to dB.
  const dbReadout = useMemo(() => {
    if (!playing) return "— dB";
    let peak = 0;
    for (const b of bars) if (b > peak) peak = b;
    if (peak < 0.01) return "—∞ dB";
    const db = -90 + peak * 90; // inverse of backend map
    return `${db.toFixed(0)} dB`;
  }, [bars, playing]);

  // ── Track loading (ref-stored so closures over playlist stay fresh) ──────
  const loadAtRef = useRef<(idx: number, list?: PlaylistItem[]) => Promise<void>>(
    async () => {},
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
        const info = await api.openFile(t.path);
        setMetadata(info.metadata);
        setDuration(info.duration_secs);
        setPosition(0);
        setSeekValue(0);
        setPlaying(true);
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
        setPosition(s.position_secs);
        setDuration((d) => (s.duration_secs > 0 ? s.duration_secs : d));
        setPlaying(s.state === "playing");
        if (!seekDragRef.current && s.duration_secs > 0) {
          setSeekValue(Math.floor((s.position_secs / s.duration_secs) * 1000));
        }
      } catch {}
    }, STATE_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        setBars(await api.getSpectrum());
      } catch {}
    }, SPEC_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleOpenFiles = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [
          {
            name: "Audio",
            extensions: ["mp3", "m4a", "ogg", "wav", "flac", "aac", "opus", "weba", "webm"],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const items: PlaylistItem[] = paths
        .filter((p) => AUDIO_EXTS.test(p))
        .map((p) => {
          const name = p.split(/[\\/]/).pop() || p;
          const { title, artist } = parseName(name);
          return { path: p, name, fallbackTitle: title, fallbackArtist: artist };
        });
      if (!items.length) {
        setError("没有找到音频文件");
        return;
      }
      items.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
      setPlaylist(items);
      setPlIndex(0);
      setTimeout(() => loadAtRef.current(0, items), 0);
    } catch (e) {
      setError(`${e}`);
    }
  }, []);

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
        const { title, artist } = parseName(t.name);
        return {
          path: t.path,
          name: t.name,
          fallbackTitle: title,
          fallbackArtist: artist,
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
      await handleOpenFiles();
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
  }, [playing, currentTrack, handleOpenFiles]);

  const handlePrev = useCallback(() => {
    if (playlist.length > 1) loadAtRef.current(plIndex - 1);
    else if (currentTrack) api.seek(0).catch(() => {});
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

  const handleVolume = useCallback((v: number) => {
    setVolume(v);
    api.setVolume(v).catch(() => {});
  }, []);

  return (
    <div id="app">
      {/* TOP BAR */}
      <div id="topbar">
        <span className="brand">MUSE</span>
        <span className="ver">v0.1</span>
        <div style={{ flex: 1 }} />
        {playlist.length > 0 && (
          <span id="pl-indicator">
            {plIndex + 1}/{playlist.length}
          </span>
        )}
        <button className="top-btn" onClick={handleOpenFiles}>
          <Icon name="file-music" size={14} />
          <span>文件</span>
        </button>
        <button className="top-btn" onClick={handleOpenFolder}>
          <Icon name="folder-open" size={14} />
          <span>文件夹</span>
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
        />

        <div id="spectrum-area">
          <div id="spec-header">
            <span>SPECTRUM · 48 BANDS · 40Hz – 20kHz</span>
            <span>{dbReadout}</span>
          </div>
          <div id="spec-wrap">
            <SpectrumGL bars={bars} active={playing} />
            <div className="spec-grid-line" style={{ top: "25%" }} />
            <div className="spec-grid-line" style={{ top: "50%" }} />
            <div className="spec-grid-line" style={{ top: "75%" }} />
          </div>
        </div>

        <div id="loading-overlay" className={loadProgress ? "show" : ""}>
          <div id="prog-label">{loadProgress?.label ?? "READING FOLDER…"}</div>
          <div id="prog-track">
            <div
              id="prog-bar"
              style={{
                width: loadProgress
                  ? `${
                      loadProgress.tot > 0
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
        <div id="pl-strip" className={playlist.length > 0 ? "show" : ""}>
          <span className="label">TRACK</span>
          <span id="pl-track-name">
            {currentTrack ? trim(display.title, 64) : "—"}
          </span>
          <span id="pl-count">
            {playlist.length ? `${plIndex + 1} / ${playlist.length}` : "0 / 0"}
          </span>
          <button
            className="pl-nav"
            onClick={handlePrev}
            disabled={playlist.length < 2}
          >
            ‹
          </button>
          <button
            className="pl-nav"
            onClick={handleNext}
            disabled={playlist.length < 2}
          >
            ›
          </button>
        </div>

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
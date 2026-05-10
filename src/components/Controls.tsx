import React, { useCallback } from "react";
import type { PlayerStateInfo } from "../types";

interface ControlsProps {
  playerState: PlayerStateInfo;
  hasTrack: boolean;
  isLoading?: boolean;
  onTogglePlay: () => void;
  onSeek: (secs: number) => void;
  onVolumeChange: (vol: number) => void;
  onOpenFile: () => void;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const Controls: React.FC<ControlsProps> = ({
  playerState,
  hasTrack,
  isLoading = false,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onOpenFile,
}) => {
  const { state, position_secs, duration_secs, volume } = playerState;
  const isPlaying = state === "playing";
  const progress = duration_secs > 0 ? position_secs / duration_secs : 0;

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!hasTrack || duration_secs === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      onSeek(ratio * duration_secs);
    },
    [hasTrack, duration_secs, onSeek]
  );

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onVolumeChange(parseFloat(e.target.value));
    },
    [onVolumeChange]
  );

  return (
    <div className="controls">
      {/* Progress bar */}
      <div className="progress-area">
        <span className="time-label">
          {isLoading ? "—" : formatTime(position_secs)}
        </span>
        <div
          className="progress-bar"
          onClick={handleProgressClick}
          style={{
            cursor: hasTrack && !isLoading ? "pointer" : "default",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          <div
            className="progress-fill"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="time-label">
          {isLoading ? "…" : formatTime(duration_secs)}
        </span>
      </div>
      {isLoading && (
        <div className="loading-hint" aria-live="polite">
          Decoding audio…
        </div>
      )}

      {/* Buttons row */}
      <div className="buttons-row">
        {/* Open file */}
        <button
          className="btn-icon"
          onClick={onOpenFile}
          disabled={isLoading}
          title={isLoading ? "Loading…" : "Open file"}
        >
          <FolderIcon />
        </button>

        {/* Play/Pause */}
        <button
          className={`btn-play ${!hasTrack || isLoading ? "btn-disabled" : ""}`}
          onClick={onTogglePlay}
          disabled={!hasTrack || isLoading}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        {/* Volume */}
        <div className="volume-control">
          <VolumeIcon />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={handleVolumeChange}
            className="volume-slider"
          />
        </div>
      </div>
    </div>
  );
};

// ---- SVG icons ----

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
  </svg>
);

const VolumeIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
  </svg>
);

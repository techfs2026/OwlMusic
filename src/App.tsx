import React from "react";
import { usePlayer } from "./hooks/usePlayer";
import { Cover } from "./components/Cover";
import { Controls } from "./components/Controls";
import { TrackInfo } from "./components/TrackInfo";

function App() {
  const {
    track,
    playerState,
    error,
    isLoading,
    openFile,
    togglePlay,
    seek,
    setVolume,
  } = usePlayer();

  const isPlaying = playerState.state === "playing";

  return (
    <div className="app">
      <div className="player-card">
        {/* Header */}
        <div className="player-header">
          <span className="app-name">MUSE</span>
          <span className="app-version">v0.1</span>
        </div>

        {/* Cover art */}
        <Cover
          metadata={track?.metadata ?? null}
          isPlaying={isPlaying}
        />

        {/* Track info */}
        <TrackInfo metadata={track?.metadata ?? null} />

        {/* Controls */}
        <Controls
          playerState={playerState}
          hasTrack={track !== null}
          isLoading={isLoading}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onVolumeChange={setVolume}
          onOpenFile={openFile}
        />

        {/* Error display */}
        {error && (
          <div className="error-banner">
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

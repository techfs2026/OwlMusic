import React, { useMemo } from "react";
import type { TrackMetadata } from "../types";

interface CoverProps {
  metadata: TrackMetadata | null;
  isPlaying: boolean;
}

const PALETTES = [
  ["#FF6B6B", "#FFE66D"],
  ["#4ECDC4", "#44A8B3"],
  ["#A8E6CF", "#DCEDC1"],
  ["#6C5CE7", "#A29BFE"],
  ["#FD79A8", "#FDCB6E"],
  ["#00B894", "#00CEC9"],
  ["#E17055", "#D63031"],
  ["#0984E3", "#74B9FF"],
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export const Cover: React.FC<CoverProps> = ({ metadata, isPlaying }) => {
  const gradientColors = useMemo(() => {
    const key = metadata?.album ?? metadata?.title ?? "default";
    return PALETTES[hashString(key) % PALETTES.length];
  }, [metadata]);

  const displayText = metadata?.album ?? metadata?.title ?? "No Track";

  if (metadata?.cover_base64) {
    return (
      <div className={`cover-wrapper ${isPlaying ? "cover-playing" : ""}`}>
        <img
          src={`data:${metadata.cover_mime ?? "image/jpeg"};base64,${metadata.cover_base64}`}
          alt="Album cover"
          className="cover-image"
        />
      </div>
    );
  }

  return (
    <div
      className={`cover-wrapper cover-gradient ${isPlaying ? "cover-playing" : ""}`}
      style={{ background: `linear-gradient(135deg, ${gradientColors[0]}, ${gradientColors[1]})` }}
    >
      <span className="cover-text">{displayText}</span>
    </div>
  );
};

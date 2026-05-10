import React from "react";
import type { TrackMetadata } from "../types";

interface TrackInfoProps {
  metadata: TrackMetadata | null;
}

export const TrackInfo: React.FC<TrackInfoProps> = ({ metadata }) => {
  return (
    <div className="track-info">
      <div className="track-title">
        {metadata?.title ?? "No track loaded"}
      </div>
      <div className="track-artist">
        {metadata?.artist ?? (metadata ? "Unknown Artist" : "Open a file to begin")}
      </div>
      {metadata?.album && (
        <div className="track-album">{metadata.album}</div>
      )}
    </div>
  );
};

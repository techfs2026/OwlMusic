export interface TrackMetadata {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  cover_base64?: string | null;
  cover_mime?: string | null;
}

export interface TrackInfo {
  metadata: TrackMetadata;
  duration_secs: number;
}

export interface PlayerStateInfo {
  state: string;
  position_secs: number;
  duration_secs: number;
  volume: number;
}

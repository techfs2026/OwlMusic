import { invoke } from "@tauri-apps/api/core";

export interface TrackMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  cover_base64: string | null;
  cover_mime: string | null;
}

export interface TrackInfo {
  metadata: TrackMetadata;
  duration_secs: number;
  source_sample_rate: number;
  source_channels: number;
  source_bits_per_sample: number | null;
  output_sample_rate: number;
  output_channels: number;
  bit_perfect: boolean;
}

export interface PlayerStateInfo {
  state: string; // "playing" | "paused" | "idle"
  position_secs: number;
  duration_secs: number;
  volume: number;
}

export interface ScannedTrack {
  path: string;
  name: string;
  title: string | null;
  artist: string | null;
}

export interface SpectrumConfig {
  bars: number;
  f_min_hz: number;
  f_max_hz: number;
  sample_rate: number;
}

export interface LyricLine {
  time_secs: number;
  text: string;
}

/** One tag edit for a single track. Text fields are tri-state:
 *  omit / undefined → leave unchanged, "" → clear, value → set. */
export interface MetadataEdit {
  title?: string;
  artist?: string;
  album?: string;
  cover_action: "keep" | "replace" | "remove";
  /** Filesystem path to an image; required when cover_action === "replace". */
  cover_path?: string;
}

export const api = {
  openFile: (path: string) => invoke<TrackInfo>("open_file", { path }),
  play: () => invoke<void>("play"),
  pause: () => invoke<void>("pause"),
  stop: () => invoke<void>("stop"),
  seek: (positionSecs: number) =>
    invoke<void>("seek", { positionSecs }),
  setVolume: (volume: number) => invoke<void>("set_volume", { volume }),
  getState: () => invoke<PlayerStateInfo>("get_state"),
  getSpectrum: () => invoke<number[]>("get_spectrum"),
  scanFolder: (path: string) =>
    invoke<ScannedTrack[]>("scan_folder", { path }),
  readLyrics: (path: string) => invoke<LyricLine[]>("read_lyrics", { path }),
  writeMetadata: (path: string, edit: MetadataEdit) =>
    invoke<TrackMetadata>("write_metadata", { path, edit }),
  getSpectrumConfig(): Promise<SpectrumConfig> {
    return invoke("get_spectrum_config");
  },
};
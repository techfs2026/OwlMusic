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
}

export interface SpectrumConfig {
  bars: number;
  f_min_hz: number;
  f_max_hz: number;
  sample_rate: number;
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
  getSpectrumConfig(): Promise<SpectrumConfig> {
    return invoke("get_spectrum_config");
  },
};
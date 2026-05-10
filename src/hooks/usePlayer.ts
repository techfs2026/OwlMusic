import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TrackInfo, PlayerStateInfo } from "../types";

export function usePlayer() {
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [playerState, setPlayerState] = useState<PlayerStateInfo>({
    state: "idle",
    position_secs: 0,
    duration_secs: 0,
    volume: 1.0,
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const state = await invoke<PlayerStateInfo>("get_state");
        setPlayerState(state);
      } catch (e) {
        console.error("Poll error:", e);
      }
    }, 500);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (playerState.state === "playing") {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [playerState.state, startPolling, stopPolling]);

  const openFile = useCallback(async () => {
    try {
      setError(null);
      const selected = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "aac", "m4a", "ogg"] }],
      });
      if (!selected) return;
      const path = typeof selected === "string" ? selected : (selected as string);
      setIsLoading(true);
      try {
        const info = await invoke<TrackInfo>("open_file", { path });
        setTrack(info);
        // Backend `load_and_play` starts playback; sync UI from source of truth.
        const synced = await invoke<PlayerStateInfo>("get_state");
        setPlayerState(synced);
      } finally {
        setIsLoading(false);
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const play = useCallback(async () => {
    try {
      await invoke("play");
      setPlayerState((prev) => ({ ...prev, state: "playing" }));
    } catch (e) { setError(String(e)); }
  }, []);

  const pause = useCallback(async () => {
    try {
      await invoke("pause");
      setPlayerState((prev) => ({ ...prev, state: "paused" }));
    } catch (e) { setError(String(e)); }
  }, []);

  const togglePlay = useCallback(async () => {
    if (playerState.state === "playing") await pause();
    else await play();
  }, [playerState.state, play, pause]);

  const seek = useCallback(async (positionSecs: number) => {
    try {
      await invoke("seek", { positionSecs });
      setPlayerState((prev) => ({ ...prev, position_secs: positionSecs }));
    } catch (e) { setError(String(e)); }
  }, []);

  const setVolume = useCallback(async (volume: number) => {
    try {
      await invoke("set_volume", { volume });
      setPlayerState((prev) => ({ ...prev, volume }));
    } catch (e) { setError(String(e)); }
  }, []);

  return {
    track,
    playerState,
    error,
    isLoading,
    openFile,
    togglePlay,
    seek,
    setVolume,
  };
}

use crate::audio::spectrum::SPECTRUM_BARS;
use crate::metadata::reader::{read_metadata, TrackMetadata};
use crate::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

const AUDIO_EXTS: &[&str] = &[
    "mp3", "m4a", "ogg", "wav", "flac", "aac", "opus", "weba", "webm",
];

#[derive(Serialize)]
pub struct TrackInfo {
    pub metadata: TrackMetadata,
    pub duration_secs: f64,
}

#[derive(Serialize)]
pub struct PlayerStateInfo {
    pub state: String,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub volume: f32,
}

#[derive(Serialize)]
pub struct ScannedTrack {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub async fn open_file(path: String, state: State<'_, AppState>) -> Result<TrackInfo, String> {
    let path = Path::new(&path).to_path_buf();
    // Metadata read soft-fails internally now, but keep a fallback here too in case
    // the API ever propagates again.
    let metadata = read_metadata(&path).unwrap_or_default();
    let mut player = state.player.lock();
    player
        .load_and_play(&path)
        .map_err(|e| format!("Load error: {}", e))?;
    let duration_secs = player.get_duration();
    Ok(TrackInfo {
        metadata,
        duration_secs,
    })
}

#[tauri::command]
pub async fn play(state: State<'_, AppState>) -> Result<(), String> {
    state.player.lock().play();
    Ok(())
}

#[tauri::command]
pub async fn pause(state: State<'_, AppState>) -> Result<(), String> {
    state.player.lock().pause();
    Ok(())
}

#[tauri::command]
pub async fn stop(state: State<'_, AppState>) -> Result<(), String> {
    state.player.lock().stop();
    Ok(())
}

#[tauri::command]
pub async fn seek(position_secs: f64, state: State<'_, AppState>) -> Result<(), String> {
    state.player.lock().seek(position_secs);
    Ok(())
}

#[tauri::command]
pub async fn set_volume(volume: f32, state: State<'_, AppState>) -> Result<(), String> {
    state.player.lock().set_volume(volume);
    Ok(())
}

#[tauri::command]
pub async fn get_state(state: State<'_, AppState>) -> Result<PlayerStateInfo, String> {
    let player = state.player.lock();
    Ok(PlayerStateInfo {
        state: player.playback_state_label().to_string(),
        position_secs: player.get_position(),
        duration_secs: player.get_duration(),
        volume: player.get_volume(),
    })
}

#[tauri::command]
pub fn get_spectrum(state: State<'_, AppState>) -> Vec<f32> {
    let (ring, sr) = {
        let player = state.player.lock();
        (player.spectrum_ring(), player.sample_rate())
    };
    let mut fft = state.spectrum_fft.lock();
    let mut bars = [0f32; SPECTRUM_BARS];
    fft.compute_bars(ring.as_ref(), sr, &mut bars);
    bars.to_vec()
}

/// Recursively scan a directory for audio files. Returns a flat, name-sorted list.
/// Path is returned as a string for easy use over the IPC boundary.
#[tauri::command]
pub async fn scan_folder(path: String) -> Result<Vec<ScannedTrack>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut out: Vec<ScannedTrack> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root];

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                log::warn!("read_dir failed for {:?}: {}", dir, e);
                continue;
            }
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let name = match p.file_name().and_then(|n| n.to_str()) {
                Some(n) if !n.starts_with("._") && !n.starts_with('.') => n.to_string(),
                _ => continue,
            };
            let ext_ok = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| AUDIO_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
                .unwrap_or(false);
            if !ext_ok {
                continue;
            }
            let path_str = p.to_string_lossy().to_string();
            out.push(ScannedTrack {
                path: path_str,
                name,
            });
        }
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[derive(Serialize)]
pub struct SpectrumConfig {
    pub bars: usize,
    pub f_min_hz: f32,
    pub f_max_hz: f32,  // 实际是当前曲目的 nyquist
    pub sample_rate: u32,
}

#[tauri::command]
pub fn get_spectrum_config(state: State<'_, AppState>) -> SpectrumConfig {
    let sr = state.player.lock().sample_rate();
    SpectrumConfig {
        bars: crate::audio::spectrum::SPECTRUM_BARS,
        f_min_hz: 40.0,
        f_max_hz: (sr as f32 / 2.0),
        sample_rate: sr,
    }
}

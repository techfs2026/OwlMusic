use crate::metadata::reader::{read_metadata, TrackMetadata};
use crate::AppState;
use serde::Serialize;
use std::path::Path;
use tauri::State;

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

#[tauri::command]
pub async fn open_file(path: String, state: State<'_, AppState>) -> Result<TrackInfo, String> {
    let path = Path::new(&path).to_path_buf();
    let metadata = read_metadata(&path).map_err(|e| format!("Metadata error: {}", e))?;
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

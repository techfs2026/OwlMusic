mod audio;
mod metadata;
mod commands;

use std::sync::Arc;
use parking_lot::Mutex;
use audio::player::AudioPlayer;
use tauri::Manager;

pub struct AppState {
    pub player: Arc<Mutex<AudioPlayer>>,
}

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let player = Arc::new(Mutex::new(AudioPlayer::new()));
            app.manage(AppState { player });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::play,
            commands::pause,
            commands::stop,
            commands::seek,
            commands::set_volume,
            commands::get_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

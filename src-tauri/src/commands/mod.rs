use crate::audio::spectrum::SPECTRUM_BARS;
use crate::metadata::lyrics::{read_lyrics as read_lyrics_impl, LyricLine};
use crate::metadata::reader::{read_metadata, read_tags_light, TrackMetadata};
use crate::metadata::writer::{write_metadata as write_metadata_impl, MetadataEdit};
use crate::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

const AUDIO_EXTS: &[&str] = &[
    "mp3", "m4a", "ogg", "wav", "flac", "aac", "opus", "weba", "webm",
];

/// Name of the folder directly containing `file_path`, used as the album group
/// label when no better title is available.
fn folder_name(file_path: &Path) -> Option<String> {
    file_path
        .parent()
        .and_then(|d| d.file_name())
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

#[derive(Serialize)]
pub struct TrackInfo {
    pub metadata: TrackMetadata,
    pub duration_secs: f64,
    pub source_sample_rate: u32,
    pub source_channels: u32,
    pub source_bits_per_sample: Option<u32>,
    pub output_sample_rate: u32,
    pub output_channels: u32,
    pub bit_perfect: bool,
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
    pub title: Option<String>,
    pub artist: Option<String>,
    /// Album display label used to group the playlist: the CUE sheet's album
    /// title, otherwise the track's containing folder name.
    pub album: Option<String>,
    /// CUE track start within the file, in seconds. `None` for a whole file.
    pub start_secs: Option<f64>,
    /// CUE track end within the file, in seconds. `None` = play to EOF (whole
    /// file, or the last track on a CUE sheet).
    pub end_secs: Option<f64>,
}

/// Open a track. For CUE tracks, `start_secs`/`end_secs` restrict playback to a
/// slice of the file, and `title`/`artist` override the (album-level) tags read
/// from the underlying WAV/FLAC since one container holds many tracks.
#[tauri::command]
pub async fn open_file(
    path: String,
    start_secs: Option<f64>,
    end_secs: Option<f64>,
    title: Option<String>,
    artist: Option<String>,
    state: State<'_, AppState>,
) -> Result<TrackInfo, String> {
    let path = Path::new(&path).to_path_buf();
    // Metadata read soft-fails internally now, but keep a fallback here too in case
    // the API ever propagates again.
    let mut metadata = read_metadata(&path).unwrap_or_default();
    if title.is_some() {
        metadata.title = title;
    }
    if artist.is_some() {
        metadata.artist = artist;
    }
    let mut player = state.player.lock();
    player
        .load_and_play(&path, start_secs, end_secs)
        .map_err(|e| format!("Load error: {}", e))?;
    Ok(TrackInfo {
        metadata,
        duration_secs: player.get_duration(),
        source_sample_rate: player.source_sample_rate(),
        source_channels: player.source_channels(),
        source_bits_per_sample: player.source_bits_per_sample(),
        output_sample_rate: player.sample_rate(),
        output_channels: player.output_channels(),
        bit_perfect: player.bit_perfect(),
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

/// How many directory levels below the selected folder we descend into.
/// The selected folder is depth 0. A typical library is at most two layers
/// (parent → album → files), so 2 covers "pick the parent" plus a little slack
/// for multi-disc albums (album → Disc 1 → files), while still preventing a
/// stray pick of a huge directory from scanning an entire drive.
const MAX_SCAN_DEPTH: usize = 2;

/// Recursively scan a directory (up to [`MAX_SCAN_DEPTH`] levels deep) for audio
/// files and CUE sheets. Returns a flat list, folder-grouped then ordered by
/// filename / CUE track number. Paths are strings for easy use over IPC.
#[tauri::command]
pub async fn scan_folder(path: String) -> Result<Vec<ScannedTrack>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut audio_files: Vec<PathBuf> = Vec::new();
    let mut cue_files: Vec<PathBuf> = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root, 0)];

    while let Some((dir, depth)) = stack.pop() {
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
                if depth < MAX_SCAN_DEPTH {
                    stack.push((p, depth + 1));
                }
                continue;
            }
            match p.file_name().and_then(|n| n.to_str()) {
                Some(n) if !n.starts_with("._") && !n.starts_with('.') => {}
                _ => continue,
            }
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase());
            match ext.as_deref() {
                Some("cue") => cue_files.push(p),
                Some(e) if AUDIO_EXTS.contains(&e) => audio_files.push(p),
                _ => {}
            }
        }
    }

    // Each entry carries a sort key: tracks group by their source file path, and
    // within a CUE sheet they order by track number. Whole files use track_no 0.
    let mut entries: Vec<(String, u32, ScannedTrack)> = Vec::new();
    // Audio files referenced by a CUE sheet are not listed standalone.
    let mut referenced: std::collections::HashSet<String> = std::collections::HashSet::new();

    for cue in &cue_files {
        let sheet = match crate::metadata::cue::parse_cue(cue) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("CUE parse failed for {:?}: {}", cue, e);
                continue;
            }
        };
        let audio_path_str = sheet.audio_path.to_string_lossy().to_string();
        referenced.insert(audio_path_str.to_ascii_lowercase());
        let sort_base = audio_path_str.to_ascii_lowercase();
        // Group label: CUE album title, else the containing folder name.
        let album = sheet
            .album
            .clone()
            .or_else(|| folder_name(&sheet.audio_path));
        for t in &sheet.tracks {
            let title = t.title.clone().or_else(|| sheet.album.clone());
            let artist = t.performer.clone().or_else(|| sheet.album_performer.clone());
            let name = format!(
                "{:02}. {}",
                t.number,
                title.clone().unwrap_or_else(|| format!("Track {}", t.number))
            );
            entries.push((
                sort_base.clone(),
                t.number,
                ScannedTrack {
                    path: audio_path_str.clone(),
                    name,
                    title,
                    artist,
                    album: album.clone(),
                    start_secs: Some(t.start_secs),
                    end_secs: t.end_secs,
                },
            ));
        }
    }

    for p in &audio_files {
        let path_str = p.to_string_lossy().to_string();
        if referenced.contains(&path_str.to_ascii_lowercase()) {
            continue;
        }
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let (title, artist) = read_tags_light(p);
        entries.push((
            path_str.to_ascii_lowercase(),
            0,
            ScannedTrack {
                path: path_str,
                name,
                title,
                artist,
                album: folder_name(p),
                start_secs: None,
                end_secs: None,
            },
        ));
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    Ok(entries.into_iter().map(|(_, _, t)| t).collect())
}

/// Look for a sibling `.lrc` file next to the audio file and return its parsed
/// timestamped lines. Empty vec = no lyrics (frontend falls back to spectrum).
#[tauri::command]
pub async fn read_lyrics(path: String) -> Result<Vec<LyricLine>, String> {
    let p = Path::new(&path).to_path_buf();
    Ok(read_lyrics_impl(&p))
}

/// Write edited tag metadata (title/artist/album + cover) back to the file and
/// return the freshly re-read metadata. The frontend must stop playback of the
/// target file before calling this if it's the currently-loaded track, since a
/// rewrite races with the streaming decoder's open file handle.
#[tauri::command]
pub async fn write_metadata(path: String, edit: MetadataEdit) -> Result<TrackMetadata, String> {
    let p = Path::new(&path).to_path_buf();
    write_metadata_impl(&p, &edit).map_err(|e| format!("{}", e))
}

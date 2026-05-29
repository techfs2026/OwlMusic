use anyhow::{anyhow, Result};
use encoding_rs::GBK;
use std::path::{Path, PathBuf};

/// One playable entry derived from a CUE sheet: a time slice of the referenced
/// audio file. `end_secs == None` means "play to the end of the file" (the last
/// track on the sheet).
#[derive(Debug, Clone)]
pub struct CueTrack {
    pub number: u32,
    pub title: Option<String>,
    pub performer: Option<String>,
    pub start_secs: f64,
    pub end_secs: Option<f64>,
}

/// A parsed CUE sheet. `audio_path` is resolved (and case-corrected) against the
/// directory containing the `.cue` file.
#[derive(Debug, Clone)]
pub struct CueSheet {
    pub audio_path: PathBuf,
    pub album: Option<String>,
    pub album_performer: Option<String>,
    pub tracks: Vec<CueTrack>,
}

/// CUE sheets are commonly authored in non-UTF-8 encodings (GBK for Chinese
/// rips, etc.). Strip a UTF-8 BOM, prefer strict UTF-8, then fall back to GBK,
/// and finally lossy UTF-8 so we never hard-fail on text decoding.
fn decode_cue_bytes(bytes: &[u8]) -> String {
    if let Some(stripped) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(stripped).into_owned();
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    let (cow, _, had_errors) = GBK.decode(bytes);
    if !had_errors {
        return cow.into_owned();
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// Strip a single pair of surrounding double quotes if present.
fn unquote(s: &str) -> String {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix('"') {
        if let Some(end) = inner.find('"') {
            return inner[..end].to_string();
        }
    }
    s.to_string()
}

/// Extract the filename from a `FILE` directive body, e.g.
/// `"My Album.wav" WAVE` → `My Album.wav`, or unquoted `track.wav WAVE`.
fn extract_filename(rest: &str) -> String {
    let rest = rest.trim();
    if let Some(inner) = rest.strip_prefix('"') {
        if let Some(end) = inner.find('"') {
            return inner[..end].to_string();
        }
    }
    // Unquoted: the trailing token is the format (WAVE/MP3/BINARY/…).
    match rest.rsplit_once(char::is_whitespace) {
        Some((name, _format)) => name.trim().to_string(),
        None => rest.to_string(),
    }
}

/// Parse a `MM:SS:FF` CUE timecode into seconds. CUE frames are 1/75 second.
fn parse_cue_time(code: &str) -> Option<f64> {
    let parts: Vec<&str> = code.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let m: f64 = parts[0].trim().parse().ok()?;
    let s: f64 = parts[1].trim().parse().ok()?;
    let f: f64 = parts[2].trim().parse().ok()?;
    Some(m * 60.0 + s + f / 75.0)
}

/// Find a file in `dir` matching `name` case-insensitively (covers CUE sheets
/// whose FILE casing differs from the on-disk filename).
fn resolve_audio_path(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.is_file() {
        return Some(direct);
    }
    let want = name.to_ascii_lowercase();
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        if let Some(fname) = p.file_name().and_then(|n| n.to_str()) {
            if fname.to_ascii_lowercase() == want {
                return Some(p);
            }
        }
    }
    None
}

struct PartialTrack {
    number: u32,
    title: Option<String>,
    performer: Option<String>,
    start: Option<f64>,
}

/// Parse a CUE sheet into a list of playable time-slices. Returns an error if
/// the sheet has no `FILE` directive, the referenced audio file can't be found,
/// or no track has a usable start index.
pub fn parse_cue(cue_path: &Path) -> Result<CueSheet> {
    let bytes = std::fs::read(cue_path)?;
    let text = decode_cue_bytes(&bytes);
    let dir = cue_path.parent().unwrap_or_else(|| Path::new("."));

    let mut album: Option<String> = None;
    let mut album_performer: Option<String> = None;
    let mut file_name: Option<String> = None;
    let mut tracks: Vec<PartialTrack> = Vec::new();

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let (key, rest) = match line.split_once(char::is_whitespace) {
            Some((k, r)) => (k.to_ascii_uppercase(), r.trim()),
            None => (line.to_ascii_uppercase(), ""),
        };
        match key.as_str() {
            "FILE" => file_name = Some(extract_filename(rest)),
            "TRACK" => {
                let number = rest
                    .split_whitespace()
                    .next()
                    .and_then(|n| n.parse::<u32>().ok())
                    .unwrap_or((tracks.len() + 1) as u32);
                tracks.push(PartialTrack {
                    number,
                    title: None,
                    performer: None,
                    start: None,
                });
            }
            "TITLE" => {
                let v = unquote(rest);
                match tracks.last_mut() {
                    Some(t) => t.title = Some(v),
                    None => album = Some(v),
                }
            }
            "PERFORMER" => {
                let v = unquote(rest);
                match tracks.last_mut() {
                    Some(t) => t.performer = Some(v),
                    None => album_performer = Some(v),
                }
            }
            "INDEX" => {
                let mut it = rest.split_whitespace();
                let idx = it.next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(1);
                if let Some(secs) = it.next().and_then(parse_cue_time) {
                    if let Some(t) = tracks.last_mut() {
                        // INDEX 01 is the true track start; INDEX 00 is pregap.
                        // Take 01 when present, else fall back to whatever we saw.
                        if idx == 1 || t.start.is_none() {
                            t.start = Some(secs);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let file_name = file_name.ok_or_else(|| anyhow!("CUE has no FILE directive"))?;
    let audio_path = resolve_audio_path(dir, &file_name)
        .ok_or_else(|| anyhow!("CUE references missing file: {}", file_name))?;

    // Keep only tracks with a known start, in sheet order; each track ends where
    // the next one begins (last track plays to EOF).
    let valid: Vec<&PartialTrack> = tracks.iter().filter(|t| t.start.is_some()).collect();
    if valid.is_empty() {
        return Err(anyhow!("CUE has no track with an INDEX"));
    }
    let out: Vec<CueTrack> = valid
        .iter()
        .enumerate()
        .map(|(i, t)| CueTrack {
            number: t.number,
            title: t.title.clone(),
            performer: t.performer.clone(),
            start_secs: t.start.unwrap(),
            end_secs: valid.get(i + 1).map(|n| n.start.unwrap()),
        })
        .collect();

    Ok(CueSheet {
        audio_path,
        album,
        album_performer,
        tracks: out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_sheet() {
        let dir = std::env::temp_dir().join(format!("musicowl_cue_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("Album.wav");
        std::fs::write(&wav, b"RIFF").unwrap();
        let cue = dir.join("Album.cue");
        std::fs::write(
            &cue,
            br#"PERFORMER "The Band"
TITLE "Greatest Hits"
FILE "Album.wav" WAVE
  TRACK 01 AUDIO
    TITLE "First"
    PERFORMER "The Band"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Second"
    INDEX 00 02:59:00
    INDEX 01 03:00:00
"#,
        )
        .unwrap();

        let sheet = parse_cue(&cue).unwrap();
        assert_eq!(sheet.album.as_deref(), Some("Greatest Hits"));
        assert_eq!(sheet.album_performer.as_deref(), Some("The Band"));
        assert_eq!(sheet.audio_path, wav);
        assert_eq!(sheet.tracks.len(), 2);

        assert_eq!(sheet.tracks[0].title.as_deref(), Some("First"));
        assert_eq!(sheet.tracks[0].start_secs, 0.0);
        // Track 1 ends where track 2's INDEX 01 (not pregap INDEX 00) begins.
        assert_eq!(sheet.tracks[0].end_secs, Some(180.0));

        assert_eq!(sheet.tracks[1].title.as_deref(), Some("Second"));
        assert_eq!(sheet.tracks[1].start_secs, 180.0);
        assert_eq!(sheet.tracks[1].end_secs, None);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn cue_time_uses_75_frames() {
        // 01:30:37 → 90s + 37/75
        let secs = parse_cue_time("01:30:37").unwrap();
        assert!((secs - (90.0 + 37.0 / 75.0)).abs() < 1e-9);
    }
}

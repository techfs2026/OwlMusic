use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Cap on standalone cover-art file size before we'll inline it. Real album
/// folder art is rarely >2 MB; this guards against someone dropping a huge
/// PSD or TIFF in the directory.
const MAX_FOLDER_COVER_BYTES: u64 = 8 * 1024 * 1024;

/// Common standalone cover filenames in priority order. Matched
/// case-insensitively against directory contents.
const COVER_NAME_STEMS: &[&str] = &["cover", "folder", "album", "front", "albumart"];

/// Extension → MIME mapping for standalone cover files.
const COVER_EXT_MIME: &[(&str, &str)] = &[
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("png", "image/png"),
    ("webp", "image/webp"),
];

#[derive(Debug, Serialize, Clone, Default)]
pub struct TrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// Base64-encoded cover image, None if not present
    pub cover_base64: Option<String>,
    /// MIME type of cover image e.g. "image/jpeg"
    pub cover_mime: Option<String>,
}

/// Lightweight tag read used during folder scans: title + artist only,
/// no cover decoding (covers can be megabytes and would blow the IPC payload
/// for a folder of 100+ tracks). Soft-fails to `(None, None)` on any error.
pub fn read_tags_light(path: &Path) -> (Option<String>, Option<String>) {
    let tagged = match lofty::read_from_path(path) {
        Ok(t) => t,
        Err(_) => return (None, None),
    };
    let tag = match tagged.primary_tag().or_else(|| tagged.first_tag()) {
        Some(t) => t,
        None => return (None, None),
    };
    let title = tag
        .title()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let artist = tag
        .artist()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    (title, artist)
}

/// Look for a sibling cover image in the track's parent directory.
/// Tries common filenames (cover/folder/album/front/albumart) with common
/// raster extensions, case-insensitive. Returns the first match read as
/// `(base64, mime)`, or `(None, None)` if none found / readable.
fn read_folder_cover(track_path: &Path) -> (Option<String>, Option<String>) {
    let parent = match track_path.parent() {
        Some(p) => p,
        None => return (None, None),
    };

    // Snapshot the directory listing once, lowercased, so we can do
    // case-insensitive lookups without re-stat'ing.
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    let entries = match std::fs::read_dir(parent) {
        Ok(e) => e,
        Err(_) => return (None, None),
    };
    for entry in entries.flatten() {
        let p = entry.path();
        // Skip directories and macOS metadata sidecars.
        if !p.is_file() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with("._") {
            continue;
        }
        files.push((name.to_ascii_lowercase(), p));
    }

    for stem in COVER_NAME_STEMS {
        for (ext, mime) in COVER_EXT_MIME {
            let target = format!("{}.{}", stem, ext);
            for (lower_name, full_path) in &files {
                if lower_name != &target {
                    continue;
                }
                let size = std::fs::metadata(full_path).map(|m| m.len()).unwrap_or(0);
                if size > MAX_FOLDER_COVER_BYTES {
                    log::warn!(
                        "Folder cover {:?} is {} bytes; skipping (limit {}).",
                        full_path,
                        size,
                        MAX_FOLDER_COVER_BYTES
                    );
                    continue;
                }
                match std::fs::read(full_path) {
                    Ok(bytes) => {
                        log::info!(
                            "Using folder cover {:?} for track {:?}",
                            full_path,
                            track_path.file_name()
                        );
                        return (Some(STANDARD.encode(&bytes)), Some(mime.to_string()));
                    }
                    Err(e) => {
                        log::warn!("Failed to read folder cover {:?}: {}", full_path, e);
                    }
                }
            }
        }
    }

    (None, None)
}

/// Read tag metadata. Soft-fails: if the file can't be parsed for *any* reason
/// (corrupt FLAC header, ID3 issues, unsupported container, etc.), an empty
/// `TrackMetadata` is returned. We never want a bad tag to block playback —
/// symphonia is much more tolerant than lofty and may still play the file fine.
///
/// Cover-art resolution is 3-tier:
///   1. Picture embedded in the track's tag (highest priority).
///   2. A sibling cover file (cover.jpg, folder.png, etc.) in the same folder
///      — common when ripping per-album.
///   3. None — frontend renders the placeholder.
pub fn read_metadata(path: &Path) -> Result<TrackMetadata> {
    let mut meta: TrackMetadata = match lofty::read_from_path(path) {
        Ok(tagged_file) => {
            let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
            if let Some(tag) = tag {
                let title = tag.title().map(|s| s.to_string());
                let artist = tag.artist().map(|s| s.to_string());
                let album = tag.album().map(|s| s.to_string());

                let (cover_base64, cover_mime) = tag
                    .pictures()
                    .first()
                    .map(|pic| {
                        let b64 = STANDARD.encode(pic.data());
                        let mime = pic
                            .mime_type()
                            .map(|m| m.to_string())
                            .unwrap_or_else(|| "image/jpeg".to_string());
                        (Some(b64), Some(mime))
                    })
                    .unwrap_or((None, None));

                TrackMetadata {
                    title,
                    artist,
                    album,
                    cover_base64,
                    cover_mime,
                }
            } else {
                TrackMetadata::default()
            }
        }
        Err(e) => {
            // Don't propagate — log and return empty metadata so playback still proceeds.
            log::warn!("Metadata read failed for {:?}: {}", path, e);
            TrackMetadata::default()
        }
    };

    // Tier 2: if the tag didn't ship a cover, check the album folder.
    if meta.cover_base64.is_none() {
        let (b64, mime) = read_folder_cover(path);
        meta.cover_base64 = b64;
        meta.cover_mime = mime;
    }

    Ok(meta)
}
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use serde::Serialize;
use std::path::Path;

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

/// Read tag metadata. Soft-fails: if the file can't be parsed for *any* reason
/// (corrupt FLAC header, ID3 issues, unsupported container, etc.), an empty
/// `TrackMetadata` is returned. We never want a bad tag to block playback —
/// symphonia is much more tolerant than lofty and may still play the file fine.
pub fn read_metadata(path: &Path) -> Result<TrackMetadata> {
    match lofty::read_from_path(path) {
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

                Ok(TrackMetadata {
                    title,
                    artist,
                    album,
                    cover_base64,
                    cover_mime,
                })
            } else {
                Ok(TrackMetadata::default())
            }
        }
        Err(e) => {
            // Don't propagate — log and return empty metadata so playback still proceeds.
            log::warn!("Metadata read failed for {:?}: {}", path, e);
            Ok(TrackMetadata::default())
        }
    }
}
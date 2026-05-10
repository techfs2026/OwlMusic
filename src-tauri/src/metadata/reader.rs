use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, Clone)]
pub struct TrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// Base64-encoded cover image, None if not present
    pub cover_base64: Option<String>,
    /// MIME type of cover image e.g. "image/jpeg"
    pub cover_mime: Option<String>,
}

pub fn read_metadata(path: &Path) -> Result<TrackMetadata> {
    let tagged_file = lofty::read_from_path(path)?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    let (title, artist, album, cover_base64, cover_mime) = if let Some(tag) = tag {
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

        (title, artist, album, cover_base64, cover_mime)
    } else {
        (None, None, None, None, None)
    };

    Ok(TrackMetadata {
        title,
        artist,
        album,
        cover_base64,
        cover_mime,
    })
}

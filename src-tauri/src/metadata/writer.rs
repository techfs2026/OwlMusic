use anyhow::{anyhow, Result};
use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{Tag, TagExt};
use serde::Deserialize;
use std::path::Path;

use super::reader::{read_metadata, TrackMetadata};

/// Cap on the size of an image we'll embed as cover art. Mirrors the read-side
/// folder-cover limit so an edit can't bloat a track to absurd sizes.
const MAX_COVER_BYTES: u64 = 8 * 1024 * 1024;

/// What the edit should do with the embedded cover.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CoverAction {
    /// Leave existing artwork untouched.
    Keep,
    /// Replace all artwork with the image at `cover_path`.
    Replace,
    /// Strip all embedded artwork.
    Remove,
}

/// One metadata edit for a single track. Text fields use a tri-state:
///   - `None`        → leave the field unchanged
///   - `Some("")`    → clear the field
///   - `Some(value)` → set the (trimmed) value
#[derive(Debug, Deserialize)]
pub struct MetadataEdit {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub cover_action: CoverAction,
    /// Filesystem path to an image; required when `cover_action == Replace`.
    pub cover_path: Option<String>,
}

/// Map a file extension to a lofty `MimeType`. Defaults to JPEG, which is the
/// safe lowest-common-denominator for embedded art.
fn mime_from_ext(path: &Path) -> MimeType {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => MimeType::Png,
        Some("gif") => MimeType::Gif,
        Some("bmp") => MimeType::Bmp,
        Some("tif") | Some("tiff") => MimeType::Tiff,
        _ => MimeType::Jpeg,
    }
}

/// Apply `value`'s tri-state to a single text field via the given setter/remover.
fn apply_text(value: &Option<String>, tag: &mut Tag, key: TextField) {
    let Some(raw) = value else { return };
    let trimmed = raw.trim();
    match key {
        TextField::Title => {
            if trimmed.is_empty() {
                tag.remove_title();
            } else {
                tag.set_title(trimmed.to_string());
            }
        }
        TextField::Artist => {
            if trimmed.is_empty() {
                tag.remove_artist();
            } else {
                tag.set_artist(trimmed.to_string());
            }
        }
        TextField::Album => {
            if trimmed.is_empty() {
                tag.remove_album();
            } else {
                tag.set_album(trimmed.to_string());
            }
        }
    }
}

enum TextField {
    Title,
    Artist,
    Album,
}

/// Write tag edits back to `path` in place and return the freshly re-read
/// metadata. Errors are propagated (unlike reads, a failed write must surface
/// to the user — we don't want a silent no-op).
///
/// NOTE: this rewrites the whole file. The caller is responsible for ensuring
/// the file isn't being streamed by the player at the same time (the frontend
/// stops playback of the current track before invoking this).
pub fn write_metadata(path: &Path, edit: &MetadataEdit) -> Result<TrackMetadata> {
    let mut tagged =
        lofty::read_from_path(path).map_err(|e| anyhow!("读取标签失败: {}", e))?;

    // Guarantee a primary tag to write into — files with no tags at all need
    // one created in the container's native format.
    if tagged.primary_tag_mut().is_none() {
        let tag_type = tagged.file_type().primary_tag_type();
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged
        .primary_tag_mut()
        .ok_or_else(|| anyhow!("无法为该文件创建可写标签"))?;

    apply_text(&edit.title, tag, TextField::Title);
    apply_text(&edit.artist, tag, TextField::Artist);
    apply_text(&edit.album, tag, TextField::Album);

    match edit.cover_action {
        CoverAction::Keep => {}
        CoverAction::Remove => {
            while !tag.pictures().is_empty() {
                tag.remove_picture(0);
            }
        }
        CoverAction::Replace => {
            let cover_path = edit
                .cover_path
                .as_ref()
                .ok_or_else(|| anyhow!("缺少封面文件路径"))?;
            let cover_path = Path::new(cover_path);
            let size = std::fs::metadata(cover_path)
                .map(|m| m.len())
                .map_err(|e| anyhow!("读取封面文件失败: {}", e))?;
            if size > MAX_COVER_BYTES {
                return Err(anyhow!(
                    "封面文件过大（{} 字节，上限 {} 字节）",
                    size,
                    MAX_COVER_BYTES
                ));
            }
            let data = std::fs::read(cover_path).map_err(|e| anyhow!("读取封面文件失败: {}", e))?;
            let mime = mime_from_ext(cover_path);
            while !tag.pictures().is_empty() {
                tag.remove_picture(0);
            }
            let picture = Picture::unchecked(data)
                .pic_type(PictureType::CoverFront)
                .mime_type(mime)
                .build();
            tag.push_picture(picture);
        }
    }

    tag.save_to_path(path, WriteOptions::default())
        .map_err(|e| anyhow!("写入标签失败: {}", e))?;

    // Return fresh state straight from disk so the UI reflects exactly what was
    // persisted (including the embedded cover, if any).
    read_metadata(path)
}

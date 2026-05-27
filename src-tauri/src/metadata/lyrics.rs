use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, Clone)]
pub struct LyricLine {
    pub time_secs: f64,
    pub text: String,
}

/// Read & parse the sibling `.lrc` file for `audio_path`.
///
/// Returns an empty vec when no .lrc exists or parsing yields no timestamped
/// lines — callers treat empty as "no lyrics, fall back to spectrum view".
///
/// Supports:
///   - Multiple timestamps per line: `[00:12.00][00:18.00] same text`
///   - 2 or 3 decimal subseconds: `[00:12.00]` and `[00:12.000]`
///   - `[mm:ss:xx]` variant (some Asian-market editors use this)
///   - Metadata tags `[ti:...]`, `[ar:...]`, `[by:...]` etc. are skipped silently.
///   - `[offset:±ms]` shifts every line's time. Negative offset = lyrics played
///     earlier, so we *subtract* the value to align with audio time.
pub fn read_lyrics(audio_path: &Path) -> Vec<LyricLine> {
    let lrc_path = audio_path.with_extension("lrc");
    if !lrc_path.is_file() {
        return Vec::new();
    }
    let bytes = match std::fs::read(&lrc_path) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("Failed to read lrc {:?}: {}", lrc_path, e);
            return Vec::new();
        }
    };
    let decoded = decode_lrc_bytes(&bytes);
    // Strip a UTF-8 BOM if present so the first tag parses cleanly.
    let content = decoded.strip_prefix('\u{FEFF}').unwrap_or(&decoded);

    let mut lines: Vec<LyricLine> = Vec::new();
    let mut offset_secs: f64 = 0.0;

    for line in content.lines() {
        let mut rest = line;
        let mut stamps: Vec<f64> = Vec::new();

        loop {
            let s = rest.trim_start();
            if !s.starts_with('[') {
                rest = s;
                break;
            }
            let Some(close) = s.find(']') else {
                rest = s;
                break;
            };
            let inner = &s[1..close];
            if let Some(t) = parse_lrc_time(inner) {
                stamps.push(t);
            } else if let Some(ms) = inner
                .strip_prefix("offset:")
                .and_then(|v| v.trim().parse::<i64>().ok())
            {
                // LRC convention: negative offset means lyrics should appear
                // earlier relative to the audio. Subtracting moves the line's
                // wall-clock time earlier, which matches.
                offset_secs = ms as f64 / 1000.0;
            }
            // Other id tags (ti/ar/al/by/length…) intentionally ignored.
            rest = &s[close + 1..];
        }

        let text = rest.trim().to_string();
        for t in stamps {
            lines.push(LyricLine {
                time_secs: (t - offset_secs).max(0.0),
                text: text.clone(),
            });
        }
    }

    lines.sort_by(|a, b| {
        a.time_secs
            .partial_cmp(&b.time_secs)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    lines
}

/// Decode LRC bytes to a String. Real-world LRCs come in:
///   - UTF-8 (modern, with or without BOM)
///   - GB18030/GBK (legacy Chinese — extremely common in CN music collections)
///   - Shift_JIS / Big5 (rarer, but cheap to cover)
/// We try strict UTF-8 first because most LRCs ship as UTF-8 today, and a
/// successful UTF-8 decode is unambiguous. On failure we fall back to GB18030
/// (a superset of GBK/GB2312) which decodes pretty much any CJK-region legacy
/// LRC without losing characters.
fn decode_lrc_bytes(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    let (decoded, _enc, had_errors) = encoding_rs::GB18030.decode(bytes);
    if had_errors {
        log::warn!("LRC GB18030 decode had replacement characters");
    }
    decoded.into_owned()
}

fn parse_lrc_time(s: &str) -> Option<f64> {
    let (mm_str, rest) = s.split_once(':')?;
    let mm: u32 = mm_str.parse().ok()?;
    // Subseconds delimited by '.' (standard) or ':' (some variants).
    let (ss_str, sub_str) = match rest.find(|c| c == '.' || c == ':') {
        Some(i) => (&rest[..i], Some(&rest[i + 1..])),
        None => (rest, None),
    };
    let ss: u32 = ss_str.parse().ok()?;
    let mut total = mm as f64 * 60.0 + ss as f64;
    if let Some(sub) = sub_str {
        if !sub.is_empty() {
            let n: u32 = sub.parse().ok()?;
            let div = 10u32.checked_pow(sub.len() as u32)? as f64;
            total += n as f64 / div;
        }
    }
    Some(total)
}

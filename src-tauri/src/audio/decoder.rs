use anyhow::{anyhow, Result};
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::prelude::{SeekMode, SeekTo};
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

/// Owns demuxer + decoder for one audio track; used by the streaming decode thread.
pub struct StreamSource {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    sample_buf: Option<SampleBuffer<f32>>,
    pub sample_rate: u32,
    pub channels: u32,
    pub duration_secs: f64,
    /// Original sample bit depth (e.g. 16 / 24 / 32 for PCM/FLAC). `None` if
    /// the demuxer didn't carry it (some lossy codecs).
    pub bits_per_sample: Option<u32>,
    /// Start of the playable region within the file, in seconds. 0 for a whole
    /// file; >0 for a CUE track that begins partway through a big WAV/FLAC.
    clip_start_secs: f64,
    /// End of the playable region as an absolute *frame* index (1/sample_rate
    /// units). `None` = play to end of file. Used to stop a CUE track exactly at
    /// the next track's boundary.
    clip_end_frame: Option<u64>,
}

impl StreamSource {
    /// Open a file, optionally restricted to a `[start_secs, end_secs)` slice
    /// (CUE track). With both `None` it plays the whole file.
    pub fn open_clip(path: &Path, start_secs: Option<f64>, end_secs: Option<f64>) -> Result<Self> {
        let file = File::open(path)?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let meta_opts = MetadataOptions::default();
        let fmt_opts = FormatOptions::default();

        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &fmt_opts, &meta_opts)
            .map_err(|e| anyhow!("Unsupported format: {e}"))?;

        let format = probed.format;

        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| anyhow!("No audio track found"))?
            .clone();

        let track_id = track.id;
        let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
        let channels = track
            .codec_params
            .channels
            .map(|c| c.count() as u32)
            .unwrap_or(2);
        let bits_per_sample = track.codec_params.bits_per_sample;

        let full_duration_secs = if let (Some(n_frames), Some(tb)) =
            (track.codec_params.n_frames, track.codec_params.time_base)
        {
            n_frames as f64 * tb.numer as f64 / tb.denom as f64
        } else {
            0.0
        };

        // Clamp the clip window to the file and translate the end into an
        // absolute frame index so the decode loop can stop precisely.
        let clip_start_secs = start_secs.unwrap_or(0.0).max(0.0);
        let duration_secs = match end_secs {
            Some(end) => (end - clip_start_secs).max(0.0),
            None if full_duration_secs > 0.0 => (full_duration_secs - clip_start_secs).max(0.0),
            None => 0.0,
        };
        let clip_end_frame = end_secs.map(|end| (end * sample_rate as f64).round() as u64);

        let dec_opts = DecoderOptions::default();
        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &dec_opts)
            .map_err(|e| anyhow!("Decoder error: {e}"))?;

        let mut source = Self {
            format,
            decoder,
            track_id,
            sample_buf: None,
            sample_rate,
            channels,
            duration_secs,
            bits_per_sample,
            clip_start_secs,
            clip_end_frame,
        };

        // Jump to the start of the clip before the decode thread reads anything.
        if clip_start_secs > 0.0 {
            source.seek_to_secs(0.0)?;
        }

        Ok(source)
    }

    /// Seek to `secs` measured *within the clip* (0 = start of the playable
    /// region). For a whole file `clip_start_secs` is 0 so this is a plain seek.
    pub fn seek_to_secs(&mut self, secs: f64) -> Result<()> {
        let time = Time::from(self.clip_start_secs + secs);
        self.format.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time,
                track_id: Some(self.track_id),
            },
        )
        .map_err(|e| anyhow!("Seek failed: {e}"))?;
        self.decoder.reset();
        Ok(())
    }

    /// Append decoded interleaved f32 for the next audio packet(s). Returns `false` on EOF.
    pub fn read_next_samples(&mut self, out: &mut Vec<f32>) -> Result<bool> {
        out.clear();
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    return Ok(false);
                }
                Err(e) => return Err(anyhow!("Format error: {e}")),
            };

            if packet.track_id() != self.track_id {
                continue;
            }

            // Clip end: once a packet starts at or past the boundary we're done.
            // The packet timestamp is in frames (1/sample_rate units).
            let packet_ts = packet.ts();
            if let Some(end) = self.clip_end_frame {
                if packet_ts >= end {
                    return Ok(false);
                }
            }

            match self.decoder.decode(&packet) {
                Ok(audio_buf) => {
                    let spec = *audio_buf.spec();
                    let ch = spec.channels.count();
                    let duration = audio_buf.capacity() as u64;
                    let required = (duration * ch as u64) as usize;
                    match &self.sample_buf {
                        Some(buf) if buf.capacity() == required => {}
                        _ => {
                            self.sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
                        }
                    }
                    let buf = self.sample_buf.as_mut().expect("sample buffer");
                    buf.copy_interleaved_ref(audio_buf);
                    let samples = buf.samples();

                    // Trim the boundary packet so a CUE track never bleeds audio
                    // into the next one.
                    if let Some(end) = self.clip_end_frame {
                        let frames = if ch > 0 { samples.len() / ch } else { 0 };
                        if packet_ts + frames as u64 > end {
                            let keep_frames = (end - packet_ts) as usize;
                            let keep = (keep_frames * ch).min(samples.len());
                            out.extend_from_slice(&samples[..keep]);
                            return Ok(true);
                        }
                    }

                    out.extend_from_slice(samples);
                    return Ok(true);
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(e) => return Err(anyhow!("Decode error: {e}")),
            }
        }
    }
}

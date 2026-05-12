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
}

impl StreamSource {
    pub fn open(path: &Path) -> Result<Self> {
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

        let duration_secs = if let (Some(n_frames), Some(tb)) =
            (track.codec_params.n_frames, track.codec_params.time_base)
        {
            n_frames as f64 * tb.numer as f64 / tb.denom as f64
        } else {
            0.0
        };

        let dec_opts = DecoderOptions::default();
        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &dec_opts)
            .map_err(|e| anyhow!("Decoder error: {e}"))?;

        Ok(Self {
            format,
            decoder,
            track_id,
            sample_buf: None,
            sample_rate,
            channels,
            duration_secs,
        })
    }

    pub fn seek_to_secs(&mut self, secs: f64) -> Result<()> {
        let time = Time::from(secs);
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

            match self.decoder.decode(&packet) {
                Ok(audio_buf) => {
                    let spec = *audio_buf.spec();
                    let duration = audio_buf.capacity() as u64;
                    let required =
                        (duration * spec.channels.count() as u64) as usize;
                    match &self.sample_buf {
                        Some(buf) if buf.capacity() == required => {}
                        _ => {
                            self.sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
                        }
                    }
                    let buf = self.sample_buf.as_mut().expect("sample buffer");
                    buf.copy_interleaved_ref(audio_buf);
                    out.extend_from_slice(buf.samples());
                    return Ok(true);
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(e) => return Err(anyhow!("Decode error: {e}")),
            }
        }
    }
}

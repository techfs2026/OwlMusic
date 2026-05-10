use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Stream, StreamConfig};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use super::decoder::decode_file;

/// Shared playback state between the AudioPlayer handle and the cpal callback.
pub struct PlaybackState {
    samples: Vec<f32>,
    /// Current read position in samples (interleaved)
    position: usize,
    channels: usize,
    paused: bool,
    volume: f32,
}

pub struct AudioPlayer {
    /// The cpal stream — kept alive as long as playback is active
    _stream: Option<Stream>,
    state: Option<Arc<Mutex<PlaybackState>>>,
    sample_rate: u32,
    duration_secs: f64,
    /// Position snapshot for UI polling (updated by callback)
    position_secs: Arc<AtomicU64>, // stored as f64 bits
    is_playing: Arc<AtomicBool>,
}

// Safety: Stream is not Send by default on some platforms.
// We store it in a Mutex<AudioPlayer> so access is serialised.
unsafe impl Send for AudioPlayer {}

impl AudioPlayer {
    pub fn new() -> Self {
        Self {
            _stream: None,
            state: None,
            sample_rate: 44100,
            duration_secs: 0.0,
            position_secs: Arc::new(AtomicU64::new(0)),
            is_playing: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Load a file and immediately start playing.
    pub fn load_and_play(&mut self, path: &std::path::Path) -> Result<()> {
        // Stop previous stream
        self.stop();

        let decoded = decode_file(path)?;
        self.sample_rate = decoded.sample_rate;
        self.duration_secs = decoded.duration_secs;

        let state = Arc::new(Mutex::new(PlaybackState {
            samples: decoded.samples,
            position: 0,
            channels: decoded.channels as usize,
            paused: false,
            volume: 1.0,
        }));

        let stream = self.build_stream(Arc::clone(&state))?;
        stream.play()?;

        self._stream = Some(stream);
        self.state = Some(state);
        self.is_playing.store(true, Ordering::SeqCst);

        Ok(())
    }

    fn build_stream(&self, state: Arc<Mutex<PlaybackState>>) -> Result<Stream> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| anyhow!("No output device"))?;

        let locked = state.lock();
        let ch = locked.channels as u16;
        let sr = self.sample_rate;
        drop(locked);

        let config = StreamConfig {
            channels: ch,
            sample_rate: sr,
            buffer_size: cpal::BufferSize::Default,
        };

        let position_secs = Arc::clone(&self.position_secs);
        let is_playing = Arc::clone(&self.is_playing);
        let sample_rate_f = sr as f64;

        let stream = device.build_output_stream(
            &config,
            move |output: &mut [f32], _| {
                let mut s = state.lock();

                if s.paused {
                    // Fill with silence
                    for o in output.iter_mut() {
                        *o = 0.0;
                    }
                    return;
                }

                let channels = s.channels;
                let volume = s.volume;

                for (i, o) in output.iter_mut().enumerate() {
                    if s.position < s.samples.len() {
                        *o = s.samples[s.position] * volume;
                        s.position += 1;
                    } else {
                        *o = 0.0;
                        // Reached end of track
                        if i == 0 {
                            is_playing.store(false, Ordering::SeqCst);
                        }
                    }
                }

                // Update position counter (in seconds)
                let pos_secs = s.position as f64 / (sample_rate_f * channels as f64);
                position_secs.store(pos_secs.to_bits(), Ordering::Relaxed);
            },
            |err| {
                log::error!("Audio stream error: {err}");
            },
            None,
        )?;

        Ok(stream)
    }

    pub fn play(&mut self) {
        if let Some(state) = &self.state {
            state.lock().paused = false;
            self.is_playing.store(true, Ordering::SeqCst);
        }
    }

    pub fn pause(&mut self) {
        if let Some(state) = &self.state {
            state.lock().paused = true;
            self.is_playing.store(false, Ordering::SeqCst);
        }
    }

    pub fn stop(&mut self) {
        self._stream = None;
        self.state = None;
        self.is_playing.store(false, Ordering::SeqCst);
        self.position_secs.store(0f64.to_bits(), Ordering::SeqCst);
    }

    pub fn seek(&mut self, secs: f64) {
        if let Some(state) = &self.state {
            let mut s = state.lock();
            let sample_pos = (secs * self.sample_rate as f64 * s.channels as f64) as usize;
            s.position = sample_pos.min(s.samples.len().saturating_sub(1));
            self.position_secs.store(secs.to_bits(), Ordering::SeqCst);
        }
    }

    pub fn set_volume(&mut self, vol: f32) {
        if let Some(state) = &self.state {
            state.lock().volume = vol.clamp(0.0, 1.0);
        }
    }

    pub fn get_position(&self) -> f64 {
        f64::from_bits(self.position_secs.load(Ordering::Relaxed))
    }

    pub fn get_duration(&self) -> f64 {
        self.duration_secs
    }

    pub fn is_playing(&self) -> bool {
        self.is_playing.load(Ordering::SeqCst)
    }

    /// Label for the UI: `"idle"` | `"paused"` | `"playing"`.
    pub fn playback_state_label(&self) -> &'static str {
        let Some(st) = &self.state else {
            return "idle";
        };
        let inner = st.lock();
        if inner.paused {
            return "paused";
        }
        if self.is_playing() {
            return "playing";
        }
        "paused"
    }

    pub fn get_volume(&self) -> f32 {
        self.state
            .as_ref()
            .map(|s| s.lock().volume)
            .unwrap_or(1.0)
    }
}

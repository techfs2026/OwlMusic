use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Stream, StreamConfig};
use crossbeam_channel::{unbounded, Sender};
use parking_lot::{Condvar, Mutex};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::decoder::StreamSource;
use super::spectrum::SpectrumRing;

/// Max queued PCM ahead of playback (~seconds * sr * channels, capped).
const QUEUE_MAX_SECS: f64 = 6.0;
/// Start playback once this much PCM is ready (reduces underrun at start).
const PREROLL_SECS: f64 = 0.35;
const PREROLL_WAIT_ITERATIONS: u32 = 600;

#[derive(Debug)]
enum DecodeCmd {
    Stop,
    Seek(f64),
}

/// Shared between cpal callback and decode thread.
struct PlaybackState {
    queue: VecDeque<f32>,
    max_samples: usize,
    decode_finished: bool,
    channels: usize,
    paused: bool,
    volume: f32,
    /// One interleaved frame before averaging to mono for spectrum.
    chan_gather: Vec<f32>,
}

pub struct AudioPlayer {
    _stream: Option<Stream>,
    /// `(state, cvar)` — decode thread waits on cvar when queue is full; callback notifies after pop.
    stream_pair: Option<Arc<(Mutex<PlaybackState>, Condvar)>>,
    sample_rate: u32,
    duration_secs: f64,
    position_secs: Arc<AtomicU64>,
    is_playing: Arc<AtomicBool>,
    decode_thread: Option<JoinHandle<()>>,
    decode_abort: Arc<AtomicBool>,
    decode_cmd: Option<Sender<DecodeCmd>>,
    spectrum_ring: Arc<SpectrumRing>,
}

unsafe impl Send for AudioPlayer {}

fn decode_loop(
    mut source: StreamSource,
    pair: Arc<(Mutex<PlaybackState>, Condvar)>,
    cmd_rx: crossbeam_channel::Receiver<DecodeCmd>,
    abort: Arc<AtomicBool>,
) {
    let (lock, cvar) = &*pair;
    let mut scratch = Vec::with_capacity(16384);

    'outer: loop {
        if abort.load(Ordering::SeqCst) {
            break;
        }

        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                DecodeCmd::Stop => break 'outer,
                DecodeCmd::Seek(secs) => {
                    let mut g = lock.lock();
                    g.queue.clear();
                    g.decode_finished = false;
                    drop(g);
                    if let Err(e) = source.seek_to_secs(secs) {
                        log::error!("Seek failed: {e}");
                    }
                    cvar.notify_all();
                }
            }
        }

        match source.read_next_samples(&mut scratch) {
            Ok(true) if !scratch.is_empty() => {
                let mut g = lock.lock();
                while g.queue.len() + scratch.len() > g.max_samples && !abort.load(Ordering::SeqCst)
                {
                    cvar.wait(&mut g);
                }
                if abort.load(Ordering::SeqCst) {
                    break 'outer;
                }
                g.queue.extend(scratch.iter().copied());
                drop(g);
                cvar.notify_all();
            }
            Ok(true) => continue,
            Ok(false) => {
                let mut g = lock.lock();
                g.decode_finished = true;
                drop(g);
                cvar.notify_all();
                break;
            }
            Err(e) => {
                log::error!("Decode stream error: {e}");
                let mut g = lock.lock();
                g.decode_finished = true;
                drop(g);
                cvar.notify_all();
                break;
            }
        }
    }
}

impl AudioPlayer {
    /// Stop decode thread after output device failed (no stream was installed).
    /// `pair` must be the same `Arc` the decode thread is blocking on (e.g. full-queue wait).
    fn cleanup_decode_after_failed_output(&mut self, pair: &Arc<(Mutex<PlaybackState>, Condvar)>) {
        self.decode_abort.store(true, Ordering::SeqCst);
        pair.1.notify_all();
        if let Some(tx) = self.decode_cmd.take() {
            let _ = tx.send(DecodeCmd::Stop);
        }
        if let Some(h) = self.decode_thread.take() {
            let _ = h.join();
        }
        self.decode_abort.store(false, Ordering::SeqCst);
    }

    pub fn new() -> Self {
        Self {
            _stream: None,
            stream_pair: None,
            sample_rate: 44100,
            duration_secs: 0.0,
            position_secs: Arc::new(AtomicU64::new(0)),
            is_playing: Arc::new(AtomicBool::new(false)),
            decode_thread: None,
            decode_abort: Arc::new(AtomicBool::new(false)),
            decode_cmd: None,
            spectrum_ring: Arc::new(SpectrumRing::new()),
        }
    }

    pub fn spectrum_ring(&self) -> Arc<SpectrumRing> {
        Arc::clone(&self.spectrum_ring)
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Load a file, pre-buffer, then start playback (decode continues in a background thread).
    // player.rs — 只替换这两个函数，其余不变

    pub fn load_and_play(&mut self, path: &std::path::Path) -> Result<()> {
        self.stop();

        let source = StreamSource::open(path)?;
        self.sample_rate = source.sample_rate;
        self.duration_secs = source.duration_secs;
        let channels = source.channels as usize;
        let sr = self.sample_rate;
        let max_samples = ((sr as f64) * QUEUE_MAX_SECS * (channels as f64)).ceil() as usize;
        let preroll_samples =
            (((sr as f64) * PREROLL_SECS * (channels as f64)).ceil() as usize).max(2048);

        let state = PlaybackState {
            queue: VecDeque::with_capacity(preroll_samples.min(max_samples)),
            max_samples,
            decode_finished: false,
            channels,
            paused: false,
            volume: 1.0,
            chan_gather: Vec::with_capacity(channels),
        };

        let pair = Arc::new((Mutex::new(state), Condvar::new()));
        let (cmd_tx, cmd_rx) = unbounded();

        self.decode_abort.store(false, Ordering::SeqCst);
        let abort = Arc::clone(&self.decode_abort);
        let pair_thread = Arc::clone(&pair);

        let handle = std::thread::spawn(move || decode_loop(source, pair_thread, cmd_rx, abort));

        self.decode_thread = Some(handle);
        self.decode_cmd = Some(cmd_tx);

        // 等待预滚
        let wait_start = Instant::now();
        let mut iterations = 0u32;
        loop {
            let (len, done) = {
                let g = pair.0.lock();
                (g.queue.len(), g.decode_finished)
            };
            if len >= preroll_samples || done {
                break;
            }
            if iterations >= PREROLL_WAIT_ITERATIONS
                || wait_start.elapsed() > Duration::from_secs(30)
            {
                log::warn!("Pre-roll wait timed out; starting with {len} samples buffered");
                break;
            }
            iterations += 1;
            std::thread::sleep(Duration::from_millis(5));
        }

        self.spectrum_ring.clear();

        let stream = match self.build_stream(Arc::clone(&pair), Arc::clone(&self.spectrum_ring)) {
            Ok(s) => s,
            Err(e) => {
                self.cleanup_decode_after_failed_output(&pair);
                return Err(e);
            }
        };
        // Bug2 修复：play() 失败时也要清理 decode 线程
        if let Err(e) = stream.play() {
            self.cleanup_decode_after_failed_output(&pair);
            return Err(anyhow!("Stream play failed: {e}"));
        }

        self._stream = Some(stream);
        self.stream_pair = Some(pair);
        self.position_secs.store(0f64.to_bits(), Ordering::Relaxed);
        self.is_playing.store(true, Ordering::SeqCst);

        Ok(())
    }

    fn build_stream(
        &self,
        pair: Arc<(Mutex<PlaybackState>, Condvar)>,
        spectrum_ring: Arc<SpectrumRing>,
    ) -> Result<Stream> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| anyhow!("No output device"))?;

        let channels = {
            let g = pair.0.lock();
            g.channels as u16
        };
        let sr = self.sample_rate; // u32

        // 0.17: SampleRate 就是 u32，直接比较，无需 .0
        let config: StreamConfig = {
            let supported = device
                .supported_output_configs()
                .map(|iter| {
                    iter.filter(|c| c.channels() == channels)
                        .any(|c| c.min_sample_rate() <= sr && c.max_sample_rate() >= sr)
                })
                .unwrap_or(false);

            if supported {
                StreamConfig {
                    channels,
                    sample_rate: sr, // 0.17: 直接用 u32，不需要 SampleRate(sr)
                    buffer_size: cpal::BufferSize::Default,
                }
            } else {
                log::warn!(
                    "Output device does not support sr={sr} ch={channels}; \
                     falling back to device default config"
                );
                device
                    .default_output_config()
                    .map_err(|e| anyhow!("No default output config: {e}"))?
                    .into()
            }
        };

        let position_secs = Arc::clone(&self.position_secs);
        let is_playing = Arc::clone(&self.is_playing);
        // 0.17: config.sample_rate 就是 u32，直接 as f64
        let sample_rate_f = config.sample_rate as f64;
        let config_channels = config.channels as usize;

        let stream = device.build_output_stream(
            &config,
            move |output: &mut [f32], _| {
                let (lock, cvar) = &*pair;
                let mut s = lock.lock();

                if s.paused {
                    for o in output.iter_mut() {
                        *o = 0.0;
                    }
                    drop(s);
                    return;
                }

                let ch = s.channels;
                let volume = s.volume;
                let mut written = 0usize;
                let mut from_queue = 0usize;

                while written < output.len() {
                    if s.queue.is_empty() {
                        if s.decode_finished {
                            for o in output[written..].iter_mut() {
                                *o = 0.0;
                            }
                            is_playing.store(false, Ordering::SeqCst);
                            break;
                        }
                        output[written] = 0.0;
                        written += 1;
                    } else {
                        let smp = s.queue.pop_front().unwrap() * volume;
                        output[written] = smp;
                        written += 1;
                        from_queue += 1;
                        s.chan_gather.push(smp);
                        if s.chan_gather.len() == ch {
                            let mono: f32 = s.chan_gather.iter().copied().sum::<f32>() / ch as f32;
                            spectrum_ring.push_mono(mono);
                            s.chan_gather.clear();
                        }
                    }
                }

                if from_queue > 0 {
                    let prev = f64::from_bits(position_secs.load(Ordering::Relaxed));
                    let delta = from_queue as f64 / (sample_rate_f * config_channels as f64);
                    position_secs.store((prev + delta).to_bits(), Ordering::Relaxed);
                }

                drop(s);
                if from_queue > 0 {
                    cvar.notify_all();
                }
            },
            |err| {
                log::error!("Audio stream error: {err}");
            },
            None,
        )?;

        Ok(stream)
    }

    pub fn play(&mut self) {
        if let Some(pair) = &self.stream_pair {
            pair.0.lock().paused = false;
            self.is_playing.store(true, Ordering::SeqCst);
        }
    }

    pub fn pause(&mut self) {
        if let Some(pair) = &self.stream_pair {
            pair.0.lock().paused = true;
            self.is_playing.store(false, Ordering::SeqCst);
        }
    }

    pub fn stop(&mut self) {
        // Decoder may be blocked on full queue waiting for the output callback to drain.
        // Set abort and wake it *before* dropping the stream, otherwise join() deadlocks.
        self.decode_abort.store(true, Ordering::SeqCst);
        if let Some(pair) = &self.stream_pair {
            pair.1.notify_all();
        }

        self._stream = None;

        if let Some(pair) = &self.stream_pair {
            pair.1.notify_all();
        }
        self.stream_pair = None;

        self.spectrum_ring.clear();

        if let Some(tx) = self.decode_cmd.take() {
            let _ = tx.send(DecodeCmd::Stop);
        }
        if let Some(h) = self.decode_thread.take() {
            let _ = h.join();
        }
        self.decode_abort.store(false, Ordering::SeqCst);

        self.is_playing.store(false, Ordering::SeqCst);
        self.position_secs.store(0f64.to_bits(), Ordering::SeqCst);
    }

    pub fn seek(&mut self, secs: f64) {
        let clamped = secs.clamp(0.0, self.duration_secs.max(0.0));
        self.position_secs
            .store(clamped.to_bits(), Ordering::Relaxed);

        if let Some(tx) = &self.decode_cmd {
            let _ = tx.send(DecodeCmd::Seek(clamped));
        }
        if let Some(pair) = &self.stream_pair {
            pair.0.lock().chan_gather.clear();
            pair.1.notify_all();
        }
    }

    pub fn set_volume(&mut self, vol: f32) {
        if let Some(pair) = &self.stream_pair {
            pair.0.lock().volume = vol.clamp(0.0, 1.0);
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

    pub fn playback_state_label(&self) -> &'static str {
        let Some(pair) = &self.stream_pair else {
            return "idle";
        };
        let inner = pair.0.lock();
        if inner.paused {
            return "paused";
        }
        if self.is_playing() {
            return "playing";
        }
        "paused"
    }

    pub fn get_volume(&self) -> f32 {
        self.stream_pair
            .as_ref()
            .map(|p| p.0.lock().volume)
            .unwrap_or(1.0)
    }
}

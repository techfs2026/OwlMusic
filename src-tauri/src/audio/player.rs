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
use super::resampler::Resampler;
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

/// Pick the cpal stream config we'll actually run.
///
/// Returns `(config, bit_perfect)`. `bit_perfect = true` means the stream
/// runs at exactly the source's rate AND channel count, so no resampling
/// or channel remapping happens before output. Otherwise we hand the source
/// to the linear resampler and use the device's default config.
///
/// We *probe* by actually trying to build a no-op stream at the source's
/// format. `supported_output_configs()` on macOS often only lists the rate
/// the device is currently set to, so trusting it would force resampling
/// even when the hardware can switch (e.g. device set to 44.1 kHz, file is
/// 48 kHz — both are universally supported). cpal returns `Err` from
/// `build_output_stream` for configs the hardware truly can't accept, so
/// "build succeeds" is a much more reliable signal.
fn pick_stream_config(
    device: &cpal::Device,
    source_sr: u32,
    source_ch: usize,
) -> Result<(StreamConfig, bool)> {
    #[allow(deprecated)]
    let device_name = device.name().ok();
    log::info!(
        "Audio: source {} Hz / {} ch on device {:?}",
        source_sr,
        source_ch,
        device_name
    );
    if let Ok(iter) = device.supported_output_configs() {
        for c in iter {
            log::info!(
                "  cpal-reported config: ch={}, sr={:?}..={:?}, fmt={:?}",
                c.channels(),
                c.min_sample_rate(),
                c.max_sample_rate(),
                c.sample_format()
            );
        }
    }
    if let Ok(d) = device.default_output_config() {
        log::info!(
            "  device default: ch={}, sr={:?}, fmt={:?}",
            d.channels(),
            d.sample_rate(),
            d.sample_format()
        );
    }

    let preferred = StreamConfig {
        channels: source_ch as u16,
        sample_rate: source_sr,
        buffer_size: cpal::BufferSize::Default,
    };

    // Probe with an empty callback; discard immediately if it builds.
    let probe = device.build_output_stream(
        &preferred,
        |_: &mut [f32], _: &cpal::OutputCallbackInfo| {},
        |err| log::warn!("Probe stream callback error: {}", err),
        None,
    );
    match probe {
        Ok(stream) => {
            drop(stream);
            log::info!(
                "  → bit-perfect: cpal accepted {} Hz / {} ch",
                source_sr,
                source_ch
            );
            return Ok((preferred, true));
        }
        Err(e) => {
            log::warn!(
                "  → cpal rejected {} Hz / {} ch ({}); falling back",
                source_sr,
                source_ch,
                e
            );
        }
    }

    let default_config: StreamConfig = device
        .default_output_config()
        .map_err(|e| anyhow!("No default output config: {e}"))?
        .into();
    log::info!(
        "  → using default {} Hz / {} ch + resampler",
        default_config.sample_rate,
        default_config.channels
    );
    Ok((default_config, false))
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
    source_sample_rate: u32,
    source_channels: u32,
    source_bits_per_sample: Option<u32>,
    output_channels: u32,
    bit_perfect: bool,
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
    mut resampler: Resampler,
    pair: Arc<(Mutex<PlaybackState>, Condvar)>,
    cmd_rx: crossbeam_channel::Receiver<DecodeCmd>,
    abort: Arc<AtomicBool>,
) {
    let (lock, cvar) = &*pair;
    let mut src_scratch = Vec::with_capacity(16384);
    let mut out_scratch = Vec::with_capacity(16384);

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
                    resampler.reset();
                    cvar.notify_all();
                }
            }
        }

        match source.read_next_samples(&mut src_scratch) {
            Ok(true) if !src_scratch.is_empty() => {
                out_scratch.clear();
                resampler.process(&src_scratch, &mut out_scratch);
                if out_scratch.is_empty() {
                    continue;
                }
                let mut g = lock.lock();
                while g.queue.len() + out_scratch.len() > g.max_samples
                    && !abort.load(Ordering::SeqCst)
                {
                    cvar.wait(&mut g);
                }
                if abort.load(Ordering::SeqCst) {
                    break 'outer;
                }
                g.queue.extend(out_scratch.iter().copied());
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
            source_sample_rate: 0,
            source_channels: 0,
            source_bits_per_sample: None,
            output_channels: 0,
            bit_perfect: false,
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

    pub fn source_sample_rate(&self) -> u32 {
        self.source_sample_rate
    }

    pub fn source_channels(&self) -> u32 {
        self.source_channels
    }

    pub fn output_channels(&self) -> u32 {
        self.output_channels
    }

    pub fn bit_perfect(&self) -> bool {
        self.bit_perfect
    }

    pub fn source_bits_per_sample(&self) -> Option<u32> {
        self.source_bits_per_sample
    }

    /// Load a file, pre-buffer, then start playback (decode continues in a background thread).
    // player.rs — 只替换这两个函数，其余不变

    pub fn load_and_play(
        &mut self,
        path: &std::path::Path,
        start_secs: Option<f64>,
        end_secs: Option<f64>,
    ) -> Result<()> {
        self.stop();

        let source = StreamSource::open_clip(path, start_secs, end_secs)?;
        let source_sr = source.sample_rate;
        let source_ch = source.channels as usize;
        let source_bits = source.bits_per_sample;
        self.duration_secs = source.duration_secs;
        self.source_bits_per_sample = source_bits;

        // Bit-perfect first: ask cpal/CoreAudio to switch the device to the
        // source's native rate + channels when supported, so the FLAC plays
        // without any resampling. Only fall back to the device's default
        // config (+ our linear resampler) when the hardware truly can't take
        // the source format — that's the path that can't be bit-perfect.
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| anyhow!("No output device"))?;
        let (stream_config, bit_perfect) = pick_stream_config(&device, source_sr, source_ch)?;

        let output_sr = stream_config.sample_rate;
        let output_ch = stream_config.channels as usize;
        self.sample_rate = output_sr;
        self.source_sample_rate = source_sr;
        self.source_channels = source_ch as u32;
        self.output_channels = output_ch as u32;
        self.bit_perfect = bit_perfect;

        if bit_perfect {
            log::info!(
                "Bit-perfect: source {} Hz / {} ch matches device output",
                source_sr,
                source_ch
            );
        } else {
            log::info!(
                "Resampling: source {} Hz / {} ch → device {} Hz / {} ch",
                source_sr,
                source_ch,
                output_sr,
                output_ch
            );
        }

        let resampler = Resampler::new(source_sr, source_ch, output_sr, output_ch);

        let max_samples =
            ((output_sr as f64) * QUEUE_MAX_SECS * (output_ch as f64)).ceil() as usize;
        let preroll_samples =
            (((output_sr as f64) * PREROLL_SECS * (output_ch as f64)).ceil() as usize).max(2048);

        let state = PlaybackState {
            queue: VecDeque::with_capacity(preroll_samples.min(max_samples)),
            max_samples,
            decode_finished: false,
            channels: output_ch,
            paused: false,
            volume: 1.0,
            chan_gather: Vec::with_capacity(output_ch),
        };

        let pair = Arc::new((Mutex::new(state), Condvar::new()));
        let (cmd_tx, cmd_rx) = unbounded();

        self.decode_abort.store(false, Ordering::SeqCst);
        let abort = Arc::clone(&self.decode_abort);
        let pair_thread = Arc::clone(&pair);

        let handle = std::thread::spawn(move || {
            decode_loop(source, resampler, pair_thread, cmd_rx, abort)
        });

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

        let stream = match self.build_stream(
            &device,
            &stream_config,
            Arc::clone(&pair),
            Arc::clone(&self.spectrum_ring),
        ) {
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
        device: &cpal::Device,
        config: &StreamConfig,
        pair: Arc<(Mutex<PlaybackState>, Condvar)>,
        spectrum_ring: Arc<SpectrumRing>,
    ) -> Result<Stream> {
        let position_secs = Arc::clone(&self.position_secs);
        let is_playing = Arc::clone(&self.is_playing);
        let sample_rate_f = config.sample_rate as f64;
        let config_channels = config.channels as usize;

        let stream = device.build_output_stream(
            config,
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

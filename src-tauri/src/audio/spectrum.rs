//! Ring buffer of mono samples from playback + FFT → bar magnitudes for the UI.

use std::collections::VecDeque;
use std::sync::Arc;

use parking_lot::Mutex;
use realfft::{RealFftPlanner, RealToComplex};
use rustfft::num_complex::Complex;

/// Compact cassette shell (label face), IEC-style proportions in mm — used only for docs / ratios.
#[allow(dead_code)]
pub const CASSETTE_FACE_MM_W: f32 = 102.0;
#[allow(dead_code)]
pub const CASSETTE_FACE_MM_H: f32 = 64.0;

pub const FFT_SIZE: usize = 2048;
pub const SPECTRUM_BARS: usize = 48;
const RING_CAP: usize = 8192;

/// dBFS floor for visualization. Anything below this maps to 0.
const DB_FLOOR: f32 = -90.0;
/// dBFS ceiling — at this level a bar reaches 1.0.
const DB_CEIL: f32 = 0.0;

pub struct SpectrumRing {
    buf: Mutex<VecDeque<f32>>,
}

impl SpectrumRing {
    pub fn new() -> Self {
        Self {
            buf: Mutex::new(VecDeque::with_capacity(RING_CAP)),
        }
    }

    pub fn push_mono(&self, sample: f32) {
        let mut q = self.buf.lock();
        q.push_back(sample);
        while q.len() > RING_CAP {
            q.pop_front();
        }
    }

    pub fn clear(&self) {
        self.buf.lock().clear();
    }

    fn copy_last(&self, out: &mut [f32]) -> bool {
        let q = self.buf.lock();
        if q.len() < out.len() {
            return false;
        }
        let skip = q.len() - out.len();
        for (i, v) in q.iter().skip(skip).take(out.len()).enumerate() {
            out[i] = *v;
        }
        true
    }
}

pub struct SpectrumFft {
    r2c: Arc<dyn RealToComplex<f32>>,
    windowed: Vec<f32>,
    spectrum: Vec<Complex<f32>>,
    /// Per-bin Hann coefficient cache.
    window: Vec<f32>,
    /// FFT amplitude scale: 2 / (N * coherent_gain). Hann coherent gain = 0.5,
    /// so this is 2 / (N * 0.5) = 4 / N — converts |X[k]| to peak amplitude.
    amp_scale: f32,
}

impl SpectrumFft {
    pub fn new() -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        let r2c = planner.plan_fft_forward(FFT_SIZE);
        let windowed = r2c.make_input_vec();
        let spectrum = r2c.make_output_vec();

        // Precompute Hann window.
        let n = FFT_SIZE;
        let pi = std::f32::consts::PI;
        let mut window = vec![0.0f32; n];
        for i in 0..n {
            window[i] = 0.5 * (1.0 - (2.0 * pi * i as f32 / (n - 1).max(1) as f32).cos());
        }

        // Hann coherent gain = sum(window)/N = 0.5. To get peak amplitude back from |X[k]|
        // we scale by 2/(N * coherent_gain) = 4/N. For a full-scale sine, this gives ~1.0.
        let amp_scale = 4.0 / n as f32;

        Self {
            r2c,
            windowed,
            spectrum,
            window,
            amp_scale,
        }
    }

    /// Fills `bars` with values in 0..1 from current ring buffer; `sample_rate` for log band mapping.
    /// Values reflect true loudness — quiet passages stay low, loud bursts go high.
    pub fn compute_bars(&mut self, ring: &SpectrumRing, sample_rate: u32, bars: &mut [f32; SPECTRUM_BARS]) {
        bars.fill(0.0);
        if !ring.copy_last(&mut self.windowed) {
            return;
        }

        let n = FFT_SIZE;
        for i in 0..n {
            self.windowed[i] *= self.window[i];
        }

        if self.r2c.process(&mut self.windowed, &mut self.spectrum).is_err() {
            return;
        }

        let sr = sample_rate.max(8000) as f64;
        let nyquist = sr * 0.5;
        let fft_len = n as f64;
        let half = self.spectrum.len();
        const F_MIN: f64 = 40.0;

        // Convert complex bins to magnitude in absolute amplitude (peak-equivalent).
        let mut mags = vec![0.0f32; half];
        for i in 0..half {
            let c = self.spectrum[i];
            mags[i] = (c.re * c.re + c.im * c.im).sqrt() * self.amp_scale;
        }
        // DC has no useful info.
        if !mags.is_empty() {
            mags[0] = 0.0;
        }

        let db_range = DB_CEIL - DB_FLOOR; // typically 90

        for b in 0..SPECTRUM_BARS {
            let f_lo = F_MIN * (nyquist / F_MIN).powf(b as f64 / SPECTRUM_BARS as f64);
            let f_hi = F_MIN * (nyquist / F_MIN).powf((b + 1) as f64 / SPECTRUM_BARS as f64);
            let bin_lo = ((f_lo * fft_len) / sr).floor() as usize;
            let bin_hi = ((f_hi * fft_len) / sr).ceil() as usize;
            let bin_lo = bin_lo.min(half.saturating_sub(1));
            let bin_hi = bin_hi.max(bin_lo + 1).min(half);

            // Peak across bins in this band — keeps transients sharp.
            let mut peak = 0.0f32;
            for k in bin_lo..bin_hi {
                peak = peak.max(mags[k]);
            }

            // Convert to dBFS. Floor at very low values to avoid -inf.
            let db = 20.0 * (peak.max(1e-9)).log10();
            let norm = ((db - DB_FLOOR) / db_range).clamp(0.0, 1.0);
            bars[b] = norm;
        }
    }
}
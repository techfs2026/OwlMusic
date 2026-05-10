use std::collections::VecDeque;

/// Shared PCM ring buffer between decoder thread and playback thread.
/// Stores interleaved f32 samples.
pub struct PcmBuffer {
    data: VecDeque<f32>,
    capacity: usize,
}

impl PcmBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            data: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    pub fn push_samples(&mut self, samples: &[f32]) {
        for &s in samples {
            if self.data.len() >= self.capacity {
                self.data.pop_front();
            }
            self.data.push_back(s);
        }
    }

    pub fn pop_samples(&mut self, count: usize) -> Vec<f32> {
        let take = count.min(self.data.len());
        self.data.drain(..take).collect()
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn clear(&mut self) {
        self.data.clear();
    }
}

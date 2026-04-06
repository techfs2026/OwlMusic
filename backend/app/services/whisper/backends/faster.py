"""
Faster-Whisper backend with stable-ts forced alignment.

stable-ts uses audio energy + attention weights to "snap" word boundaries
to actual phoneme onsets/offsets, reducing timestamp error from ±300ms
(raw Whisper) to roughly ±30-80ms in typical conditions.

Install:
    pip install stable-ts faster-whisper

Config:
    device=cuda, compute_type=float16  → NVIDIA GPU (recommended)
    device=cpu,  compute_type=int8     → CPU fallback
"""

import logging
from ..models import Word
from .base import WhisperBackend

logger = logging.getLogger(__name__)


class FasterWhisperBackend(WhisperBackend):

    def __init__(self, model_size: str, device: str, compute_type: str) -> None:
        # stable-ts wraps faster-whisper's WhisperModel and adds refined
        # timestamp logic on top. The API is a near-drop-in replacement.
        try:
            import stable_whisper
            logger.info(
                f"[FasterWhisper] stable-ts available — using refined timestamps. "
                f"model={model_size} device={device} compute_type={compute_type}"
            )
            self._model = stable_whisper.load_faster_whisper(
                model_size,
                device=device,
                compute_type=compute_type,
            )
            self._use_stable = True
        except ImportError:
            logger.warning(
                "[FasterWhisper] stable-ts not installed (pip install stable-ts). "
                "Falling back to raw faster-whisper word timestamps."
            )
            from faster_whisper import WhisperModel
            self._model = WhisperModel(
                model_size,
                device=device,
                compute_type=compute_type,
            )
            self._use_stable = False

    @property
    def name(self) -> str:
        suffix = "+stable-ts" if self._use_stable else ""
        return f"faster_whisper{suffix}"

    def transcribe_raw(self, wav_path: str, language: str) -> list[Word]:
        if self._use_stable:
            return self._transcribe_stable(wav_path, language)
        return self._transcribe_fallback(wav_path, language)

    # ── stable-ts path ────────────────────────────────────────────────────────

    def _transcribe_stable(self, wav_path: str, language: str) -> list[Word]:
        """
        stable-ts refine pipeline:
          1. transcribe_stable() runs the normal Whisper decode pass
          2. internally runs a second pass to refit word boundaries
             using cross-attention + audio energy valley detection
        The result object has a .segments list with per-segment .words.
        """
        result = self._model.transcribe_stable(
            wav_path,
            language=language,
            word_timestamps=True,
            # Suppress blank/filler tokens that often get bogus timestamps
            suppress_silence=True,
            # How aggressively to shift boundaries toward energy valleys.
            # 0.2 is conservative; raise to 0.5 if timestamps still drift.
            regroup=True,
        )

        words: list[Word] = []
        for seg in result.segments:
            for w in seg.words:
                words.append(Word(
                    word=w.word,
                    start=float(round(w.start, 3)),
                    end=float(round(w.end, 3)),
                    probability=float(round(getattr(w, "probability", 1.0), 4)),
                ))
        return words

    # ── raw faster-whisper fallback ───────────────────────────────────────────

    def _transcribe_fallback(self, wav_path: str, language: str) -> list[Word]:
        segments_iter, _ = self._model.transcribe(
            wav_path,
            language=language,
            word_timestamps=True,
            beam_size=5,
            # Let Silero VAD (called in transcriber.py) handle silence;
            # keep the internal vad_filter as a safety net for any audio
            # that bypasses the outer VAD step.
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                min_speech_duration_ms=200,
            ),
        )

        words: list[Word] = []
        for seg in segments_iter:
            if not seg.words:
                continue
            for w in seg.words:
                words.append(Word(
                    word=w.word,
                    start=float(round(w.start, 3)),
                    end=float(round(w.end, 3)),
                    probability=float(round(w.probability, 4)),
                ))
        return words
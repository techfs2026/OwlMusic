"""
MLX backend: Apple Silicon only, uses Metal GPU via mlx-whisper.
~5-8x realtime on M-series chips.

Timestamp refinement via stable-ts transcribe_any():
  stable-ts wraps mlx_whisper.transcribe and refines word boundaries
  using audio energy valleys — no attention weights needed.

Install:
    pip install mlx-whisper stable-ts
"""

import logging
from ..models import Word
from .base import WhisperBackend

logger = logging.getLogger(__name__)

MLX_MODEL_MAP = {
    "tiny":     "mlx-community/whisper-tiny-mlx",
    "base":     "mlx-community/whisper-base-mlx",
    "small":    "mlx-community/whisper-small-mlx",
    "medium":   "mlx-community/whisper-medium-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
}


class MlxBackend(WhisperBackend):

    def __init__(self, model_size: str) -> None:
        self.model_name = MLX_MODEL_MAP.get(
            model_size,
            f"mlx-community/whisper-{model_size}-mlx",
        )
        self._stable_available = self._check_stable_ts()
        logger.info(
            f"[MLX] model={self.model_name} "
            f"stable-ts={'enabled' if self._stable_available else 'disabled (pip install stable-ts)'}"
        )

    @staticmethod
    def _check_stable_ts() -> bool:
        try:
            import stable_whisper  # noqa: F401
            return True
        except ImportError:
            return False

    @property
    def name(self) -> str:
        return "mlx+stable-ts" if self._stable_available else "mlx"

    def transcribe_raw(self, wav_path: str, language: str) -> list[Word]:
        if self._stable_available:
            return self._transcribe_stable(wav_path, language)
        return self._transcribe_raw(wav_path, language)

    # ── stable-ts path ────────────────────────────────────────────────────────

    def _transcribe_stable(self, wav_path: str, language: str) -> list[Word]:
        import mlx_whisper
        import stable_whisper

        result = stable_whisper.transcribe_any(
            mlx_whisper.transcribe,
            wav_path,
            inference_kwargs={
                "path_or_hf_repo": self.model_name,
                "language": language,
                "word_timestamps": True,
                "verbose": False,
            },
            suppress_silence=True,
            regroup=True,
            # mlx-whisper occasionally emits segments out of order.
            # check_sorted=False tells stable-ts to sort instead of raising.
            # force_order=True enforces monotone word timestamps after sorting.
            check_sorted=False,
            force_order=True,
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

    # ── raw mlx-whisper fallback ──────────────────────────────────────────────

    def _transcribe_raw(self, wav_path: str, language: str) -> list[Word]:
        import mlx_whisper

        result = mlx_whisper.transcribe(
            wav_path,
            path_or_hf_repo=self.model_name,
            language=language,
            word_timestamps=True,
            verbose=False,
        )

        words: list[Word] = []
        for seg in result.get("segments", []):
            for w in seg.get("words", []):
                words.append(Word(
                    word=w["word"],
                    start=float(round(w["start"], 3)),
                    end=float(round(w["end"], 3)),
                    probability=float(round(w.get("probability", 1.0), 4)),
                ))
        return words
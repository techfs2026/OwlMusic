from abc import ABC, abstractmethod
from ..models import Word


class WhisperBackend(ABC):
    """
    Abstract base for whisper backends.
    Each backend must implement transcribe_raw() and return a Word list.
    The rest of the pipeline (SentenceSplitter) is backend-agnostic.
    """

    @abstractmethod
    def transcribe_raw(self, wav_path: str, language: str) -> list[Word]:
        """
        Transcribe a 16kHz mono WAV file.
        Returns word-level timestamps as list[Word].
        All float values must be Python float (not np.float64).
        """

    @property
    @abstractmethod
    def name(self) -> str:
        """Backend identifier for logging."""
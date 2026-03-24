from dataclasses import dataclass, field


@dataclass
class Word:
    """单词级别的转写结果，由 faster-whisper word_timestamps 产出。"""
    word: str
    start: float   # 秒，精确到毫秒
    end: float
    probability: float = 1.0

    def __repr__(self) -> str:
        return f"Word({self.word!r}, {self.start:.3f}-{self.end:.3f})"


@dataclass
class TranscribedSegment:
    """
    最终输出的字幕段，保证：
    - 不从句子中间断开（按标点拆分）
    - 起止时间精确到毫秒
    - text 为完整句子（已 strip）
    """
    seq: int
    start_time: float
    end_time: float
    text: str
    words: list[Word] = field(default_factory=list)  # 保留 word 级别数据，供调试用

    def duration(self) -> float:
        return round(self.end_time - self.start_time, 3)

    def __repr__(self) -> str:
        return (
            f"TranscribedSegment(seq={self.seq}, "
            f"{self.start_time:.3f}-{self.end_time:.3f}, "
            f"{self.text!r})"
        )

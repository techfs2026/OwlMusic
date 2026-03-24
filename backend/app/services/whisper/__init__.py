"""
services.whisper — 可独立使用的转写模块

对外暴露：
    WhisperTranscriber  主入口
    TranscribedSegment  输出数据结构
    Word                word 级时间戳（供调试 / 高级用法）
"""

from .transcriber import WhisperTranscriber
from .models import TranscribedSegment, Word

__all__ = ["WhisperTranscriber", "TranscribedSegment", "Word"]

"""
VAD（Voice Activity Detection）模块
使用 silero-vad 检测音频中的有声区间，用于指导 Whisper 的转写范围。

设计原则：
- 只做有声区间检测，不做任何转写逻辑
- 返回 (start_sec, end_sec) 列表，供 transcriber.py 使用
- 相邻区间间隔 < min_silence_ms 时自动合并，避免切碎短停顿
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# 有声区间，单位秒
SpeechSegment = tuple[float, float]


class SileroVAD:
    """
    封装 silero-vad，提供简洁的有声区间检测接口。

    lazy 加载模型（首次调用 detect 时才加载），避免 import 时就占用内存。
    """

    # 类级别缓存，同进程内复用同一个模型实例
    _model = None
    _utils = None

    def __init__(
        self,
        threshold: float = 0.4,           # 语音概率阈值，越高越严格
        min_speech_ms: int = 300,          # 最短有声段（ms），过滤噪音误判
        min_silence_ms: int = 500,         # 合并间隔：两段静音 < 500ms 则合并
        speech_pad_ms: int = 100,          # 有声段前后各延伸 100ms，避免截头截尾
        sample_rate: int = 16000,          # 必须与输入 WAV 一致
    ) -> None:
        self.threshold = threshold
        self.min_speech_ms = min_speech_ms
        self.min_silence_ms = min_silence_ms
        self.speech_pad_ms = speech_pad_ms
        self.sample_rate = sample_rate

    def _load_model(self) -> None:
        """懒加载 silero-vad 模型，只加载一次。"""
        if SileroVAD._model is not None:
            return

        import torch
        from silero_vad import load_silero_vad, get_speech_timestamps

        logger.info("Loading Silero VAD model...")
        SileroVAD._model = load_silero_vad()
        SileroVAD._utils = get_speech_timestamps
        logger.info("Silero VAD model loaded.")

    def detect(self, wav_path: str) -> list[SpeechSegment]:
        """
        检测 wav_path 中的有声区间。

        Args:
            wav_path: 16kHz mono WAV 文件路径（必须提前用 ffmpeg 转换好）

        Returns:
            有声区间列表，每项为 (start_sec, end_sec)，按时间升序排列。
            如果全程无声，返回 []。
        """
        self._load_model()

        import torch
        from silero_vad import read_audio

        logger.info(f"Running VAD on: {wav_path}")

        audio = read_audio(wav_path, sampling_rate=self.sample_rate)

        raw_segments = SileroVAD._utils(
            audio,
            SileroVAD._model,
            threshold=self.threshold,
            min_speech_duration_ms=self.min_speech_ms,
            min_silence_duration_ms=self.min_silence_ms,
            speech_pad_ms=self.speech_pad_ms,
            return_seconds=True,     # 直接返回秒，不用手动除以 sample_rate
            sampling_rate=self.sample_rate,
        )

        if not raw_segments:
            logger.warning("VAD found no speech segments.")
            return []

        segments = [
            (round(seg["start"], 3), round(seg["end"], 3))
            for seg in raw_segments
        ]

        logger.info(f"VAD detected {len(segments)} speech segments.")
        return segments


def merge_segments(
    segments: list[SpeechSegment],
    max_duration: float = 30.0,
) -> list[SpeechSegment]:
    """
    可选的后处理：将过长的有声段拆分，防止单段超过 Whisper 推荐的 30s 上限。
    SileroVAD.detect() 已经处理了合并逻辑，这里只做拆分兜底。
    """
    result: list[SpeechSegment] = []
    for start, end in segments:
        duration = end - start
        if duration <= max_duration:
            result.append((start, end))
        else:
            # 等分拆分
            n = int(duration // max_duration) + 1
            step = duration / n
            for i in range(n):
                seg_start = round(start + i * step, 3)
                seg_end = round(min(start + (i + 1) * step, end), 3)
                result.append((seg_start, seg_end))
    return result

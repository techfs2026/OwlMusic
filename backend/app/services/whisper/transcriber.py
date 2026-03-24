"""
WhisperTranscriber：转写主流程编排。

流程：
  1. FFmpeg 已将音频转为 16kHz mono WAV（调用方负责，不在此处处理）
  2. SileroVAD  → 检测有声区间，过滤静音
  3. faster-whisper → 对每个有声区间转写，获取 word-level 时间戳
  4. SentenceSplitter → word 列表重组为完整句子
  5. on_progress 回调通知进度（供 Celery task 写 Redis）

设计原则：
  - 不依赖 FastAPI / Celery / Redis，纯业务逻辑
  - 模型在实例化时加载，Worker 进程生命周期内复用
  - on_progress 可选，None 时静默运行（便于单元测试）
"""

from __future__ import annotations

import logging
from typing import Callable

from .models import Word, TranscribedSegment
from .vad import SileroVAD, merge_segments
from .splitter import SentenceSplitter

logger = logging.getLogger(__name__)

# 进度回调类型：(current: int, total: int, text: str) -> None
ProgressCallback = Callable[[int, int, str], None]


class WhisperTranscriber:
    """
    可独立使用的转写模块。

    Usage:
        transcriber = WhisperTranscriber(model_size="medium")
        segments = transcriber.transcribe(
            "audio.wav",
            language="en",
            on_progress=lambda cur, tot, txt: print(f"{cur}/{tot}: {txt}"),
        )
    """

    def __init__(
        self,
        model_size: str = "medium",     # base / medium / large-v3
        device: str = "cpu",            # Apple Silicon 用 cpu（MPS 暂不支持 CTranslate2）
        compute_type: str = "int8",     # cpu 下 int8 最快；gpu 下可用 float16
        vad_threshold: float = 0.4,
        max_seg_sec: float = 12.0,
        soft_break_sec: float = 4.0,
        min_seg_sec: float = 1.0,
    ) -> None:
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type

        # 懒加载：模型在首次 transcribe 调用时才初始化
        self._model = None

        self._vad = SileroVAD(threshold=vad_threshold)
        self._splitter = SentenceSplitter(
            max_seg_sec=max_seg_sec,
            soft_break_sec=soft_break_sec,
            min_seg_sec=min_seg_sec,
        )

    # ── public API ────────────────────────────────────────────────────────────

    def transcribe(
        self,
        wav_path: str,
        language: str = "en",
        on_progress: ProgressCallback | None = None,
    ) -> list[TranscribedSegment]:
        """
        对已转换好的 WAV 文件执行转写。

        Args:
            wav_path:    16kHz mono WAV 文件路径
            language:    音频语言代码（"en" / "zh" 等），None 则自动检测
            on_progress: 进度回调，签名 (current, total, current_text) -> None
                         current/total 基于 VAD 检测到的有声段数量

        Returns:
            按时间排序的 TranscribedSegment 列表，seq 从 0 开始连续编号
        """
        self._ensure_model_loaded()

        # ── Step 1: VAD 检测有声区间 ─────────────────────────────────────────
        logger.info(f"[Transcribe] Running VAD: {wav_path}")
        speech_segs = self._vad.detect(wav_path)

        if not speech_segs:
            logger.warning("[Transcribe] No speech detected, returning empty.")
            return []

        # 兜底：拆分超长段（>30s）防止 Whisper 超出推荐输入长度
        speech_segs = merge_segments(speech_segs, max_duration=29.0)
        total = len(speech_segs)
        logger.info(f"[Transcribe] {total} speech segments after VAD.")

        # ── Step 2: 逐段 Whisper 转写，收集所有 words ─────────────────────────
        all_words: list[Word] = []

        for i, (seg_start, seg_end) in enumerate(speech_segs):
            if on_progress:
                on_progress(i, total, f"转写片段 {i + 1}/{total}...")

            words = self._transcribe_segment(
                wav_path, seg_start, seg_end, language
            )
            all_words.extend(words)

        if on_progress:
            on_progress(total, total, "分句处理中...")

        # ── Step 3: SentenceSplitter 重组为完整句子 ───────────────────────────
        segments = self._splitter.split(all_words)

        # 重新编号（splitter 内部从 0 编，这里再 normalize 一次确保连续）
        for idx, seg in enumerate(segments):
            seg.seq = idx

        logger.info(f"[Transcribe] Done. {len(all_words)} words → {len(segments)} segments.")

        if on_progress:
            on_progress(total, total, f"完成，共 {len(segments)} 句")

        return segments

    # ── private ───────────────────────────────────────────────────────────────

    def _ensure_model_loaded(self) -> None:
        if self._model is not None:
            return
        from faster_whisper import WhisperModel
        logger.info(f"[Transcribe] Loading faster-whisper model: {self.model_size} / {self.device} / {self.compute_type}")
        self._model = WhisperModel(
            self.model_size,
            device=self.device,
            compute_type=self.compute_type,
        )
        logger.info("[Transcribe] Model loaded.")

    def _transcribe_segment(
        self,
        wav_path: str,
        start: float,
        end: float,
        language: str,
    ) -> list[Word]:
        """
        对音频中 [start, end] 区间调用 faster-whisper，返回 Word 列表。

        注意：faster-whisper 的 clip_timestamps 参数直接传入起止时间，
        不需要手动切片音频文件。
        """
        segments_iter, _ = self._model.transcribe(
            wav_path,
            language=language,
            word_timestamps=True,       # 必须开启，splitter 依赖 word 级时间戳
            clip_timestamps=[start, end],
            beam_size=5,
            # 不使用 vad_filter，VAD 已在上层处理
        )

        words: list[Word] = []
        for seg in segments_iter:
            if seg.words is None:
                continue
            for w in seg.words:
                # clip_timestamps 返回的时间是相对于 clip 起点的，需要加回 start
                words.append(Word(
                    word=w.word,
                    start=round(w.start + start, 3),
                    end=round(w.end + start, 3),
                    probability=round(w.probability, 4),
                ))

        return words

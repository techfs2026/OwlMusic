"""
SentenceSplitter：把 word-level 时间戳重组为完整句子。

核心问题：Whisper 的 segment 分段完全由模型决定，经常在句子中间切断。
解决思路：忽略 Whisper 原始 segment 边界，从 word 列表重新按标点组句。

断句规则（优先级从高到低）：
  1. 强制断句符  .  !  ?  …  —— 句子自然结束
  2. 弱断句符    ,  ;  :  —— 当前段时长 > soft_break_sec 时才断
  3. 时长兜底    —— 单段超过 max_seg_sec 时，在当前 word 后强制断
  4. 合并过短段  —— 断句后 duration < min_seg_sec 的段合并到下一段
"""

from __future__ import annotations

import re
import logging
from .models import Word, TranscribedSegment

logger = logging.getLogger(__name__)

# 末尾是强断句符的 pattern（word 本身或 word 末尾带标点）
_STRONG_BREAK = re.compile(r'[.!?…]+$')
# 末尾是弱断句符
_SOFT_BREAK = re.compile(r'[,;:]+$')


class SentenceSplitter:
    """
    把 Word 列表重组为 TranscribedSegment 列表。
    本类不依赖任何外部 I/O，纯内存计算，方便单元测试。
    """

    def __init__(
        self,
        max_seg_sec: float = 12.0,    # 单段最长时间，超过后强制断句
        soft_break_sec: float = 6.0,  # 弱标点触发断句的最短时长
        min_seg_sec: float = 0.5,     # 段太短则合并到下一段
    ) -> None:
        self.max_seg_sec = max_seg_sec
        self.soft_break_sec = soft_break_sec
        self.min_seg_sec = min_seg_sec

    def split(self, words: list[Word]) -> list[TranscribedSegment]:
        """
        Args:
            words: faster-whisper word_timestamps 产出的 Word 列表，已按时间排序。

        Returns:
            TranscribedSegment 列表，保证每段都是完整句子。
        """
        if not words:
            return []

        # ── Step 1: 按规则切 word 列表为若干组 ─────────────────────────────
        groups: list[list[Word]] = []
        current: list[Word] = []

        for word in words:
            current.append(word)
            text = word.word.strip()

            seg_duration = current[-1].end - current[0].start

            if _STRONG_BREAK.search(text):
                # 强断句：直接切
                groups.append(current)
                current = []

            elif _SOFT_BREAK.search(text) and seg_duration >= self.soft_break_sec:
                # 弱断句：时长够长才切
                groups.append(current)
                current = []

            elif seg_duration >= self.max_seg_sec:
                # 兜底：超过最长时长，强制在当前 word 后断
                groups.append(current)
                current = []

        # 剩余 words 不足一句，作为最后一段
        if current:
            groups.append(current)

        # ── Step 2: 合并过短的段 ─────────────────────────────────────────────
        groups = self._merge_short(groups)

        # ── Step 3: 转为 TranscribedSegment ──────────────────────────────────
        segments: list[TranscribedSegment] = []
        for i, group in enumerate(groups):
            text = self._join_words(group)
            if not text:
                continue
            segments.append(TranscribedSegment(
                seq=i,
                start_time=round(group[0].start, 3),
                end_time=round(group[-1].end, 3),
                text=text,
                words=group,
            ))

        logger.debug(f"SentenceSplitter: {len(words)} words → {len(segments)} segments")
        return segments

    # ── private helpers ───────────────────────────────────────────────────────

    def _merge_short(self, groups: list[list[Word]]) -> list[list[Word]]:
        """把时长 < min_seg_sec 的段合并到下一段（最后一段合并到上一段）。"""
        if len(groups) <= 1:
            return groups

        merged: list[list[Word]] = []
        i = 0
        while i < len(groups):
            group = groups[i]
            duration = group[-1].end - group[0].start
            if duration < self.min_seg_sec and i + 1 < len(groups):
                # 合并到下一段
                groups[i + 1] = group + groups[i + 1]
            elif duration < self.min_seg_sec and merged:
                # 最后一段太短，合并到上一段
                merged[-1] = merged[-1] + group
            else:
                merged.append(group)
            i += 1

        return merged

    @staticmethod
    def _join_words(words: list[Word]) -> str:
        """
        拼接 word 列表为句子文本。
        faster-whisper 的 word 已经带有前置空格（如 " Hello"），
        直接 join 再 strip 即可。
        """
        return "".join(w.word for w in words).strip()

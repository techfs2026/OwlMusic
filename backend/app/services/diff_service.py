"""
Word-level diff between reference (subtitle) and hypothesis (user input).
Uses LCS (Longest Common Subsequence) for accurate word alignment.

Rules:
- Case-insensitive comparison
- Punctuation stripped before comparison
- Returns token list with status: correct / wrong / missing
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class DiffToken:
    word: str                              # display word (original case)
    status: str                            # "correct" | "wrong" | "missing"


def _normalize(text: str) -> list[str]:
    """Lowercase and strip punctuation, return word list."""
    text = text.lower()
    text = re.sub(r"[^\w\s']", "", text)  # keep apostrophes
    return text.split()


def _lcs_matrix(a: list[str], b: list[str]) -> list[list[int]]:
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp


def word_diff(reference: str, hypothesis: str) -> list[DiffToken]:
    """
    Compare user input (hypothesis) against the correct subtitle (reference).

    Args:
        reference:  correct subtitle text
        hypothesis: user's typed input

    Returns:
        List of DiffToken. Status:
          correct  — word matched
          wrong    — extra word typed by user (not in reference)
          missing  — word in reference not typed by user
    """
    ref_words  = _normalize(reference)
    hyp_words  = _normalize(hypothesis)

    # original words for display (preserve original reference casing)
    ref_orig = reference.split()
    hyp_orig = hypothesis.split()

    dp = _lcs_matrix(ref_words, hyp_words)

    # backtrack to get aligned pairs
    tokens: list[DiffToken] = []
    i, j = len(ref_words), len(hyp_words)

    while i > 0 or j > 0:
        if i > 0 and j > 0 and ref_words[i - 1] == hyp_words[j - 1]:
            # match
            tokens.append(DiffToken(word=ref_orig[i - 1], status="correct"))
            i -= 1; j -= 1
        elif j > 0 and (i == 0 or dp[i][j - 1] >= dp[i - 1][j]):
            # extra word in hypothesis
            tokens.append(DiffToken(word=hyp_orig[j - 1], status="wrong"))
            j -= 1
        else:
            # missing word from reference
            tokens.append(DiffToken(word=ref_orig[i - 1], status="missing"))
            i -= 1

    tokens.reverse()
    return tokens


def score(tokens: list[DiffToken]) -> float:
    """Return accuracy score 0.0–1.0 based on correct / total reference words."""
    if not tokens:
        return 0.0
    correct = sum(1 for t in tokens if t.status == "correct")
    total   = sum(1 for t in tokens if t.status in ("correct", "missing"))
    return round(correct / total, 4) if total > 0 else 0.0


def is_correct(tokens: list[DiffToken], threshold: float = 1.0) -> bool:
    return score(tokens) >= threshold
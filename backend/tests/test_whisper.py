"""
Standalone CLI test for the whisper transcription module.
No pytest, no FastAPI — run directly.

Usage (from backend/ directory):
    python -m tests.test_whisper <audio_file> [language]

Examples:
    python -m tests.test_whisper test.mp3
    python -m tests.test_whisper lecture.flac en
    python -m tests.test_whisper podcast.wav zh
"""

from __future__ import annotations

import sys
import os
import logging
import subprocess
import tempfile
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from app.services.whisper import WhisperTranscriber, TranscribedSegment


def convert_to_wav(src: str, dst: str) -> None:
    cmd = [
        "ffmpeg", "-y", "-i", src,
        "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le",
        dst,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error:\n{result.stderr}")


def progress_callback(current: int, total: int, message: str) -> None:
    if total == 0:
        return
    pct = int(100 * current / total)
    bar = "█" * (pct // 3) + "░" * (34 - pct // 3)
    print(f"\r  [{bar}] {pct:3d}%  {message:<40}", end="", flush=True)
    if current == total:
        print()


def print_segments(segments: list[TranscribedSegment]) -> None:
    print(f"\n{'─' * 72}")
    print(f"  Total: {len(segments)} segments\n")
    for seg in segments:
        marker = "⚠ " if seg.duration() > 15 else "  "
        print(
            f"{marker}[{seg.start_time:7.3f} → {seg.end_time:7.3f}]"
            f"  ({seg.duration():.2f}s)  {seg.text}"
        )
    print(f"{'─' * 72}")


def quality_report(segments: list[TranscribedSegment]) -> None:
    long_segs  = [s for s in segments if s.duration() > 15]
    short_segs = [s for s in segments if s.duration() < 0.5]
    print(f"\n  Quality report:")
    print(f"    Segments > 15s : {len(long_segs)}")
    print(f"    Segments < 0.5s: {len(short_segs)}")
    if long_segs:
        print("    ⚠  Long segments (check manually):")
        for s in long_segs:
            print(f"       [{s.start_time:.3f}-{s.end_time:.3f}] {s.text[:70]}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    audio_path = sys.argv[1]
    language   = sys.argv[2] if len(sys.argv) > 2 else "en"

    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}")
        sys.exit(1)

    print(f"\n{'═' * 72}")
    print(f"  LangListen — Whisper module test")
    print(f"  File    : {audio_path}")
    print(f"  Language: {language}")
    print(f"{'═' * 72}\n")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name

    try:
        print("[1/3] Converting to 16kHz mono WAV via ffmpeg...")
        t0 = time.time()
        convert_to_wav(audio_path, wav_path)
        print(f"      Done ({time.time() - t0:.1f}s)\n")

        print("[2/3] Initializing transcriber (downloads model on first run)...")
        transcriber = WhisperTranscriber(
            model_size="medium",
            device="cpu",
            compute_type="int8",
        )

        print("[3/3] Transcribing...\n")
        t1 = time.time()
        segments = transcriber.transcribe(
            wav_path,
            language=language,
            on_progress=progress_callback,
        )
        print(f"\n      Elapsed: {time.time() - t1:.1f}s")

        print_segments(segments)
        quality_report(segments)

    finally:
        os.unlink(wav_path)


if __name__ == "__main__":
    main()
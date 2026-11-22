"""Generate a test WAV for Playwright's --use-file-for-fake-audio-capture.

Creates frontend/tests/test-speech.wav: 60 seconds of a 440Hz sine wave at
48kHz mono, amplitude 0.7. RMS is about 0.5, far above watchSpeaking's
START threshold of 0.02, so the speaking indicator fires reliably in tests.

Run once before the browser test suite:
    python frontend/tests/make_test_audio.py
"""
import math
import struct
import sys
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parent / "test-speech.wav"
DURATION_SEC = 60
SAMPLE_RATE = 48000
FREQUENCY = 440
AMPLITUDE = 0.7  # 0.0 to 1.0; RMS = AMPLITUDE / sqrt(2) ≈ 0.495


def main() -> int:
    if OUT.exists():
        size_kb = OUT.stat().st_size // 1024
        print(f"Already exists: {OUT} ({size_kb} KB)")
        return 0

    total = DURATION_SEC * SAMPLE_RATE
    frames = bytearray()
    for i in range(total):
        t = i / SAMPLE_RATE
        # Soft 3Hz envelope adds syllable-like variation without dropping RMS below 0.02.
        env = 0.85 + 0.15 * math.sin(2 * math.pi * 3 * t)
        sample = int(32767 * AMPLITUDE * env * math.sin(2 * math.pi * FREQUENCY * t))
        frames.extend(struct.pack("<h", sample))

    with wave.open(str(OUT), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(frames))

    size_kb = OUT.stat().st_size // 1024
    print(f"Wrote {OUT} ({size_kb} KB, {DURATION_SEC}s, 440Hz, RMS≈0.5)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
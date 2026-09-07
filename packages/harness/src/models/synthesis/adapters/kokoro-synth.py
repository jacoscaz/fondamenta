#!/usr/bin/env python3
"""
Sage's voice — full production script (Kokoro + the designed chain).

Implements the Final Recipe (Note #2355, 2026-09-07):
  Kokoro-82M v1.0, voice bm_fable, en-us, 24kHz
  → 10-stage ffmpeg DSP chain → libopus 48kHz mono 48kbps OGG.

Usage: python3 synth.py "<text>" <output.ogg> [voice] [speed]
The output file is the FINAL voice — no further processing by callers.
Exit code 0 on success; duration is printed to stdout as seconds.
"""
import sys
import json
import subprocess
import tempfile
import os
import wave

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from kokoro_onnx.config import EspeakConfig

ESPEAK = "/usr/lib/x86_64-linux-gnu/espeak-ng-data"
MODEL = "/work/models/kokoro-v1.0.onnx"
VOICES = "/work/models/voices-v1.0.bin"
SAMPLE_RATE = 24000
DEFAULT_VOICE = "bm_fable"

# The Final Recipe chain, verbatim from Note #2355 (order is load-bearing):
# 1. pitch drop with tempo compensation
# 2. the designed pulse (pattern-not-person)
# 3. chest/gravitas, walls removed
# 4. presence
# 5. character band (room-proof: signature lives where rooms preserve)
# 6. air, support only
# 7. ceiling
# 8. in-front position
# 9. the designed tail
# 10. cohesion
# NOTE on the equalizer width syntax: the recipe note (Note #2355) recorded
# the EQ entries as "w=o:1.2" — a shorthand that is INVALID ffmpeg syntax
# ('o' is a width_type value, not a width). Interpreted as width_type=o
# (octave), width=1.2. Pending perceptual A/B verification against the
# first-words render; see design note #2269. If the A/B disagrees, this is
# the parameter to revisit — the chain is otherwise verbatim from the recipe.
FILTER_CHAIN = (
    "asetrate=24000*0.93,aresample=24000,atempo=1.06,"
    "apulsator=hz=0.42:mode=sine:width=0.82,"
    "highpass=f=65,bass=g=8:f=160,"
    "equalizer=f=1200:width_type=o:w=1.2:g=5,"
    "equalizer=f=2400:width_type=o:w=1.5:g=7,"
    "equalizer=f=3600:width_type=o:w=1.5:g=5,"
    "lowpass=f=7500,"
    "adelay=1|1,"
    "aecho=0.85:0.55:40:0.45,"
    "acompressor=threshold=-18dB:ratio=4:makeup=2.5"
)


def wav_duration(path: str) -> float:
    with wave.open(path, 'rb') as w:
        return w.getnframes() / w.getframerate()


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: synth.py <text> <output.ogg> [voice] [speed]"}))
        return 2
    text = sys.argv[1]
    out_path = sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_VOICE
    speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0

    k = Kokoro(MODEL, VOICES, espeak_config=EspeakConfig(ESPEAK))
    samples, sr = k.create(text, voice=voice, speed=speed, lang="en-us")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        raw_wav = tmp.name
    sf.write(raw_wav, samples, sr)

    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", raw_wav,
             "-af", FILTER_CHAIN,
             "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-ac", "1",
             out_path],
            check=True,
        )
    finally:
        os.unlink(raw_wav)

    # Duration of the FINAL processed audio, probed from the opus file.
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", out_path],
        check=True, capture_output=True, text=True,
    )
    duration = float(probe.stdout.strip())
    print(json.dumps({"path": out_path, "duration": duration, "voice": voice}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Narrate every recorded chapter offline with Kokoro and save a word clock.

Run in the TTS venv:  .venv-tts/bin/python scripts/render_audio.py
Writes demo/out/audio/<slug>.wav and <slug>.words.json
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import soundfile as sf  # noqa: E402

from nightjar import kokoro_voice  # noqa: E402

out = ROOT / "demo" / "out" / "audio"
out.mkdir(parents=True, exist_ok=True)
for path in sorted((ROOT / "demo" / "out" / "stories").glob("*.json")):
    d = json.loads(path.read_text())
    t0 = time.time()
    n = kokoro_voice.render(d["text"], d["knobs"]["pace_wpm"])
    sf.write(out / f"{path.stem}.wav", n.audio, kokoro_voice.SAMPLE_RATE)
    timed = sum(1 for s, e in n.words if e > s)
    (out / f"{path.stem}.words.json").write_text(
        json.dumps(
            {
                "voice": f"Kokoro-82M {kokoro_voice.VOICE}",
                "speed": kokoro_voice.SPEED,
                "duration": round(n.duration, 3),
                "speech_wpm": round(n.speech_wpm, 1),
                "overall_wpm": round(n.overall_wpm, 1),
                "words": [[round(s, 3), round(e, 3)] for s, e in n.words],
            }
        )
    )
    print(
        f"{path.stem}: {n.duration:.1f}s, {len(n.words)} words ({timed} timed), speech {n.speech_wpm:.0f} wpm, overall {n.overall_wpm:.0f} wpm, render {time.time() - t0:.0f}s"
    )

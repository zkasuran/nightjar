# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Narration.

ElevenLabs when a key and a consented voice ID are present; otherwise the
story is written out as text and the CLI says so. There is no silent fallback
to a stranger's voice. No voice is cloned here without the speaker's
recorded consent (see CONSENT.md).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from .config import OUT_DIR, SETTINGS

ELEVEN_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"


class NarrationUnavailable(RuntimeError):
    pass


def available() -> str:
    if SETTINGS.elevenlabs_key:
        return "elevenlabs"
    if shutil.which("piper"):
        return "piper-local"
    if shutil.which("espeak-ng"):
        return "espeak-local"
    return "none"


def narrate(text: str, voice_id: str | None, slug: str, pace_wpm: int = 110) -> Path:
    """Render narration audio. Raises NarrationUnavailable if no backend."""
    out_dir = OUT_DIR / "audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    backend = available()

    if backend == "elevenlabs":
        if not voice_id:
            raise NarrationUnavailable("ELEVENLABS_API_KEY is set but no narrator_voice_id in child.json")
        return _elevenlabs(text, voice_id, out_dir / f"{slug}.mp3", pace_wpm)
    if backend in ("piper-local", "espeak-local"):
        return _local(text, out_dir / f"{slug}.wav", backend, pace_wpm)
    raise NarrationUnavailable("no narration backend: set ELEVENLABS_API_KEY or install piper/espeak-ng for fully-offline speech")


def _elevenlabs(text: str, voice_id: str, out: Path, pace_wpm: int) -> Path:
    # Slower pace is one of the knobs the sleep model tunes, so map wpm onto
    # the model's speed parameter around a 110wpm baseline.
    speed = max(0.7, min(1.2, pace_wpm / 110))
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.6, "similarity_boost": 0.8, "speed": speed},
    }
    req = urllib.request.Request(
        ELEVEN_URL.format(voice_id=voice_id),
        data=json.dumps(payload).encode(),
        headers={
            "xi-api-key": SETTINGS.elevenlabs_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            out.write_bytes(resp.read())
    except urllib.error.HTTPError as exc:
        raise NarrationUnavailable(f"ElevenLabs {exc.code}: {exc.read()[:200]!r}") from exc
    return out


def _local(text: str, out: Path, backend: str, pace_wpm: int) -> Path:
    if backend == "espeak-local":
        cmd = ["espeak-ng", "-s", str(pace_wpm), "-w", str(out), text]
    else:
        cmd = ["piper", "--output_file", str(out)]
    proc = subprocess.run(cmd, input=text.encode() if backend == "piper-local" else None, capture_output=True)
    if proc.returncode != 0:
        raise NarrationUnavailable(proc.stderr.decode()[:200])
    return out


def play(path: Path) -> bool:
    for player in ("paplay", "aplay", "ffplay"):
        exe = shutil.which(player)
        if not exe:
            continue
        args = [exe, str(path)]
        if player == "ffplay":
            args = [exe, "-nodisp", "-autoexit", "-loglevel", "quiet", str(path)]
        return subprocess.run(args, capture_output=True).returncode == 0
    return False

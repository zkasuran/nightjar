# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Configuration and on-disk layout for Nightjar.

Everything is file-based and local by design: the whole point of the project is
that a child's name, fears and sleep patterns never leave the house.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from .limits import MAX_AVOID_TERMS, MAX_FILE_BYTES, MAX_TERM_CHARS

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("NIGHTJAR_DATA", PROJECT_ROOT / "data"))
OUT_DIR = Path(os.environ.get("NIGHTJAR_OUT", PROJECT_ROOT / "out"))

CHILD_FILE = DATA_DIR / "child.json"
BIBLE_FILE = DATA_DIR / "bible.json"
SLEEP_LOG = DATA_DIR / "bedtime_log.csv"


@dataclass
class Child:
    """The one real person this is built for."""

    name: str
    age: int
    reading_grade: float
    loves: list[str] = field(default_factory=list)
    # Hard avoid list. These are fed to the deterministic guardrail, not just
    # to the prompt, because a prompt is a request and a guardrail is a rule.
    avoid: list[str] = field(default_factory=list)
    narrator_name: str = "Dad"
    narrator_voice_id: str | None = None
    bedtime_hour: int = 19

    @classmethod
    def load(cls, path: Path = CHILD_FILE) -> Child:
        """Parse and validate the profile. A parent edits this by hand, so a
        typo must produce a clear message, never a traceback."""
        raw = read_json(path)
        if not isinstance(raw, dict):
            raise ValueError(f"{path.name}: expected a JSON object")
        name = raw.get("name")
        age = raw.get("age")
        if not isinstance(name, str) or not name.strip() or len(name) > 60:
            raise ValueError(f"{path.name}: 'name' must be a short non-empty string")
        if not isinstance(age, int) or isinstance(age, bool) or not 1 <= age <= 12:
            raise ValueError(f"{path.name}: 'age' must be a whole number from 1 to 12")

        def strings(key: str) -> list[str]:
            value = raw.get(key, [])
            if not isinstance(value, list):
                raise ValueError(f"{path.name}: '{key}' must be a list of strings")
            return [str(v)[:MAX_TERM_CHARS] for v in value[:MAX_AVOID_TERMS] if isinstance(v, str)]

        hour = raw.get("bedtime_hour", 19)
        voice = raw.get("narrator_voice_id")
        grade = raw.get("reading_grade", 1.0)
        return cls(
            name=name.strip(),
            age=age,
            reading_grade=float(grade) if isinstance(grade, (int, float)) else 1.0,
            loves=strings("loves"),
            avoid=strings("avoid"),
            narrator_name=str(raw.get("narrator_name", "Dad"))[:40],
            narrator_voice_id=voice if isinstance(voice, str) and voice.isalnum() else None,
            bedtime_hour=hour if isinstance(hour, int) and 0 <= hour <= 23 else 19,
        )


def read_json(path: Path) -> object:
    """Bounded JSON read for every hand edited file."""
    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise ValueError(f"{path.name}: {size} bytes is over the {MAX_FILE_BYTES} byte ceiling")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"{path.name}: not valid JSON ({exc})") from exc


@dataclass
class Settings:
    """Runtime knobs, all overridable by environment variable."""

    ollama_host: str = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
    # gemma3:1b is the CPU-friendly default. Bump to gemma3:4b when a GPU exists.
    model: str = os.environ.get("NIGHTJAR_MODEL", "gemma3:1b")
    embed_model: str = os.environ.get("NIGHTJAR_EMBED_MODEL", "")
    elevenlabs_key: str = os.environ.get("ELEVENLABS_API_KEY", "")
    # How many times to regenerate when the guardrail rejects a draft.
    guard_retries: int = int(os.environ.get("NIGHTJAR_GUARD_RETRIES", "3"))
    request_timeout: int = int(os.environ.get("NIGHTJAR_TIMEOUT", "600"))


SETTINGS = Settings()


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "stories").mkdir(exist_ok=True)
    (OUT_DIR / "audio").mkdir(exist_ok=True)

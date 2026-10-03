# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Feature extraction for the sleep-latency model.

Every night produces one row. These are the columns TabPFN learns from, so they
have to be things the system can actually control tomorrow (knobs) or observe
reliably (text statistics).
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

WORD_RE = re.compile(r"[A-Za-z']+")
SENT_RE = re.compile(r"[.!?]+")
VOWEL_GROUPS = re.compile(r"[aeiouy]+")


def count_syllables(word: str) -> int:
    """Heuristic syllable counter. Not linguistically perfect, but stable and
    dependency-free, which matters more for a feature column than accuracy."""
    word = word.lower().strip("'")
    if not word:
        return 0
    groups = VOWEL_GROUPS.findall(word)
    count = len(groups)
    if word.endswith("e") and count > 1 and not word.endswith(("le", "ee", "ye")):
        count -= 1
    return max(1, count)


def flesch_kincaid_grade(text: str) -> float:
    words = WORD_RE.findall(text)
    sentences = [s for s in SENT_RE.split(text) if s.strip()]
    if not words or not sentences:
        return 0.0
    syllables = sum(count_syllables(w) for w in words)
    return round(
        0.39 * (len(words) / len(sentences)) + 11.8 * (syllables / len(words)) - 15.59,
        2,
    )


@dataclass
class NightFeatures:
    """One row of the bedtime log."""

    word_count: int
    sentence_count: int
    avg_sentence_len: float
    fk_grade: float
    pace_wpm: int
    calm_level: int
    is_sequel: int
    cast_size: int
    bedtime_hour: int
    narration_seconds: int

    def as_row(self) -> dict:
        return asdict(self)


def extract(
    text: str,
    pace_wpm: int,
    calm_level: int,
    is_sequel: bool,
    cast_size: int,
    bedtime_hour: int,
) -> NightFeatures:
    words = WORD_RE.findall(text)
    sentences = [s for s in SENT_RE.split(text) if s.strip()]
    sentence_count = max(1, len(sentences))
    return NightFeatures(
        word_count=len(words),
        sentence_count=sentence_count,
        avg_sentence_len=round(len(words) / sentence_count, 2),
        fk_grade=flesch_kincaid_grade(text),
        pace_wpm=pace_wpm,
        calm_level=calm_level,
        is_sequel=int(is_sequel),
        cast_size=cast_size,
        bedtime_hour=bedtime_hour,
        narration_seconds=int(len(words) / max(1, pace_wpm) * 60),
    )


FEATURE_COLUMNS = [
    "word_count",
    "sentence_count",
    "avg_sentence_len",
    "fk_grade",
    "pace_wpm",
    "calm_level",
    "is_sequel",
    "cast_size",
    "bedtime_hour",
    "narration_seconds",
]
TARGET_COLUMN = "minutes_to_asleep"

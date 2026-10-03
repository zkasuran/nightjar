# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Offline narration with Kokoro-82M (Apache-2.0), plus a word clock.

Optional: needs `pip install kokoro==0.9.4 soundfile==0.13.1` in its own venv
(it pins a different huggingface-hub than TabPFN). Nothing leaves the laptop.

The output is not just audio. It is one (start, end) pair per whitespace
separated word of the chapter text, so a reader can highlight the word being
spoken and stay in step through pause, resume and seek. That clock is the
reason this exists: the browser's own speech engine reports word boundaries
unreliably and restarts from the top after a pause.

Pacing: Kokoro sounds strained below about 0.8x speed, so the slow bedtime
pace comes from longer pauses between sentences, not from slowing the voice.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

SAMPLE_RATE = 24_000
VOICE = "af_heart"
SPEED = 0.85
MIN_GAP_S = 0.35
MAX_GAP_S = 1.6
LEAD_IN_S = 0.3

SENT_RE = re.compile(r"[^.!?\n]+[.!?]*[\"'\u2019\u201d)]*|\n+")
WORD_RE = re.compile(r"\S+")
LETTERS = re.compile(r"[^a-z0-9]+")


def _norm(s: str) -> str:
    return LETTERS.sub("", s.lower().replace("\u2019", "'"))


@dataclass
class Narration:
    audio: object  # numpy float32 array, mono, SAMPLE_RATE
    words: list[tuple[float, float]]  # one pair per WORD_RE match in the text
    duration: float
    speech_wpm: float  # words per minute counting only the voice
    overall_wpm: float  # including the pauses between sentences


def sentences(text: str) -> list[tuple[str, int]]:
    """(sentence, index of its first word in the whole text)."""
    out, w = [], 0
    for m in SENT_RE.finditer(text):
        chunk = m.group(0)
        n = len(WORD_RE.findall(chunk))
        if n:
            out.append((chunk.strip(), w))
            w += n
    return out


def align(ours: list[str], theirs: list[tuple[str, float, float]]) -> list[tuple[float, float] | None]:
    """Map Kokoro's tokens (punctuation split off, occasionally merged) onto our
    whitespace words by walking both letter streams in order. Words it cannot
    place stay None and are interpolated by fill()."""
    res: list[tuple[float, float] | None] = [None] * len(ours)
    their = [[_norm(t), s, e] for t, s, e in theirs if _norm(t) and s is not None and e is not None]
    j = 0
    for i, word in enumerate(ours):
        target = _norm(word)
        if not target:
            continue
        for skip in range(3):  # resync window if Kokoro inserted something
            k = j + skip
            got, s0, e0 = "", None, None
            while k < len(their) and len(got) < len(target) and target.startswith(got + their[k][0]):
                got += their[k][0]
                s0 = their[k][1] if s0 is None else s0
                e0 = their[k][2]
                k += 1
            if got == target:
                res[i] = (s0, e0)
                j = k
                break
            if k < len(their) and not got and their[k][0].startswith(target):
                # one Kokoro token spans this word and the next: split it evenly
                t, ts, te = their[k]
                mid = ts + (te - ts) * len(target) / len(t)
                res[i] = (ts, mid)
                their[k] = [t[len(target) :], mid, te]
                j = k
                break
    return res


def fill(spans: list[tuple[float, float] | None], lo: float, hi: float) -> list[tuple[float, float]]:
    """Interpolate any word Kokoro did not time, inside [lo, hi]."""
    out = list(spans)
    n = len(out)
    i = 0
    while i < n:
        if out[i] is not None:
            i += 1
            continue
        j = i
        while j < n and out[j] is None:
            j += 1
        a = out[i - 1][1] if i > 0 and out[i - 1] else lo
        b = out[j][0] if j < n and out[j] else hi
        step = max(0.0, b - a) / (j - i)
        for k in range(i, j):
            out[k] = (a + step * (k - i), a + step * (k - i + 1))
        i = j
    return [(float(s), float(e)) for s, e in out]  # type: ignore[misc]


def render(text: str, pace_wpm: int) -> Narration:
    import numpy as np
    from kokoro import KPipeline

    pipe = _pipeline(KPipeline)
    parts = sentences(text)
    total_words = len(WORD_RE.findall(text))
    clips = []
    for sent, _ in parts:
        audio, toks = [], []
        offset = 0.0
        for r in pipe(sent, voice=VOICE, speed=SPEED):
            a = r.audio.numpy().astype("float32")
            for tk in r.tokens or []:
                if tk.start_ts is not None:
                    toks.append((tk.text, tk.start_ts + offset, tk.end_ts + offset))
            audio.append(a)
            offset += len(a) / SAMPLE_RATE
        clips.append((np.concatenate(audio) if audio else np.zeros(1, "float32"), toks))

    speech = sum(len(c) for c, _ in clips) / SAMPLE_RATE
    target = total_words / max(1, pace_wpm) * 60
    gap = min(MAX_GAP_S, max(MIN_GAP_S, (target - speech) / max(1, len(clips))))
    silence = np.zeros(int(gap * SAMPLE_RATE), "float32")

    pieces = [np.zeros(int(LEAD_IN_S * SAMPLE_RATE), "float32")]
    t = LEAD_IN_S
    words: list[tuple[float, float]] = []
    for (sent, _), (clip, toks) in zip(parts, clips, strict=True):
        ours = WORD_RE.findall(sent)
        dur = len(clip) / SAMPLE_RATE
        spans = fill(align(ours, toks), 0.0, dur)
        words.extend((t + s, t + e) for s, e in spans)
        pieces += [clip, silence]
        t += dur + gap

    audio = np.concatenate(pieces)
    peak = float(np.abs(audio).max() or 1.0)
    audio = (audio * min(1.0, 0.89 / peak)).astype("float32")  # headroom, no clipping
    duration = len(audio) / SAMPLE_RATE
    assert len(words) == total_words, (len(words), total_words)
    return Narration(audio, words, duration, total_words / speech * 60, total_words / duration * 60)


_PIPE = None


def _pipeline(cls):
    global _PIPE
    if _PIPE is None:
        _PIPE = cls(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    return _PIPE

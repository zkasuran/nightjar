# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Story generation: the core loop.

Flow: knobs + series bible -> local Gemma -> deterministic guardrail -> accept
or regenerate. Nothing is read to a child until the guardrail has signed off.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from . import features, guard, llm
from .bible import Bible, Chapter
from .config import OUT_DIR, SETTINGS, Child
from .limits import MAX_TITLE_CHARS

SYSTEM = (
    "You are a gentle bedtime storyteller for one small child. "
    "You write calm, warm, slightly dull stories designed to help a child fall "
    "asleep. Nothing frightening ever happens. There is no danger, no villain, "
    "no peril and no loud noise. Problems are small and are solved kindly. "
    "The story ends with everyone safe, warm and already sleepy. "
    "Write simple short sentences a young child can follow. "
    "Never mention that you are an AI and never address the reader."
)


class GuardRefused(RuntimeError):
    """Every draft tonight failed the guardrail. Nothing new is read aloud.

    Carries the redacted drafts so the refusal is auditable, not silent."""

    def __init__(self, night: str, request: str, drafts: list[dict]):
        self.night = night
        self.request = request
        self.drafts = drafts
        super().__init__(f"guardrail rejected all {len(drafts)} drafts: {[d['violations'] for d in drafts]}")

    def save(self, directory: Path | None = None) -> Path:
        directory = directory or (OUT_DIR / "refusals")
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{self.night}.json"
        path.write_text(json.dumps({"night": self.night, "request": self.request, "drafts": self.drafts}, indent=2))
        return path


@dataclass
class Knobs:
    """The parameters the sleep model gets to choose from."""

    target_words: int = 320
    pace_wpm: int = 110
    calm_level: int = 4  # 1 = eventful, 5 = almost nothing happens
    cast: list[str] = field(default_factory=list)
    is_sequel: bool = True

    def describe(self) -> str:
        return (
            f"words≈{self.target_words} pace={self.pace_wpm}wpm "
            f"calm={self.calm_level}/5 sequel={'yes' if self.is_sequel else 'no'} "
            f"cast={', '.join(self.cast) or 'storyteller picks'}"
        )


@dataclass
class Story:
    title: str
    text: str
    night: str
    knobs: Knobs
    attempts: int
    rejected: list[list[str]] = field(default_factory=list)
    # Redacted copies of every draft the guardrail refused, for the audit trail.
    rejected_drafts: list[dict] = field(default_factory=list)
    gen_ms: int = 0
    eval_tokens: int = 0

    @property
    def slug(self) -> str:
        base = re.sub(r"[^a-z0-9]+", "-", self.title.lower()).strip("-")
        return f"{self.night}-{base or 'chapter'}"

    def save(self, directory: Path | None = None) -> Path:
        directory = directory or (OUT_DIR / "stories")
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{self.slug}.json"
        path.write_text(
            json.dumps(
                {
                    "title": self.title,
                    "text": self.text,
                    "night": self.night,
                    "knobs": self.knobs.__dict__,
                    "attempts": self.attempts,
                    "rejected": self.rejected,
                    "rejected_drafts": self.rejected_drafts,
                    "gen_ms": self.gen_ms,
                    "eval_tokens": self.eval_tokens,
                },
                indent=2,
            )
        )
        return path


def _build_prompt(child: Child, knobs: Knobs, bible: Bible, request: str) -> str:
    query = f"{request} {' '.join(knobs.cast)}"
    history = bible.context_block(query) if knobs.is_sequel else ""
    calm_hint = {
        1: "a little gentle adventure is fine",
        2: "keep it mostly quiet",
        3: "quiet, with one small discovery",
        4: "very quiet; almost nothing happens",
        5: "almost nothing happens at all; it is mostly describing soft things",
    }[knobs.calm_level]

    parts = [
        f"Tonight you are writing for {child.name}, who is {child.age} years old.",
        f"{child.name} loves: {', '.join(child.loves)}." if child.loves else "",
        f"{child.name} is the hero of the story and makes the decisions.",
        "",
        f"What {child.name} asked for tonight: {request}" if request else "",
        "",
        history,
        "",
        "RULES FOR TONIGHT:",
        f"- About {knobs.target_words} words. Not longer.",
        f"- Tone: {calm_hint}.",
        f"- Reading level: a {child.age}-year-old. Short sentences.",
        f"- Characters to include: {', '.join(knobs.cast)}." if knobs.cast else "",
        "- End with everyone safe and asleep.",
        "",
        "Reply with JSON only, exactly this shape:",
        '{"title": "...", "text": "...", "summary": "...", "cast": ["..."], "open_thread": "..."}',
        "`text` is the story. `summary` is one sentence for tomorrow's storyteller. `open_thread` is one small thing left for next time.",
    ]
    return "\n".join(p for p in parts if p != "")


_FENCE_RE = re.compile(r"^\s*```[a-zA-Z]*\s*|\s*```\s*$")
_FIELD_RE = {
    "title": re.compile(r'\\?"title\\?"\s*:\s*\\?"(.*?)\\?"\s*,', re.DOTALL),
    "text": re.compile(r'\\?"text\\?"\s*:\s*\\?"(.*?)\\?"\s*,\s*\\?"(?:summary|cast|open_thread)', re.DOTALL),
    "summary": re.compile(r'\\?"summary\\?"\s*:\s*\\?"(.*?)\\?"', re.DOTALL),
    "open_thread": re.compile(r'\\?"open_thread\\?"\s*:\s*\\?"(.*?)\\?"', re.DOTALL),
}


def _strip_fences(raw: str) -> str:
    lines = [ln for ln in raw.splitlines() if not ln.strip().startswith("```")]
    return _FENCE_RE.sub("", "\n".join(lines)).strip()


def _repair_fields(raw: str) -> dict | None:
    """Recover title/text when the model emits almost-JSON.

    gemma3:1b will happily produce `{"text": "...", \\"summary\\": "..."}` with
    escaped quotes halfway through, which json.loads refuses. Rather than read
    raw JSON aloud to a child, pull the fields out by hand.
    """
    title = _FIELD_RE["title"].search(raw)
    text = _FIELD_RE["text"].search(raw)
    if not text:
        return None
    body = text.group(1).replace("\\n", "\n").replace('\\"', '"').strip()
    if not body:
        return None
    summary = _FIELD_RE["summary"].search(raw)
    thread = _FIELD_RE["open_thread"].search(raw)
    return {
        "title": (title.group(1).strip()[:MAX_TITLE_CHARS] if title else "Tonight's Chapter"),
        "text": body,
        "summary": (summary.group(1).strip() if summary else ""),
        "cast": [],
        "open_thread": (thread.group(1).strip() if thread else ""),
    }


def _clean_title(title: str) -> str:
    """gemma3:1b likes to wrap titles in brackets or quotes: "[Mira's Sleepy Night]"."""
    t = title.strip().strip("[]{}()*#`\"' \u201c\u201d").strip()
    return t[:MAX_TITLE_CHARS] or "Tonight's Chapter"


def _parse(raw: str) -> dict:
    """Small models wander outside JSON; recover what we can."""
    out = _parse_raw(raw)
    out["title"] = _clean_title(out["title"])
    return out


def _parse_raw(raw: str) -> dict:
    raw = _strip_fences(raw)
    parsed = llm.extract_json(raw)
    if parsed and parsed.get("text"):
        return {
            "title": str(parsed.get("title") or "Tonight's Chapter").strip()[:MAX_TITLE_CHARS],
            "text": str(parsed["text"]).strip(),
            "summary": str(parsed.get("summary") or "").strip(),
            "cast": [str(c) for c in parsed.get("cast") or []],
            "open_thread": str(parsed.get("open_thread") or "").strip(),
        }

    repaired = _repair_fields(raw)
    if repaired:
        return repaired

    # Fallback: treat the whole reply as prose, first line as title.
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    title = "Tonight's Chapter"
    if lines and len(lines[0]) < 70 and not lines[0].startswith(("{", '"')):
        title = lines[0].lstrip("#*` ").strip()[:MAX_TITLE_CHARS]
        lines = lines[1:]
    body = "\n".join(lines)
    first_sentence = re.split(r"(?<=[.!?])\s", body)[0] if body else ""
    return {
        "title": title,
        "text": body,
        "summary": first_sentence,
        "cast": [],
        "open_thread": "",
    }


def tonight(
    child: Child,
    knobs: Knobs,
    bible: Bible,
    request: str = "",
    log_night: str | None = None,
) -> Story:
    """Generate and guard tonight's chapter. Raises if every attempt is unsafe."""
    night = log_night or date.today().isoformat()
    prompt = _build_prompt(child, knobs, bible, request)
    rejected: list[list[str]] = []
    drafts: list[dict] = []
    total_ms = 0

    for attempt in range(1, SETTINGS.guard_retries + 1):
        extra = ""
        if rejected:
            extra = (
                "\n\nYour previous attempt was rejected by a safety filter for: "
                + "; ".join(rejected[-1])
                + ". Write a calmer version and avoid those words entirely."
            )
        completion = llm.generate(
            prompt + extra,
            system=SYSTEM,
            temperature=0.8 if attempt == 1 else 0.6,
            num_predict=min(1200, int(knobs.target_words * 2.2)),
        )
        total_ms += completion.duration_ms
        parsed = _parse(completion.text)
        # The title is screened for content but excluded from the length
        # bounds: it is read aloud and printed in the book, but it is not the
        # story. Screening only the body let "Thunder and the Moon's Light"
        # through on an avoid-listed word.
        verdict = guard.check(
            parsed["text"],
            avoid=child.avoid,
            max_words=int(knobs.target_words * 1.8),
            also_screen=parsed["title"],
        )
        if verdict.ok:
            story = Story(
                title=parsed["title"],
                text=parsed["text"],
                night=night,
                knobs=knobs,
                attempts=attempt,
                rejected=rejected,
                rejected_drafts=drafts,
                gen_ms=total_ms,
                eval_tokens=completion.eval_tokens,
            )
            cast = parsed["cast"] or knobs.cast
            bible.add_chapter(
                Chapter(
                    night=night,
                    title=story.title,
                    summary=parsed["summary"] or story.text[:160],
                    cast=cast,
                    open_thread=parsed["open_thread"],
                )
            )
            return story
        rejected.append(verdict.violations)
        drafts.append(
            {
                "attempt": attempt,
                "title": guard.redact(parsed["title"])[:MAX_TITLE_CHARS],
                "text": guard.redact(parsed["text"])[:1200],
                "violations": verdict.violations,
            }
        )

    raise GuardRefused(night, request, drafts)


def night_features(child: Child, story: Story) -> features.NightFeatures:
    return features.extract(
        story.text,
        pace_wpm=story.knobs.pace_wpm,
        calm_level=story.knobs.calm_level,
        is_sequel=story.knobs.is_sequel,
        cast_size=max(1, len(story.knobs.cast)),
        bedtime_hour=child.bedtime_hour,
    )

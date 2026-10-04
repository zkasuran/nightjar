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
    # A 1B model will not write past ~150 words however it is asked, so a long
    # story is written as several parts that continue each other.
    parts: int = 1

    def describe(self) -> str:
        return (
            f"{'long, ' + str(self.parts) + ' parts, ' if self.parts > 1 else ''}"
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
    soften = guard.screen_request(request, child.avoid)
    query = f"{request} {' '.join(knobs.cast)}"
    if request:
        # A 1B model follows whatever dominates the prompt. With a full series
        # history it wrote about the turtle every time she asked for a dragon,
        # so with a request only last night's one line summary goes in.
        last = bible.chapters[-1] if bible.chapters else None
        history = f"Last night: {last.summary}" if last and knobs.is_sequel else ""
    else:
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
        (
            f"{child.name} asked for this tonight, and the story must be about it: {request}. "
            "Characters from earlier nights may visit, but her idea comes first."
        )
        if request
        else "",
        (
            f"Some of that could feel scary ({', '.join(soften)}). Keep the idea but make it friendly, small and gentle, "
            "never frightening. Do not use those words."
        )
        if soften
        else "",
        "",
        history,
        "",
        "RULES FOR TONIGHT:",
        f"- The story is about: {request}." if request else "",
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


_TRAIL_SLASH = re.compile(r"[ \t]*\\+[ \t]*$", re.M)


def _parse(raw: str) -> dict:
    """Small models wander outside JSON; recover what we can."""
    out = _parse_raw(raw)
    out["title"] = _clean_title(out["title"])
    # gemma3:1b sometimes ends every line with a stray backslash (seen in the
    # first long story). They would be printed as junk.
    out["text"] = _TRAIL_SLASH.sub("", out["text"].replace("\\n", "\n"))
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
        "_prose_title": title != "Tonight's Chapter",
    }


LONG_PARTS = 3
PART_WORDS = 150

# For every part but the last. The normal system prompt tells the model the
# story ends with everyone asleep, and it obeyed: in the first long run the
# story ended, said goodnight, then started again in part two.
SYSTEM_MIDDLE = SYSTEM.replace(
    "The story ends with everyone safe, warm and already sleepy.",
    "You are writing only one part of a longer story. Never end it, never say goodnight and never put anyone to sleep yet.",
)

_SENT = re.compile(r"[^.!?\n]+[.!?]?")


def _sentences(text: str) -> set[str]:
    out = set()
    for m in _SENT.finditer(text.lower()):
        words = re.findall(r"[a-z']+", m.group(0))
        if len(words) >= 5:
            out.add(" ".join(words))
    return out


def _continue_prompt(child: Child, knobs: Knobs, request: str, so_far: str, part: int, parts: int) -> str:
    sents = [x.strip() for x in re.split(r"(?<=[.!?])\s+", so_far.strip()) if x.strip()]
    last = sents[-2:]
    # The opening carries the names. Without it the dragon "Sparkle" came back
    # as "Flicker" two parts later.
    opening = sents[:2] if len(sents) > 4 else []
    final = part == parts
    lines = [
        f"You are continuing tonight's bedtime story for {child.name}, who is {child.age} years old.",
        f"The story is about: {request}." if request else "",
        f"The story began like this: {' '.join(opening)}" if opening else "",
        f"The story so far ends like this: {' '.join(last)}",
        "Keep every name exactly the same.",
        "",
        f"Write part {part} of {parts}. Begin with something new that happens next, with the same characters. Never repeat a sentence that was already written.",
        f"- About {PART_WORDS} words. Short sentences. Very quiet and gentle.",
        "- This is the last part. Bring the characters home, warm and safe, and let them drift off."
        if final
        else "- Do not end the story yet. Stop at a calm moment.",
        "",
        # Plain prose: asked for JSON, the 1B model wrapped every continuation
        # in broken JSON and the scaffolding rule refused all of them.
        "Reply with the story text only. No title, no JSON, no notes.",
    ]
    return "\n".join(x for x in lines if x)


def _write_part(
    child: Child,
    prompt: str,
    night: str,
    request: str,
    target: int,
    min_words: int,
    on_attempt,
    label: str,
    system: str = SYSTEM,
    previous: str = "",
):
    """Generate one guarded piece. Returns (parsed, attempts, rejected, drafts, ms, tokens)."""
    rejected: list[list[str]] = []
    drafts: list[dict] = []
    total_ms = 0
    for attempt in range(1, SETTINGS.guard_retries + 1):
        if on_attempt:
            on_attempt(attempt, rejected[-1] if rejected else [], label)
        extra = ""
        if rejected:
            extra = (
                "\n\nYour previous attempt was rejected by a safety filter for: "
                + "; ".join(rejected[-1])
                + ". Write a calmer version and avoid those words entirely."
            )
        completion = llm.generate(
            prompt + extra,
            system=system,
            temperature=0.8 if attempt == 1 else 0.6,
            num_predict=min(1200, int(target * 2.2)),
        )
        total_ms += completion.duration_ms
        parsed = _parse(completion.text)
        # The title is screened for content but excluded from the length
        # bounds: it is read aloud and printed in the book, but it is not the
        # story. Screening only the body let "Thunder and the Moon's Light"
        # through on an avoid-listed word.
        verdict = guard.check(
            parsed["text"], avoid=child.avoid, max_words=int(target * 1.8), min_words=min_words, also_screen=parsed["title"]
        )
        if previous and verdict.ok:
            copied = _sentences(parsed["text"]) & _sentences(previous)
            if copied:
                verdict = guard.Verdict(False, [f"repeats an earlier sentence: {sorted(copied)[0][:60]}"])
        if verdict.ok:
            return parsed, attempt, rejected, drafts, total_ms, completion.eval_tokens
        rejected.append(verdict.violations)
        drafts.append(
            {
                "attempt": attempt,
                "part": label,
                "title": guard.redact(parsed["title"])[:MAX_TITLE_CHARS],
                "text": guard.redact(parsed["text"])[:1200],
                "violations": verdict.violations,
            }
        )
    raise GuardRefused(night, request, drafts)


def tonight(
    child: Child,
    knobs: Knobs,
    bible: Bible,
    request: str = "",
    log_night: str | None = None,
    on_attempt=None,
) -> Story:
    """Generate and guard tonight's chapter. Raises GuardRefused if any part
    is refused on every try: a long story with an unsafe middle is not read."""
    night = log_night or date.today().isoformat()
    parts = max(1, min(5, knobs.parts))

    def hook(n: int, last: list[str], label: str) -> None:
        if on_attempt:
            try:
                on_attempt(n, last, label)
            except TypeError:  # older two argument callbacks
                on_attempt(n, last)

    first_knobs = knobs if parts == 1 else Knobs(**{**knobs.__dict__, "target_words": PART_WORDS})
    prompt = _build_prompt(child, first_knobs, bible, request)
    if parts > 1:
        prompt = prompt.replace(
            "- End with everyone safe and asleep.",
            f"- This is part 1 of {parts} of a longer story. Do not end it yet; stop at a calm moment.",
        )
    parsed, attempts, rejected, drafts, ms, tokens = _write_part(
        child, prompt, night, request, first_knobs.target_words, 60, hook, f"1/{parts}", SYSTEM if parts == 1 else SYSTEM_MIDDLE
    )
    title = parsed["title"]
    texts = [parsed["text"]]
    summary, thread, cast = parsed["summary"], parsed["open_thread"], parsed["cast"]
    all_rejected, all_drafts = list(rejected), list(drafts)
    for part in range(2, parts + 1):
        cp = _continue_prompt(child, knobs, request, "\n".join(texts), part, parts)
        pp, a2, r2, d2, ms2, t2 = _write_part(
            child,
            cp,
            night,
            request,
            PART_WORDS,
            40,
            hook,
            f"{part}/{parts}",
            SYSTEM if part == parts else SYSTEM_MIDDLE,
            "\n".join(texts),
        )
        # A continuation has no title; if the model answered in prose, its first
        # line is story, not a heading.
        texts.append(f"{pp['title']}\n{pp['text']}" if pp.get("_prose_title") else pp["text"])
        attempts += a2
        all_rejected += r2
        all_drafts += d2
        ms += ms2
        tokens += t2
        if part == parts:
            ends = re.split(r"(?<=[.!?])\s+", texts[-1].strip())
            summary = f"{summary} {ends[-1]}".strip()[:400] if ends else summary

    story = Story(
        title=title,
        text="\n\n".join(t.strip() for t in texts),
        night=night,
        knobs=knobs,
        attempts=attempts,
        rejected=all_rejected,
        rejected_drafts=all_drafts,
        gen_ms=ms,
        eval_tokens=tokens,
    )
    bible.add_chapter(
        Chapter(night=night, title=story.title, summary=summary or story.text[:160], cast=cast or knobs.cast, open_thread=thread)
    )
    return story


def night_features(child: Child, story: Story) -> features.NightFeatures:
    return features.extract(
        story.text,
        pace_wpm=story.knobs.pace_wpm,
        calm_level=story.knobs.calm_level,
        is_sequel=story.knobs.is_sequel,
        cast_size=max(1, len(story.knobs.cast)),
        bedtime_hour=child.bedtime_hour,
    )

# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Deterministic content guardrail.

This runs outside the model, on the generated text. A prompt instruction is a
request. This is a rule. Gemma 3 1B sometimes drifts somewhere a little
ominous for a four year old. The only honest answer is a hard allow or
deny pass that cannot be talked out of its decision.

The same rules are ported to TypeScript in web/src/lib/guard.ts and the two are
held to identical verdicts by a shared fixture (tests/test_parity.py and
web/test/parity.test.mjs).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from .limits import MAX_AVOID_TERMS, MAX_TERM_CHARS, MAX_TEXT_CHARS

# Words that end a bedtime story for a preschooler. Matched as whole words so
# "fire" is caught but "fireflies" is not.
BANNED = frozenset(
    {
        "kill",
        "killed",
        "kills",
        "killing",
        "dead",
        "death",
        "dies",
        "died",
        "die",
        "blood",
        "bloody",
        "gun",
        "knife",
        "stab",
        "shoot",
        "shot",
        "war",
        "weapon",
        "monster",
        "monsters",
        "nightmare",
        "nightmares",
        "demon",
        "ghost",
        "ghosts",
        "scary",
        "terrifying",
        "horror",
        "evil",
        "witch",
        "curse",
        "cursed",
        "drown",
        "drowned",
        "burn",
        "burned",
        "burning",
        "fire",
        "flames",
        "hospital",
        "sick",
        "illness",
        "ambulance",
        "police",
        "jail",
        "steal",
        "stolen",
        "hate",
        "hates",
        "stupid",
        "ugly",
        "punish",
        "punished",
    }
)

# Multi word phrases, matched on the normalised text.
BANNED_PHRASES = ("lost forever", "never came back", "never returned", "alone forever")

# The model stopped telling a story and started talking about itself.
META = (
    "as an ai",
    "language model",
    "i cannot",
    "i can't help",
    "here is a story",
    "here's a story",
    "sure!",
    "certainly!",
    "i hope you enjoy",
    # Found in the recorded series: night 8 ended with "Open thread: Maybe
    # tomorrow..." which is the prompt's own field name read aloud.
    "open thread:",
    "open_thread",
    # Found in the browser lab: gemma 3 270M opened with "Hello, Mira! ...
    # I'm going to tell you a story", the narrator talking instead of telling.
    "tell you a story",
    "read you a story",
    "to be here to",
    "i hope you",
    "it's about a",
    "this story is about",
    "a story about a",
    # The model echoing its own instructions back, seen in the first long run.
    "everyone gets cosy",
    "part 1 of",
    "part 2 of",
    "part 3 of",
)

# The model leaked its own JSON scaffolding into the story. Reading raw JSON
# aloud to a child is as bad as a frightening word.
SCAFFOLDING = ('"title"', '"text"', '"summary"', '"open_thread"', "```", "{\n")

WORD_RE = re.compile(r"[a-z']+")
# Zero width and bidi controls let "mon\u200bster" slip past a word match.
_INVISIBLE = re.compile("[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]")
_APOSTROPHES = str.maketrans({"\u2018": "'", "\u2019": "'", "\u02bc": "'", "\uff07": "'"})


def normalise(text: str) -> str:
    """NFKC, strip invisible characters, fold apostrophes, lowercase.

    lower() rather than casefold() so the TypeScript port (toLowerCase) gives
    byte identical results.

    Done at the boundary so a full width or zero width spelling of a banned
    word is the same word.
    """
    text = unicodedata.normalize("NFKC", text)
    text = _INVISIBLE.sub("", text)
    return text.translate(_APOSTROPHES).lower()


@dataclass
class Verdict:
    ok: bool
    violations: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.ok


def check(
    text: str,
    avoid: list[str] | None = None,
    max_words: int = 900,
    min_words: int = 60,
    also_screen: str = "",
) -> Verdict:
    """Screen a draft.

    `avoid` is the child's own fear list. `also_screen` is text that must pass
    the content rules but does not count toward the length bounds: the title,
    which is read aloud and printed but is not the story.
    """
    if not isinstance(text, str) or not isinstance(also_screen, str):
        return Verdict(False, ["not text"])
    if len(text) + len(also_screen) > MAX_TEXT_CHARS:
        return Verdict(False, [f"input over {MAX_TEXT_CHARS} characters"])

    body = normalise(text)
    lowered = normalise(f"{also_screen}\n{text}")
    violations: list[str] = []
    words = set(WORD_RE.findall(lowered))
    body_words = WORD_RE.findall(body)

    for banned in sorted(BANNED & words):
        violations.append(f"banned word: {banned}")
    for phrase in BANNED_PHRASES:
        if phrase in lowered:
            violations.append(f"banned phrase: {phrase}")

    for term in (avoid or [])[:MAX_AVOID_TERMS]:
        if not isinstance(term, str):
            continue
        t = normalise(term).strip()[:MAX_TERM_CHARS]
        if t and t in lowered:
            violations.append(f"personal avoid-list term: {t}")

    for phrase in META:
        if phrase in lowered:
            violations.append(f"model meta-talk: {phrase}")

    for marker in SCAFFOLDING:
        if marker in text or marker in also_screen:
            violations.append(f"raw model scaffolding: {marker.strip()!r}")
            break

    if len(body_words) > max_words:
        violations.append(f"too long: {len(body_words)} words > {max_words}")
    if len(body_words) < min_words:
        violations.append(f"too short: {len(body_words)} words < {min_words}")

    return Verdict(ok=not violations, violations=violations)


def redact(text: str) -> str:
    """For logging rejected drafts, so the audit trail does not itself carry
    the thing we refused to read aloud."""
    out = normalise(text)
    for banned in BANNED:
        out = re.sub(rf"\b{re.escape(banned)}\b", "[blocked]", out)
    return out


# A child's request is rewritten before the model sees it. The scary word is
# replaced, never quoted: telling a 1B model "do not say horror" puts "horror"
# in its prompt, and it said it back on every draft.
GENTLE = {
    "monster": "fluffy friend",
    "monsters": "fluffy friends",
    "ghost": "glowy friend",
    "ghosts": "glowy friends",
    "demon": "sleepy dragon",
    "witch": "kind wizard",
    "nightmare": "dream",
    "nightmares": "dreams",
    "scary": "silly",
    "terrifying": "silly",
    "horror": "silly",
    "evil": "grumpy",
    "curse": "wish",
    "cursed": "wished",
    "fire": "warm glow",
    "flames": "warm glow",
    "burn": "glow",
    "burned": "glowed",
    "burning": "glowing",
    "dead": "sleepy",
    "death": "sleep",
    "die": "nap",
    "died": "napped",
    "dies": "naps",
    "kill": "hug",
    "killed": "hugged",
    "kills": "hugs",
    "killing": "hugging",
    "drown": "splash",
    "drowned": "splashed",
    "sick": "sleepy",
    "illness": "sniffle",
    "hospital": "doctor's house",
    "ambulance": "helper car",
    "police": "helper",
    "jail": "home",
    "steal": "borrow",
    "stolen": "borrowed",
    "hate": "like",
    "hates": "likes",
    "stupid": "silly",
    "ugly": "funny",
    "punish": "hug",
    "punished": "hugged",
    # Not banned in output, but a four year old asking for one wants the friendly kind.
    "zombie": "sleepy giant",
    "zombies": "sleepy giants",
    "vampire": "friendly bat",
    "vampires": "friendly bats",
    "skeleton": "dancing scarecrow",
    "spooky": "silly",
    "creepy": "silly",
}
GENTLE_PHRASES = {
    "lost forever": "found again",
    "never came back": "came back home",
    "never returned": "came home",
    "alone forever": "with friends",
}
GENRE = frozenset({"horror", "scary", "terrifying", "nightmare", "nightmares", "spooky", "creepy", "evil"})
GENRE_LINE = "a silly, cosy story where a shadow in the dark turns out to be a kind friend"


def gentle_request(request: str, avoid: list[str] | None = None) -> tuple[str, list[str]]:
    """(the request rewritten gently, the words that were softened).

    Children ask for dragons and horror. Refusing teaches them nothing, and
    the output guardrail still holds the line, so the idea is kept and made
    friendly instead.
    """
    if not isinstance(request, str):
        return "", []
    text = " ".join(normalise(request[: MAX_TERM_CHARS * 8]).split())
    words = set(WORD_RE.findall(text))
    found = sorted((BANNED | set(GENTLE)) & words)
    found += [p for p in BANNED_PHRASES if p in text]
    terms = []
    for term in (avoid or [])[:MAX_AVOID_TERMS]:
        if isinstance(term, str):
            t = normalise(term).strip()[:MAX_TERM_CHARS]
            if t and t in text and t not in found:
                found.append(t)
                terms.append(t)
    for t in terms:
        text = text.replace(t, "something cosy")
    for phrase, nice in GENTLE_PHRASES.items():
        text = text.replace(phrase, nice)
    text = WORD_RE.sub(lambda m: GENTLE.get(m.group(0), "" if m.group(0) in BANNED else m.group(0)), text)
    text = " ".join(text.split()).strip(" ,")
    if GENRE & words:
        text = f"{text}, {GENRE_LINE}" if len(WORD_RE.findall(text)) > 2 else GENRE_LINE
    return text, found


def screen_request(request: str, avoid: list[str] | None = None) -> list[str]:
    """Words in a child's request that get softened."""
    return gentle_request(request, avoid)[1]

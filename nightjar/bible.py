# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""The series bible: continuity across nights.

This is what makes Nightjar a series instead of a story generator. Every
chapter writes back what happened, who was in it and one open thread, and
tomorrow's prompt retrieves the relevant history. Retrieval uses embeddings
when an embed model is configured and falls back to lexical overlap otherwise,
so it degrades rather than breaks.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

from . import llm
from .config import BIBLE_FILE, read_json
from .limits import MAX_BIBLE_CHAPTERS, MAX_CHARACTERS, MAX_TEXT_CHARS

WORD_RE = re.compile(r"[a-z']{3,}")
STOP = {
    "the",
    "and",
    "was",
    "were",
    "with",
    "that",
    "this",
    "they",
    "them",
    "then",
    "she",
    "her",
    "his",
    "him",
    "had",
    "has",
    "for",
    "but",
    "not",
    "you",
    "its",
    "into",
    "from",
    "out",
    "who",
    "all",
    "one",
    "two",
    "very",
    "said",
    "like",
}


@dataclass
class Character:
    name: str
    description: str
    first_seen: str = ""


@dataclass
class Chapter:
    night: str
    title: str
    summary: str
    cast: list[str] = field(default_factory=list)
    open_thread: str = ""

    def searchable(self) -> str:
        return f"{self.title} {self.summary} {' '.join(self.cast)} {self.open_thread}"


class Bible:
    def __init__(self, characters: list[Character], chapters: list[Chapter]):
        self.characters = characters
        self.chapters = chapters

    # ---------- persistence ----------

    @classmethod
    def load(cls, path: Path = BIBLE_FILE) -> Bible:
        if not path.exists():
            return cls([], [])
        raw = read_json(path)
        if not isinstance(raw, dict):
            raise ValueError(f"{path.name}: expected a JSON object")

        def s(obj: dict, key: str, cap: int = 2000) -> str:
            value = obj.get(key, "")
            return value[:cap] if isinstance(value, str) else ""

        characters = []
        for c in (raw.get("characters") or [])[:MAX_CHARACTERS]:
            if isinstance(c, dict) and s(c, "name", 80).strip():
                characters.append(Character(s(c, "name", 80).strip(), s(c, "description", 300), s(c, "first_seen", 10)))
        chapters = []
        for c in (raw.get("chapters") or [])[-MAX_BIBLE_CHAPTERS:]:
            if not isinstance(c, dict):
                continue
            cast = [x[:80] for x in (c.get("cast") or []) if isinstance(x, str)][:12]
            chapters.append(
                Chapter(s(c, "night", 10), s(c, "title", 120), s(c, "summary", MAX_TEXT_CHARS // 10), cast, s(c, "open_thread", 400))
            )
        return cls(characters, chapters)

    def save(self, path: Path = BIBLE_FILE) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "characters": [asdict(c) for c in self.characters],
                    "chapters": [asdict(c) for c in self.chapters],
                },
                indent=2,
            )
        )

    # ---------- retrieval ----------

    def recall(self, query: str, k: int = 3) -> list[Chapter]:
        """Return the k most relevant past chapters."""
        if not self.chapters:
            return []
        docs = [c.searchable() for c in self.chapters]
        vectors = llm.embed([query] + docs)
        if vectors and len(vectors) == len(docs) + 1:
            scores = [_cosine(vectors[0], v) for v in vectors[1:]]
        else:
            scores = [_overlap(query, d) for d in docs]
        ranked = sorted(zip(scores, self.chapters, strict=False), key=lambda p: -p[0])
        # Always include last night: continuity matters more than similarity.
        picked = [c for _, c in ranked[:k]]
        last = self.chapters[-1]
        if last not in picked:
            picked.insert(0, last)
        return picked[:k]

    def character(self, name: str) -> Character | None:
        for c in self.characters:
            if c.name.lower() == name.lower():
                return c
        return None

    def cast_names(self) -> list[str]:
        return [c.name for c in self.characters]

    def add_chapter(self, chapter: Chapter) -> None:
        self.chapters.append(chapter)
        known = {c.name.lower() for c in self.characters}
        for name in chapter.cast:
            if name.lower() not in known:
                self.characters.append(
                    Character(
                        name=name,
                        description="introduced by the storyteller",
                        first_seen=chapter.night or date.today().isoformat(),
                    )
                )
                known.add(name.lower())

    def context_block(self, query: str, k: int = 3) -> str:
        """Human-readable history injected into the story prompt."""
        lines = []
        if self.characters:
            lines.append("CHARACTERS WHO ALREADY EXIST:")
            for c in self.characters[:8]:
                lines.append(f"- {c.name}: {c.description}")
        past = self.recall(query, k=k)
        if past:
            lines.append("")
            lines.append("WHAT HAPPENED ON EARLIER NIGHTS:")
            for c in past:
                lines.append(f"- [{c.night}] {c.title}: {c.summary}")
                if c.open_thread:
                    lines.append(f"  unresolved: {c.open_thread}")
        return "\n".join(lines)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _overlap(query: str, doc: str) -> float:
    q = {w for w in WORD_RE.findall(query.lower()) if w not in STOP}
    d = {w for w in WORD_RE.findall(doc.lower()) if w not in STOP}
    if not q or not d:
        return 0.0
    return len(q & d) / len(q | d)

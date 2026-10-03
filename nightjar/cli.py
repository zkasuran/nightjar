# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Nightjar CLI.

nightjar doctor                 # check the box is ready for bedtime
nightjar tonight "a story about the slow turtle"
nightjar asleep 14              # she was out in 14 minutes
nightjar tune                   # what the sleep model wants to try next
nightjar book                   # compile the week into a printable book
nightjar bible                  # who exists in this world so far
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from . import book as book_mod
from . import llm, narrate, sleeplog, story, tune
from .bible import Bible
from .config import CHILD_FILE, SETTINGS, Child, ensure_dirs


def _child() -> Child:
    if not CHILD_FILE.exists():
        sys.exit(f"missing {CHILD_FILE}. Copy data/child.example.json and edit it.")
    return Child.load()


def cmd_doctor(_args) -> int:
    ensure_dirs()
    version = llm.server_version()
    print(f"ollama          : {'v' + version if version else 'UNREACHABLE (run: ollama serve)'}")
    print(f"model           : {SETTINGS.model}")
    print(f"embeddings      : {SETTINGS.embed_model or 'off (lexical recall fallback)'}")
    print(f"narration       : {narrate.available()}")
    print(f"child profile   : {'ok' if CHILD_FILE.exists() else 'MISSING'}")
    rows = sleeplog.read()
    print(f"bedtime log     : {len(rows)} night(s), {len(sleeplog.labelled())} labelled")
    try:
        import tabpfn  # noqa: F401

        print("tabpfn          : installed")
    except Exception:
        print("tabpfn          : not installed (kernel k-NN fallback in use)")
    return 0 if version else 1


def cmd_tonight(args) -> int:
    ensure_dirs()
    child = _child()
    bible = Bible.load()

    rec = tune.recommend(cast_size=max(1, len(bible.cast_names()[:2])), prefer=args.backend)
    knobs = rec.knobs
    if args.words:
        knobs.target_words = args.words
    if args.pace:
        knobs.pace_wpm = args.pace
    if args.cast:
        knobs.cast = [c.strip() for c in args.cast.split(",") if c.strip()]
    elif bible.cast_names() and not args.request:
        knobs.cast = bible.cast_names()[:2]

    print(f"[tuner] {rec.explain()}")
    print(f"[model] {SETTINGS.model} generating…")

    request = (args.request or "")[:300]
    try:
        result = story.tonight(child, knobs, bible, request=request, log_night=args.night)
    except story.GuardRefused as refused:
        # Designed failure: no new chapter tonight, so last night's is read
        # again. A familiar story beats an unscreened one.
        record = refused.save()
        print(f"[guard] refused every draft tonight: {[d['violations'] for d in refused.drafts]}")
        print(f"[guard] audit record: {record}")
        if bible.chapters:
            last = bible.chapters[-1]
            print(f"[fallback] reading last night's chapter again: {last.title}")
        else:
            print("[fallback] no earlier chapter to read; tell her a story yourself tonight")
        return 4
    path = result.save()
    bible.save()

    feats = story.night_features(child, result)
    sleeplog.append(result.night, result.title, feats)

    print()
    print(f"  {result.title}")
    print(f"  {'-' * len(result.title)}")
    print(result.text)
    print()
    print(
        f"[stats] {feats.word_count} words · grade {feats.fk_grade} · "
        f"{feats.narration_seconds}s at {knobs.pace_wpm}wpm · "
        f"{result.attempts} attempt(s) · {result.gen_ms}ms"
    )
    if result.rejected:
        print(f"[guard] rejected {len(result.rejected)} draft(s): {result.rejected}")
    print(f"[saved] {path}")

    if not args.no_audio:
        try:
            audio = narrate.narrate(result.text, child.narrator_voice_id, result.slug, knobs.pace_wpm)
            print(f"[audio] {audio}")
            if args.play:
                narrate.play(audio)
        except narrate.NarrationUnavailable as exc:
            print(f"[audio] skipped: {exc}")

    print("\nWhen she's asleep, run:  nightjar asleep <minutes>")
    return 0


def _iso_date(value: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"not an ISO date: {value!r}") from exc


def cmd_asleep(args) -> int:
    if not 0 <= args.minutes <= 240:
        print("minutes must be between 0 and 240")
        return 1
    if sleeplog.record_asleep(args.minutes, args.night):
        n = len(sleeplog.labelled())
        print(f"logged {args.minutes} min. {n} labelled night(s) in the loop.")
        if n >= 2:
            print(f"next: {tune.recommend().explain()}")
        return 0
    print("no nights logged yet, run `nightjar tonight` first")
    return 1


def cmd_tune(args) -> int:
    print(tune.recommend(prefer=args.backend).explain())
    return 0


def cmd_book(args) -> int:
    child = _child()
    html_path, pdf_path = book_mod.build(child.name, days=args.days)
    print(f"[book] {html_path}")
    print(f"[book] {pdf_path}" if pdf_path else "[book] no PDF renderer (pip install weasyprint)")
    return 0


def cmd_bible(_args) -> int:
    bible = Bible.load()
    print(f"{len(bible.characters)} character(s), {len(bible.chapters)} chapter(s)")
    for c in bible.characters:
        print(f"  · {c.name}: {c.description}")
    for ch in bible.chapters[-5:]:
        print(f"  [{ch.night}] {ch.title}: {ch.summary}")
        if ch.open_thread:
            print(f"      unresolved: {ch.open_thread}")
    return 0


def cmd_serve(args) -> int:
    from . import serve

    if not 1024 <= args.port <= 65535:
        print("port must be 1024 to 65535")
        return 1
    serve.serve(args.port)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nightjar", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor", help="check local setup").set_defaults(fn=cmd_doctor)

    p_tonight = sub.add_parser("tonight", help="generate tonight's chapter")
    p_tonight.add_argument("request", nargs="?", help="what she asked for")
    p_tonight.add_argument("--words", type=int, help="override target length")
    p_tonight.add_argument("--pace", type=int, help="override narration wpm")
    p_tonight.add_argument("--cast", help="comma-separated characters")
    p_tonight.add_argument("--backend", default="auto", choices=["auto", "tabpfn", "knn"])
    p_tonight.add_argument("--no-audio", action="store_true")
    p_tonight.add_argument("--play", action="store_true", help="play audio when done")
    p_tonight.add_argument("--night", type=_iso_date, default=None, help="ISO date for this chapter (default: today)")
    p_tonight.set_defaults(fn=cmd_tonight)

    p_asleep = sub.add_parser("asleep", help="log minutes to fall asleep")
    p_asleep.add_argument("minutes", type=int)
    p_asleep.add_argument("--night", type=_iso_date, default=None, help="ISO date (default: latest)")
    p_asleep.set_defaults(fn=cmd_asleep)

    p_tune = sub.add_parser("tune", help="show the recommended knobs")
    p_tune.add_argument("--backend", default="auto", choices=["auto", "tabpfn", "knn"])
    p_tune.set_defaults(fn=cmd_tune)

    p_book = sub.add_parser("book", help="compile the printable book")
    p_book.add_argument("--days", type=int, default=7)
    p_book.set_defaults(fn=cmd_book)

    sub.add_parser("bible", help="show the series bible").set_defaults(fn=cmd_bible)

    p_serve = sub.add_parser("serve", help="the box: a local page where she asks for tonight's story")
    p_serve.add_argument("--port", type=int, default=8765)
    p_serve.set_defaults(fn=cmd_serve)

    args = parser.parse_args(argv)
    try:
        return args.fn(args)
    except llm.LLMUnavailable as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())

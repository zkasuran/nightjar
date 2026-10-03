#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Export the fixtures the website renders, from the real pipeline.

Everything in web/public/demo/ comes out of this script:

* stories.json  the chapters recorded by scripts/record_series.sh (real
                gemma3:1b output, real guardrail verdicts, rejected drafts
                redacted)
* log.json      the SAMPLE bedtime log, labelled as sample
* tuner.json    k-NN and TabPFN predictions over the full knob grid, plus a
                leave-one-out comparison, computed here in Python
* guard.json    a corpus of drafts with the Python guardrail verdicts, used as
                the parity oracle for the TypeScript port
* manifest.json sha256 of every file above, checked in the browser

Run with the project venv when TabPFN is installed:  .venv/bin/python scripts/export_demo.py
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from nightjar import guard, sleeplog, tune  # noqa: E402
from nightjar.features import FEATURE_COLUMNS, TARGET_COLUMN, extract  # noqa: E402

DEMO = ROOT / "demo"
OUT = ROOT / "web" / "public" / "demo"


def stories() -> dict:
    chapters = []
    for path in sorted((DEMO / "out" / "stories").glob("*.json")):
        d = json.loads(path.read_text())
        feats = extract(
            d["text"], d["knobs"]["pace_wpm"], d["knobs"]["calm_level"], d["knobs"]["is_sequel"], max(1, len(d["knobs"]["cast"])), 19
        )
        chapters.append(
            {
                "night": d["night"],
                "title": d["title"],
                "text": d["text"],
                "knobs": d["knobs"],
                "attempts": d["attempts"],
                "rejected": d.get("rejected_drafts", []),
                "gen_ms": d["gen_ms"],
                "eval_tokens": d["eval_tokens"],
                "features": feats.as_row(),
            }
        )
    # Requests come from the series log, in order; failed nights are kept too.
    log = (DEMO / "series.log").read_text() if (DEMO / "series.log").exists() else ""
    nights = []
    for m in re.finditer(r"### night (\d+) (\S+) :: (.*?)\n(.*?)exit=(\d+) seconds=(\d+)", log, re.S):
        idx, night, request, body, code, secs = m.groups()
        failure = ""
        if code != "0":
            err = re.search(r"(?:error: |\[guard\] refused every draft tonight: )(.*)", body)
            failure = err.group(1)[:400] if err else f"exit {code}"
        refusal = DEMO / "out" / "refusals" / f"{night}.json"
        drafts = json.loads(refusal.read_text())["drafts"] if refusal.exists() else []
        fallback = re.search(r"\[fallback\] (.*)", body)
        nights.append(
            {
                "index": int(idx),
                "night": night,
                "request": request,
                "exit": int(code),
                "seconds": int(secs),
                "failure": failure,
                "refused_drafts": drafts,
                "fallback": fallback.group(1) if fallback else "",
            }
        )
    bible = json.loads((DEMO / "data" / "bible.json").read_text())
    child = json.loads((DEMO / "data" / "child.json").read_text())
    return {
        "model": "gemma3:1b",
        "runtime": "Ollama 0.35.1, CPU only, no GPU",
        "recorded": datetime.now(UTC).strftime("%Y-%m-%d"),
        "note": "Recorded in one session by scripts/record_series.sh. Night dates are a sequence for the book, not nights a child slept.",
        "child": {**child, "sample": True},
        "nights": nights,
        "chapters": chapters,
        "bible": bible,
    }


def sample_log() -> dict:
    rows = sleeplog.labelled()
    return {
        "sample": True,
        "note": "Representative sample rows written to exercise the tuner. Not measured on a real child.",
        "columns": [*FEATURE_COLUMNS, TARGET_COLUMN],
        "rows": [{"night": r["night"], "title": r["title"], **{c: r[c] for c in (*FEATURE_COLUMNS, TARGET_COLUMN)}} for r in rows],
    }


def loo(history: list[dict], predict) -> list[float]:
    """Leave one out: for each night, predict it from the others."""
    errs = []
    for i, row in enumerate(history):
        rest = history[:i] + history[i + 1 :]
        cand = {c: float(row[c]) for c in FEATURE_COLUMNS}
        pred = predict(rest, [cand])
        if pred is None:
            return []
        errs.append(abs(pred[0] - float(row[TARGET_COLUMN])))
    return errs


def tuner() -> dict:
    history = tune._history()
    candidates = tune._candidate_rows(history, cast_size=2)
    knn = tune._predict_knn(history, candidates)
    tab = tune._predict_tabpfn(history, candidates)
    grid = []
    for i, c in enumerate(candidates):
        k = c["_knobs"]
        grid.append(
            {
                "target_words": k.target_words,
                "pace_wpm": k.pace_wpm,
                "calm_level": k.calm_level,
                "is_sequel": int(k.is_sequel),
                "features": {col: c[col] for col in FEATURE_COLUMNS},
                "knn": round(knn[i], 6),
                "tabpfn": round(tab[i], 6) if tab else None,
            }
        )
    mean = sum(float(r[TARGET_COLUMN]) for r in history) / len(history)
    knn_err = loo(history, tune._predict_knn)
    tab_err = loo(history, tune._predict_tabpfn) if tab else []
    base_err = [abs(mean - float(r[TARGET_COLUMN])) for r in history]

    def mae(e: list[float]) -> float | None:
        return round(sum(e) / len(e), 3) if e else None

    return {
        "sample": True,
        "bandwidth": 0.6,
        "baseline_minutes": round(mean, 6),
        "grid": grid,
        "loo": {
            "rows": len(history),
            "mean_baseline_mae": mae(base_err),
            "knn_mae": mae(knn_err),
            "tabpfn_mae": mae(tab_err),
            "tabpfn_error": tune.LAST_TABPFN_ERROR or None,
        },
        "tabpfn_version": _version("tabpfn"),
    }


def _version(pkg: str) -> str | None:
    try:
        from importlib.metadata import version

        return version(pkg)
    except Exception:
        return None


GUARD_CASES = [
    ("calm", "The Quiet Garden", "Mira put on her red boots. Pim walked slowly beside her. They counted soft things. " * 6, []),
    ("banned word", "The Garden", "Mira met a monster by the gate and it was very loud. " * 8, []),
    (
        "avoid list in title",
        "Thunder and the Moon's Light",
        "The Moon was watching from behind the chimney. Pim moved slowly. " * 6,
        ["thunder"],
    ),
    ("avoid list in body", "Rain", "Far away the thunder rolled and Pim hid in his shell. " * 8, ["thunder"]),
    ("zero width bypass", "The Gate", "Mira met a mon\u200bster by the gate. " * 12, []),
    ("fullwidth bypass", "The Gate", "Mira met a \uff4d\uff4f\uff4e\uff53\uff54\uff45\uff52 by the gate. " * 12, []),
    ("meta talk", "Turtle", "Here\u2019s a story about a turtle who walks slowly home. " * 8, []),
    (
        "json leak",
        "```json",
        '{"title": "The Moon and Pim", "text": "The Moon was quiet tonight. Pim crawled slow.", \\"summary\\": "x"}',
        [],
    ),
    ("too short", "Short", "Pim slept.", []),
    ("phrase", "Away", "Pim went away and never came back to the quiet garden at all. " * 6, []),
    ("substring is fine", "Fireflies", "The fireflies blinked softly over the quiet grass. " * 8, []),
]


def guard_corpus(story_data: dict) -> dict:
    cases = [{"name": n, "title": t, "text": x, "avoid": a} for n, t, x, a in GUARD_CASES]
    for ch in story_data["chapters"]:
        for d in ch["rejected"]:
            cases.append(
                {
                    "name": f"recorded rejection, {ch['night']} attempt {d['attempt']}",
                    "title": d["title"],
                    "text": d["text"],
                    "avoid": story_data["child"]["avoid"],
                }
            )
        cases.append(
            {"name": f"recorded chapter, {ch['night']}", "title": ch["title"], "text": ch["text"], "avoid": story_data["child"]["avoid"]}
        )
    for n in story_data["nights"]:
        for d in n["refused_drafts"]:
            cases.append(
                {
                    "name": f"refused night, {n['night']} attempt {d['attempt']}",
                    "title": d["title"],
                    "text": d["text"],
                    "avoid": story_data["child"]["avoid"],
                }
            )
    for c in cases:
        v = guard.check(c["text"], avoid=c["avoid"], also_screen=c["title"])
        c["expect"] = {"ok": v.ok, "violations": v.violations}
    return {
        "banned": sorted(guard.BANNED),
        "banned_phrases": list(guard.BANNED_PHRASES),
        "meta": list(guard.META),
        "scaffolding": list(guard.SCAFFOLDING),
        "cases": cases,
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    s = stories()
    files = {"stories.json": s, "log.json": sample_log(), "tuner.json": tuner(), "guard.json": guard_corpus(s)}
    manifest = {}
    for name, data in files.items():
        blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
        (OUT / name).write_bytes(blob)
        manifest[name] = {"sha256": hashlib.sha256(blob).hexdigest(), "bytes": len(blob)}
    (OUT / "manifest.json").write_text(json.dumps({"files": manifest}, indent=1))
    t = files["tuner.json"]["loo"]
    print(
        f"chapters={len(s['chapters'])} nights={len(s['nights'])} grid={len(files['tuner.json']['grid'])} guard_cases={len(files['guard.json']['cases'])}"
    )
    print(f"LOO MAE  mean={t['mean_baseline_mae']}  knn={t['knn_mae']}  tabpfn={t['tabpfn_mae']}  ({t['rows']} sample rows)")
    if not all(math.isfinite(g["knn"]) for g in files["tuner.json"]["grid"]):
        print("non-finite prediction", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

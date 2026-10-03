# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Closing the loop: pick tomorrow's knobs from last week's sleep data.

This is the part no other bedtime-story project does. We have a tiny tabular
dataset (one row per night, realistically 8-30 rows ever) and we want to know
which story parameters correlate with this one child falling asleep faster.

That data size is exactly TabPFN's design point: a tabular foundation model
that does in-context learning with no training step. When TabPFN is not
installed we fall back to a dependency-free kernel-weighted k-NN so the CLI
always works. We label which backend produced the answer because pretending
nine rows is a lot of data would be dishonest.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import product

from .features import FEATURE_COLUMNS, TARGET_COLUMN
from .sleeplog import labelled
from .story import Knobs

# Candidate space the tuner is allowed to search.
WORD_GRID = (220, 300, 380, 460)
PACE_GRID = (95, 110, 125)
CALM_GRID = (3, 4, 5)
SEQUEL_GRID = (0, 1)


@dataclass
class Recommendation:
    knobs: Knobs
    predicted_minutes: float
    baseline_minutes: float
    backend: str
    n_rows: int

    @property
    def improvement(self) -> float:
        return round(self.baseline_minutes - self.predicted_minutes, 1)

    def explain(self) -> str:
        if self.backend == "cold-start":
            return (
                f"No labelled nights yet, using defaults ({self.knobs.describe()}). "
                "Log one night with `nightjar asleep <minutes>` to start the loop."
            )
        return (
            f"{self.backend} on {self.n_rows} labelled night(s): "
            f"predicts {self.predicted_minutes:.1f} min to sleep "
            f"vs {self.baseline_minutes:.1f} min average "
            f"({self.improvement:+.1f} min) with {self.knobs.describe()}"
        )


def _history() -> list[dict]:
    return labelled()


def _vector(row: dict) -> list[float]:
    return [float(row[c]) for c in FEATURE_COLUMNS]


def _candidate_rows(history: list[dict], cast_size: int) -> list[dict]:
    """Build feature rows for each candidate knob setting.

    Text-derived columns we cannot know before generating (reading level,
    sentence length) are filled with the historical mean. Stated plainly
    because it is an assumption, not a measurement.
    """

    def mean(col: str, default: float) -> float:
        vals = [float(r[col]) for r in history] if history else []
        return sum(vals) / len(vals) if vals else default

    avg_sent_len = mean("avg_sentence_len", 8.0)
    fk = mean("fk_grade", 1.5)
    hour = int(mean("bedtime_hour", 19))

    rows = []
    for words, pace, calm, sequel in product(WORD_GRID, PACE_GRID, CALM_GRID, SEQUEL_GRID):
        rows.append(
            {
                "word_count": float(words),
                "sentence_count": float(max(1, round(words / avg_sent_len))),
                "avg_sentence_len": avg_sent_len,
                "fk_grade": fk,
                "pace_wpm": float(pace),
                "calm_level": float(calm),
                "is_sequel": float(sequel),
                "cast_size": float(max(1, cast_size)),
                "bedtime_hour": float(hour),
                "narration_seconds": float(round(words / pace * 60)),
                "_knobs": Knobs(
                    target_words=words,
                    pace_wpm=pace,
                    calm_level=calm,
                    is_sequel=bool(sequel),
                ),
            }
        )
    return rows


LAST_TABPFN_ERROR = ""


def _predict_tabpfn(history: list[dict], candidates: list[dict]) -> list[float] | None:
    """None means TabPFN could not run. The reason is kept in
    LAST_TABPFN_ERROR and printed, because a silent fallback would look like a
    TabPFN answer when it was not one."""
    global LAST_TABPFN_ERROR
    try:
        import numpy as np
        from tabpfn import TabPFNRegressor
    except Exception as exc:
        LAST_TABPFN_ERROR = f"not installed ({type(exc).__name__})"
        return None
    try:
        X = np.array([_vector(r) for r in history], dtype=float)
        y = np.array([float(r[TARGET_COLUMN]) for r in history], dtype=float)
        model = TabPFNRegressor()
        model.fit(X, y)
        Xc = np.array([[c[col] for col in FEATURE_COLUMNS] for c in candidates], dtype=float)
        preds = [float(v) for v in model.predict(Xc)]
    except Exception as exc:
        LAST_TABPFN_ERROR = f"failed: {type(exc).__name__}: {str(exc)[:160]}"
        return None
    if len(preds) != len(candidates) or not all(math.isfinite(v) for v in preds):
        LAST_TABPFN_ERROR = "returned a malformed prediction vector"
        return None
    return preds


def _predict_knn(history: list[dict], candidates: list[dict]) -> list[float]:
    """Gaussian-kernel weighted nearest neighbours, pure stdlib."""
    cols = FEATURE_COLUMNS
    mins = [min(float(r[c]) for r in history) for c in cols]
    maxs = [max(float(r[c]) for r in history) for c in cols]
    spans = [(hi - lo) or 1.0 for lo, hi in zip(mins, maxs, strict=False)]

    def norm(values: list[float]) -> list[float]:
        return [(v - lo) / s for v, lo, s in zip(values, mins, spans, strict=False)]

    hist_vecs = [(norm(_vector(r)), float(r[TARGET_COLUMN])) for r in history]
    bandwidth = 0.6
    out = []
    for cand in candidates:
        cv = norm([cand[c] for c in cols])
        num = den = 0.0
        for hv, target in hist_vecs:
            dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(cv, hv, strict=False)))
            w = math.exp(-(dist**2) / (2 * bandwidth**2))
            num += w * target
            den += w
        out.append(num / den if den else sum(t for _, t in hist_vecs) / len(hist_vecs))
    return out


def recommend(cast_size: int = 2, prefer: str = "auto") -> Recommendation:
    """Choose tonight's knobs. `prefer` is auto | tabpfn | knn."""
    history = _history()
    if len(history) < 2:
        return Recommendation(
            knobs=Knobs(cast=[]),
            predicted_minutes=0.0,
            baseline_minutes=0.0,
            backend="cold-start",
            n_rows=len(history),
        )

    candidates = _candidate_rows(history, cast_size)
    preds = None
    backend = "knn-fallback"
    if prefer in ("auto", "tabpfn"):
        preds = _predict_tabpfn(history, candidates)
        if preds is not None:
            backend = "TabPFN"
    if preds is None:
        preds = _predict_knn(history, candidates)
        if prefer in ("auto", "tabpfn") and LAST_TABPFN_ERROR:
            backend = f"knn-fallback (TabPFN {LAST_TABPFN_ERROR})"

    best_idx = min(range(len(preds)), key=lambda i: preds[i])
    baseline = sum(float(r[TARGET_COLUMN]) for r in history) / len(history)
    return Recommendation(
        knobs=candidates[best_idx]["_knobs"],
        predicted_minutes=preds[best_idx],
        baseline_minutes=baseline,
        backend=backend,
        n_rows=len(history),
    )

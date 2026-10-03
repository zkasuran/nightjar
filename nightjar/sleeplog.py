# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""The bedtime log: the feedback signal that makes this a loop.

One row per night. `minutes_to_asleep` is filled in by the parent tapping once
when the child is actually out, which is the only measurement a tired adult
will reliably provide.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

from .config import SLEEP_LOG
from .features import FEATURE_COLUMNS, TARGET_COLUMN, NightFeatures
from .limits import MAX_FILE_BYTES, MAX_LOG_ROWS

COLUMNS = ["night", "title", *FEATURE_COLUMNS, TARGET_COLUMN]


def _ensure(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with path.open("w", newline="") as fh:
            csv.DictWriter(fh, fieldnames=COLUMNS).writeheader()


def append(
    night: str,
    title: str,
    feats: NightFeatures,
    minutes: int | None = None,
    path: Path = SLEEP_LOG,
) -> None:
    _ensure(path)
    row = {"night": night, "title": title, **feats.as_row(), TARGET_COLUMN: minutes if minutes is not None else ""}
    with path.open("a", newline="") as fh:
        csv.DictWriter(fh, fieldnames=COLUMNS).writerow(row)


def read(path: Path = SLEEP_LOG) -> list[dict]:
    if not path.exists():
        return []
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"{path.name}: over the {MAX_FILE_BYTES} byte ceiling")
    with path.open(newline="", encoding="utf-8") as fh:
        rows = []
        for i, row in enumerate(csv.DictReader(fh)):
            if i >= MAX_LOG_ROWS:
                break
            rows.append({k: (v or "") for k, v in row.items() if k in COLUMNS})
        return rows


def labelled(path: Path = SLEEP_LOG) -> list[dict]:
    """Rows where the parent recorded an outcome."""
    out = []
    for row in read(path):
        value = (row.get(TARGET_COLUMN) or "").strip()
        if not value:
            continue
        try:
            row[TARGET_COLUMN] = float(value)
            for col in FEATURE_COLUMNS:
                row[col] = float(row[col])
        except (ValueError, KeyError, TypeError):
            continue  # a hand edited row that is not numeric is skipped, never fatal
        if not all(math.isfinite(row[c]) for c in (*FEATURE_COLUMNS, TARGET_COLUMN)):
            continue
        if not 0 <= row[TARGET_COLUMN] <= 240:
            continue
        out.append(row)
    return out


def record_asleep(minutes: int, night: str | None = None, path: Path = SLEEP_LOG) -> bool:
    """Fill in the outcome for a night (defaults to the latest unlabelled row)."""
    rows = read(path)
    if not rows:
        return False
    target = None
    if night:
        for row in rows:
            if row["night"] == night:
                target = row
    else:
        for row in reversed(rows):
            if not (row.get(TARGET_COLUMN) or "").strip():
                target = row
                break
        target = target or rows[-1]
    if target is None:
        return False
    target[TARGET_COLUMN] = str(minutes)
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    return True

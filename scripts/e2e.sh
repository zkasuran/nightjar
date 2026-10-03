#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
# End to end through the real CLI against a fake model server.
# Honest run: one leaked draft refused, clean chapter accepted, logged, tuned, book built.
# Hostile run: every draft refused, nothing new saved, exit 4, fallback named.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$T"' EXIT
PORT=$((20000 + RANDOM % 20000))
seed() { mkdir -p "$1/data" "$1/out"; cp data/child.example.json "$1/data/child.json"; cp data/bible.json data/bedtime_log.csv "$1/data/"; }
run() { NIGHTJAR_DATA="$1/data" NIGHTJAR_OUT="$1/out" OLLAMA_HOST="http://127.0.0.1:$PORT" python3 -m nightjar.cli "${@:2}"; }

python3 scripts/fake_ollama.py "$PORT" normal & sleep 0.6
seed "$T/a"
out=$(run "$T/a" tonight "the slow turtle" --no-audio --backend knn --night 2026-10-03)
grep -q "rejected 1 draft" <<<"$out" || { echo "e2e: leaked draft was not refused"; echo "$out"; exit 1; }
grep -q "Pim and the Quiet Garden" <<<"$out" || { echo "e2e: clean chapter missing or title not cleaned"; exit 1; }
grep -q '\[Pim' <<<"$out" && { echo "e2e: brackets survived in title"; exit 1; }
run "$T/a" asleep 7 >/dev/null
run "$T/a" tune | grep -q "10 labelled" || { echo "e2e: asleep did not label the night"; exit 1; }
run "$T/a" book | grep -q "book-" || { echo "e2e: book not built"; exit 1; }
echo "e2e honest: refused the leak, accepted the chapter, logged, tuned, built the book"
kill %1; wait %1 2>/dev/null || true

python3 scripts/fake_ollama.py "$PORT" hostile & sleep 0.6
seed "$T/b"
set +e; out=$(run "$T/b" tonight "a monster" --no-audio --backend knn --night 2026-10-04); code=$?; set -e
[ "$code" = 4 ] || { echo "e2e: hostile run exited $code, want 4"; exit 1; }
grep -q "reading last night's chapter again" <<<"$out" || { echo "e2e: no fallback"; exit 1; }
[ -f "$T/b/out/refusals/2026-10-04.json" ] || { echo "e2e: no refusal audit record"; exit 1; }
[ -z "$(ls -A "$T/b/out/stories" 2>/dev/null)" ] || { echo "e2e: a refused story was saved"; exit 1; }
grep -q '"monster"' "$T/b/out/refusals/2026-10-04.json" && { echo "e2e: refusal record not redacted"; exit 1; }
echo "e2e hostile: every draft refused, nothing saved, fallback named, audit record redacted"

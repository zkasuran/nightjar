#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
# Record a real series: the shipped CLI, the local model, the real guardrail.
# Writes into demo/ (a copy of the sample seed) so data/ stays the clean seed.
# Night dates are a sequence for the book, not calendar nights a child slept.
set -euo pipefail
cd "$(dirname "$0")/.."

export NIGHTJAR_DATA="$PWD/demo/data" NIGHTJAR_OUT="$PWD/demo/out"
rm -rf demo && mkdir -p demo/data demo/out
cp data/child.example.json demo/data/child.json
cp data/bible.json data/bedtime_log.csv demo/data/

PY=python3
[ -x .venv/bin/python ] && PY=.venv/bin/python

requests=(
  "the slow turtle and the last soft thing at the end of the path"
  "can the moon come down and visit"
  "a thunderstorm and a monster in the basement"
  "my red boots go on an adventure"
  "a dragon that breathes fire"
  "snow falling on the garden"
  "a story where everybody gets very sleepy"
  "Pim finds a new friend"
)

: > demo/series.log
i=0
for req in "${requests[@]}"; do
  night=$(date -d "2026-10-03 +$i day" +%F)
  i=$((i + 1))
  printf '\n### night %s %s :: %s\n' "$i" "$night" "$req" | tee -a demo/series.log
  start=$(date +%s)
  if "$PY" -m nightjar.cli tonight "$req" --night "$night" --no-audio --backend knn >> demo/series.log 2>&1; then
    echo "exit=0 seconds=$(( $(date +%s) - start ))" | tee -a demo/series.log
  else
    echo "exit=$? seconds=$(( $(date +%s) - start ))" | tee -a demo/series.log
  fi
done
echo "series done: $(ls demo/out/stories | wc -l) chapter(s)" | tee -a demo/series.log

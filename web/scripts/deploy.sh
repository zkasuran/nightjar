#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
# Gate, build, ship the static site to Vercel, then prove it as a stranger.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd .. && ./verify.sh)
cp vercel.json dist/vercel.json
[ -f .vercel/project.json ] || { echo "run once: cd dist && vercel link --yes --project nightjar-bedtime && cp -r .vercel .."; exit 1; }
cp -r .vercel dist/.vercel
url=$(cd dist && vercel deploy --prod --yes 2>/dev/null | tail -1)
echo "deployed: $url"
U=${NIGHTJAR_URL:-https://nightjar-bedtime.vercel.app}
for p in / /demo/manifest.json /demo/stories.json /ort/ort-wasm-simd-threaded.asyncify.mjs; do curl -fsS -o /dev/null "$U$p" || { echo "anonymous fetch failed: $U$p"; exit 1; }; done
curl -fsSI "$U/" | grep -qi "x-frame-options: deny" || { echo "headers missing on $U"; exit 1; }
echo "live: $U"

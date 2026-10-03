#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
# The one release gate. CI runs exactly this. Prints ALL GREEN only at the end.
set -euo pipefail
cd "$(dirname "$0")"
step() { printf '\n== %s\n' "$*"; }

step "python lint";                    python3 -m ruff check nightjar tests scripts
step "python format";                  python3 -m ruff format --check nightjar tests scripts
step "python tests (unit, adversarial)"; python3 -m pytest -q
step "python supply chain";            python3 -c "import tomllib;d=tomllib.load(open('pyproject.toml','rb'));assert d['project']['dependencies']==[],'core must stay stdlib only'"; echo "core dependencies: none"
step "outward words (no em dashes in shipped text)"
! grep -rn $'\u2014' --include='*.py' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.css' nightjar web/src scripts README.md SECURITY.md CONSENT.md DATA-SOURCES.md
step "licence header on every source file"
missing=$(grep -L "SPDX-License-Identifier" nightjar/*.py tests/*.py scripts/*.py scripts/*.sh web/src/*.tsx web/src/*/*.ts web/src/*/*.tsx web/test/*.mjs web/scripts/*.mjs || true)
[ -z "$missing" ] || { echo "missing SPDX: $missing"; exit 1; }
step "web: install, typecheck, parity and adversarial tests, build with CSP gate, audit"
(cd web && npm ci --no-audit --no-fund --loglevel=error && npm run typecheck && npm test && npm run build && npm audit --audit-level=low)
step "end to end (real CLI, honest passes, hostile refused)"; scripts/e2e.sh
printf '\nALL GREEN\n'

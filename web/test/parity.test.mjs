// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// The TypeScript ports must agree with the Python originals, byte for byte on
// verdicts and to 1e-9 on predictions. demo/*.json is the Python oracle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check } from "../src/lib/guard.ts";
import { candidates, knn, recommend } from "../src/lib/tuner.ts";

const load = (n) => JSON.parse(readFileSync(new URL(`../public/demo/${n}`, import.meta.url)));
const guard = load("guard.json");
const tuner = load("tuner.json");
const log = load("log.json");

test("guardrail: every Python verdict is reproduced exactly", () => {
  assert.ok(guard.cases.length >= 20, "corpus too small to mean anything");
  for (const c of guard.cases) {
    const v = check(guard, c.text, { avoid: c.avoid, alsoScreen: c.title });
    assert.deepEqual(v.violations, c.expect.violations, c.name);
    assert.equal(v.ok, c.expect.ok, c.name);
  }
});

test("guardrail: the corpus exercises both outcomes and every rule family", () => {
  const all = guard.cases.flatMap((c) => c.expect.violations).join("\n");
  for (const fam of ["banned word", "banned phrase", "personal avoid-list term", "model meta-talk", "raw model scaffolding", "too short"]) assert.ok(all.includes(fam), fam);
  assert.ok(guard.cases.some((c) => c.expect.ok));
});

test("tuner: candidate grid matches Python feature for feature", () => {
  const grid = candidates(log.rows, 2);
  assert.equal(grid.length, tuner.grid.length);
  grid.forEach((g, i) => {
    const py = tuner.grid[i];
    assert.equal(g.knobs.target_words, py.target_words);
    assert.equal(g.knobs.pace_wpm, py.pace_wpm);
    for (const [k, v] of Object.entries(py.features)) assert.ok(Math.abs(g.f[k] - v) < 1e-9, `${i}.${k}: ${g.f[k]} vs ${v}`);
  });
});

test("tuner: k-NN predictions match Python to 1e-6 and pick the same winner", () => {
  const rec = recommend(log.rows, 2);
  assert.ok(rec);
  rec.preds.forEach((p, i) => assert.ok(Math.abs(p - tuner.grid[i].knn) < 1e-6, `cell ${i}: ${p} vs ${tuner.grid[i].knn}`));
  const pyBest = tuner.grid.reduce((b, g, i, a) => (g.knn < a[b].knn ? i : b), 0);
  assert.equal(rec.best, pyBest);
});

test("tuner: fewer than two rows gives no recommendation instead of nonsense", () => {
  assert.equal(recommend([], 2), null);
  assert.equal(recommend(log.rows.slice(0, 1), 2), null);
  const p = knn(log.rows.slice(0, 2), [candidates(log.rows, 2)[0].f]);
  assert.ok(Number.isFinite(p[0]));
});

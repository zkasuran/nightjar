// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// The TypeScript ports must agree with the Python originals, byte for byte on
// verdicts and to 1e-9 on predictions. demo/*.json is the Python oracle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check, gentleRequest, screenRequest } from "../src/lib/guard.ts";
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

test("narration: every chapter has a word clock that matches its words", () => {
  const stories = load("stories.json");
  for (const c of stories.chapters) {
    assert.ok(c.audio, c.title);
    assert.equal(c.audio.words.length, (c.text.match(/\S+/g) ?? []).length, c.title);
    for (let i = 1; i < c.audio.words.length; i++) assert.ok(c.audio.words[i][0] >= c.audio.words[i - 1][0], `${c.title} word ${i}`);
    assert.ok(c.audio.words.at(-1)[1] <= c.audio.duration + 0.5);
  }
});

test("request screening: the TypeScript port softens exactly what Python does", () => {
  assert.ok(guard.requests.length >= 6);
  assert.ok(guard.requests.some((r) => r.expect.length > 0) && guard.requests.some((r) => r.expect.length === 0));
  for (const r of guard.requests) {
    assert.deepEqual(screenRequest(guard, r.request, r.avoid), r.expect, r.request);
    assert.equal(gentleRequest(guard, r.request, r.avoid).text, r.gentle, r.request);
  }
  const h = guard.requests.find((r) => r.request === "horror");
  assert.ok(h && !h.gentle.includes("horror") && h.gentle.includes("kind friend"));
});

test("lullaby: each chapter gets its own tune, the same one every time", async () => {
  const { compose, seedOf } = await import("../src/lib/lullaby.ts");
  const stories = load("stories.json");
  const tunes = stories.chapters.map((c) => JSON.stringify(compose(seedOf(`${c.night} ${c.title}`))));
  assert.equal(new Set(tunes).size, tunes.length, "two chapters share a tune");
  assert.equal(JSON.stringify(compose(seedOf("x"))), JSON.stringify(compose(seedOf("x"))));
  for (const t of tunes.map((x) => JSON.parse(x))) {
    assert.ok(t.bpm >= 58 && t.bpm <= 67, "lullaby tempo");
    assert.equal(t.melody.length, 16);
    assert.ok(t.melody.every((m) => m === null || (m >= 0 && m <= 9)));
    assert.ok(t.melody.filter((m) => m !== null).length >= 4, "melody too sparse");
  }
});

// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Hostile input against the browser side: the guardrail port and the fixture loader.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadAudio, loadDemo } from "../src/lib/data.ts";
import { check, MAX_TEXT_CHARS } from "../src/lib/guard.ts";

const rules = JSON.parse(readFileSync(new URL("../public/demo/guard.json", import.meta.url)));
let seed = 20261003;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const ALPHA = "abc monster \u200b\uff4d{}\"`\n\u202e🙂é漢'\u2019";
const junk = (n) => Array.from({ length: n }, () => ALPHA[Math.floor(rnd() * ALPHA.length)]).join("");

test("guardrail never throws and ok always equals no violations", () => {
  for (let i = 0; i < 400; i++) {
    const v = check(rules, junk(Math.floor(rnd() * 2500)), { avoid: [junk(4)], alsoScreen: junk(20) });
    assert.equal(v.ok, v.violations.length === 0);
  }
});

test("guardrail refuses non strings and oversized input without scanning", () => {
  assert.equal(check(rules, null).ok, false);
  assert.equal(check(rules, 42).ok, false);
  const v = check(rules, "a ".repeat(MAX_TEXT_CHARS));
  assert.deepEqual(v.violations, [`input over ${MAX_TEXT_CHARS} characters`]);
});

test("guardrail bypass attempts are caught", () => {
  const pad = " Pim walked slowly in the quiet garden.".repeat(12);
  for (const t of ["mon\u200bster", "\uff4d\uff4f\uff4e\uff53\uff54\uff45\uff52", "MONSTER", "mon\u00adster"]) assert.equal(check(rules, `A ${t} waited.${pad}`).ok, false, JSON.stringify(t));
});

// A fake fetch serving public/demo, with optional tampering.
function serve(tamper) {
  return async (url) => {
    const name = String(url).split("/").pop();
    let body = readFileSync(new URL(`../public/demo/${name}`, import.meta.url));
    if (tamper) body = tamper(name, body);
    return new Response(body, { status: 200 });
  };
}

test("fixtures load and validate when untouched", async () => {
  globalThis.fetch = serve();
  const d = await loadDemo("/demo/");
  assert.ok(d.stories.chapters.length > 0);
  assert.equal(d.tuner.grid.length, 72);
});

test("a fixture edited by one byte is rejected by its sha256", async () => {
  globalThis.fetch = serve((n, b) => (n === "stories.json" ? Buffer.from(b.toString().replace("Pim", "Pin")) : b));
  await assert.rejects(loadDemo("/t1/"), /does not match its sha256/);
});

test("a manifest that matches a malformed fixture is still rejected by shape checks", async () => {
  const bad = Buffer.from(JSON.stringify({ sample: false, rows: "nope" }));
  globalThis.fetch = serve((n, b) => {
    if (n === "log.json") return bad;
    if (n === "manifest.json") {
      const m = JSON.parse(b);
      m.files["log.json"].sha256 = createHash("sha256").update(bad).digest("hex");
      return Buffer.from(JSON.stringify(m));
    }
    return b;
  });
  await assert.rejects(loadDemo("/t2/"), /failed validation/);
});

test("an oversized response is refused", async () => {
  globalThis.fetch = async () => new Response("x".repeat(2_000_001), { status: 200 });
  await assert.rejects(loadDemo("/t3/"), /ceiling/);
});

test("a narration file that does not match its sha256 is refused", async () => {
  const stories = JSON.parse(readFileSync(new URL("../public/demo/stories.json", import.meta.url)));
  const n = stories.chapters[0].audio;
  const real = readFileSync(new URL(`../public/demo/${n.src}`, import.meta.url));
  globalThis.fetch = async () => new Response(real, { status: 200 });
  const url = await loadAudio(n);
  assert.match(url, /^blob:/);
  const bad = Buffer.from(real); bad[5000] ^= 1;
  globalThis.fetch = async () => new Response(bad, { status: 200 });
  await assert.rejects(loadAudio(n), /sha256/);
});

// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Loads the fixtures exported by scripts/export_demo.py. Our own files are
// still untrusted: every one is size capped, fetched with a timeout, checked
// against the sha256 in manifest.json and shape validated before render.

import type { Rules } from "./guard.ts";
import { FEATURES, type Row } from "./tuner.ts";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;

export interface Draft {
  attempt: number;
  title: string;
  text: string;
  violations: string[];
}
export interface Chapter {
  night: string;
  title: string;
  text: string;
  knobs: { target_words: number; pace_wpm: number; calm_level: number; cast: string[]; is_sequel: boolean };
  attempts: number;
  rejected: Draft[];
  gen_ms: number;
  eval_tokens: number;
  features: Record<string, number>;
}
export interface Night {
  index: number;
  night: string;
  request: string;
  exit: number;
  seconds: number;
  failure: string;
  refused_drafts: Draft[];
  fallback: string;
}
export interface Stories {
  model: string;
  runtime: string;
  recorded: string;
  note: string;
  child: { name: string; age: number; loves: string[]; avoid: string[]; sample: boolean };
  nights: Night[];
  chapters: Chapter[];
  bible: { characters: Array<{ name: string; description: string; first_seen: string }>; chapters: Array<{ night: string; title: string; summary: string; cast: string[]; open_thread: string }> };
}
export interface SampleLog {
  sample: true;
  note: string;
  rows: Array<Row & { night: string; title: string }>;
}
export interface GridPoint {
  target_words: number;
  pace_wpm: number;
  calm_level: number;
  is_sequel: number;
  knn: number;
  tabpfn: number | null;
}
export interface TunerData {
  sample: true;
  baseline_minutes: number;
  grid: GridPoint[];
  loo: { rows: number; mean_baseline_mae: number; knn_mae: number; tabpfn_mae: number | null; tabpfn_error: string | null };
  tabpfn_version: string | null;
}
export interface GuardCase {
  name: string;
  title: string;
  text: string;
  avoid: string[];
  expect: { ok: boolean; violations: string[] };
}
export type GuardData = Rules & { cases: GuardCase[] };

export interface Demo {
  stories: Stories;
  log: SampleLog;
  tuner: TunerData;
  guard: GuardData;
}

class DemoError extends Error {}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-cache" });
    if (!res.ok) throw new DemoError(`${url}: HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_BYTES) throw new DemoError(`${url}: ${len} bytes is over the ceiling`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new DemoError(`${url}: over the size ceiling`);
    return buf;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new DemoError(`${url}: timed out after ${TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArr = Array.isArray;
function need(cond: unknown, what: string): asserts cond {
  if (!cond) throw new DemoError(`fixture failed validation: ${what}`);
}

function validate(d: Demo): Demo {
  const s = d.stories;
  need(isStr(s.model) && isArr(s.chapters) && s.chapters.length <= 200 && isArr(s.nights), "stories");
  for (const c of s.chapters) {
    need(isStr(c.title) && isStr(c.text) && c.text.length < 20_000 && isStr(c.night) && isNum(c.knobs?.pace_wpm), "chapter");
    need(isArr(c.rejected) && c.rejected.every((r) => isStr(r.text) && isArr(r.violations)), "rejected drafts");
  }
  need(s.child && isStr(s.child.name) && isArr(s.child.avoid), "child");
  need(isArr(d.log.rows) && d.log.rows.length <= 5000 && d.log.sample === true, "log");
  for (const r of d.log.rows) need(FEATURES.every((f) => isNum(r[f])) && isNum(r.minutes_to_asleep), "log row");
  need(isArr(d.tuner.grid) && d.tuner.grid.length === 72 && d.tuner.grid.every((g) => isNum(g.knn)), "tuner grid");
  need(isArr(d.guard.banned) && isArr(d.guard.cases) && d.guard.banned.every(isStr), "guard rules");
  return d;
}

const cache = new Map<string, Promise<Demo>>();

export function loadDemo(base = "/demo/"): Promise<Demo> {
  const hit = cache.get(base);
  if (hit) return hit;
  const p = (async () => {
    const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes(`${base}manifest.json`))) as {
      files: Record<string, { sha256: string; bytes: number }>;
    };
    const names = ["stories.json", "log.json", "tuner.json", "guard.json"] as const;
    const parsed = await Promise.all(
      names.map(async (n) => {
        const want = manifest.files?.[n]?.sha256;
        need(isStr(want) && /^[0-9a-f]{64}$/.test(want), `manifest entry for ${n}`);
        const buf = await fetchBytes(`${base}${n}`);
        const got = await sha256(buf);
        if (got !== want) throw new DemoError(`${n} does not match its sha256 in manifest.json`);
        return JSON.parse(new TextDecoder().decode(buf));
      }),
    );
    return validate({ stories: parsed[0], log: parsed[1], tuner: parsed[2], guard: parsed[3] });
  })();
  cache.set(base, p);
  p.catch(() => cache.delete(base));
  return p;
}

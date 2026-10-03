// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// TypeScript port of nightjar/guard.py. Same rules, same order, same messages:
// web/test/parity.test.mjs holds it to the Python verdicts in demo/guard.json.

export const MAX_TEXT_CHARS = 20_000;
export const MAX_AVOID_TERMS = 64;
export const MAX_TERM_CHARS = 64;

export interface Rules {
  banned: string[];
  banned_phrases: string[];
  meta: string[];
  scaffolding: string[];
}

export interface Verdict {
  ok: boolean;
  violations: string[];
}

const WORD_RE = /[a-z']+/g;
const INVISIBLE = /[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
const APOSTROPHES: Record<string, string> = { "\u2018": "'", "\u2019": "'", "\u02bc": "'", "\uff07": "'" };

export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/[\u2018\u2019\u02bc\uff07]/g, (c) => APOSTROPHES[c] ?? c)
    .toLowerCase();
}

/** Code point length, so the ceiling matches Python's len(). */
function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** Python str.strip(): Unicode whitespace both ends. */
function pyStrip(s: string): string {
  return s.replace(/^[\s\u001c-\u001f\u0085]+|[\s\u001c-\u001f\u0085]+$/gu, "");
}

function pyRepr(s: string): string {
  return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/'/g, "\\'")}'`;
}

export interface CheckOptions {
  avoid?: string[];
  maxWords?: number;
  minWords?: number;
  alsoScreen?: string;
}

export function check(rules: Rules, text: unknown, opts: CheckOptions = {}): Verdict {
  const { avoid = [], maxWords = 900, minWords = 60, alsoScreen = "" } = opts;
  if (typeof text !== "string" || typeof alsoScreen !== "string") return { ok: false, violations: ["not text"] };
  if (cpLength(text) + cpLength(alsoScreen) > MAX_TEXT_CHARS) {
    return { ok: false, violations: [`input over ${MAX_TEXT_CHARS} characters`] };
  }
  const body = normalise(text);
  const lowered = normalise(`${alsoScreen}\n${text}`);
  const violations: string[] = [];
  const words = new Set(lowered.match(WORD_RE) ?? []);
  const bodyWords = body.match(WORD_RE) ?? [];

  for (const w of [...rules.banned].sort()) if (words.has(w)) violations.push(`banned word: ${w}`);
  for (const p of rules.banned_phrases) if (lowered.includes(p)) violations.push(`banned phrase: ${p}`);

  for (const term of avoid.slice(0, MAX_AVOID_TERMS)) {
    if (typeof term !== "string") continue;
    const t = [...pyStrip(normalise(term))].slice(0, MAX_TERM_CHARS).join("");
    if (t && lowered.includes(t)) violations.push(`personal avoid-list term: ${t}`);
  }
  for (const p of rules.meta) if (lowered.includes(p)) violations.push(`model meta-talk: ${p}`);
  for (const m of rules.scaffolding) {
    if (text.includes(m) || alsoScreen.includes(m)) {
      violations.push(`raw model scaffolding: ${pyRepr(pyStrip(m))}`);
      break;
    }
  }
  if (bodyWords.length > maxWords) violations.push(`too long: ${bodyWords.length} words > ${maxWords}`);
  if (bodyWords.length < minWords) violations.push(`too short: ${bodyWords.length} words < ${minWords}`);
  return { ok: violations.length === 0, violations };
}

/** Character ranges in `text` that tripped a rule, for highlighting. */
export function hits(rules: Rules, text: string, avoid: string[] = []): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const lower = text.toLowerCase();
  const terms = [...rules.banned, ...rules.banned_phrases, ...rules.meta, ...avoid.map((a) => a.trim().toLowerCase()).filter(Boolean)];
  for (const t of terms) {
    const re = new RegExp(t.includes(" ") || t.length > 12 ? escapeRe(t) : `\\b${escapeRe(t)}\\b`, "g");
    for (const m of lower.matchAll(re)) if (m.index !== undefined) out.push([m.index, m.index + m[0].length]);
  }
  for (const s of rules.scaffolding) {
    let i = text.indexOf(s);
    while (i >= 0) {
      out.push([i, i + s.length]);
      i = text.indexOf(s, i + s.length);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Port of guard.screen_request: words in a child's request to soften, not refuse. */
export function screenRequest(rules: Rules, request: unknown, avoid: string[] = []): string[] {
  if (typeof request !== "string") return [];
  const lowered = normalise([...request].slice(0, MAX_TERM_CHARS * 8).join(""));
  const words = new Set(lowered.match(WORD_RE) ?? []);
  const found = [...rules.banned].sort().filter((w) => words.has(w));
  for (const p of rules.banned_phrases) if (lowered.includes(p)) found.push(p);
  for (const term of avoid.slice(0, MAX_AVOID_TERMS)) {
    if (typeof term !== "string") continue;
    const t = [...pyStrip(normalise(term))].slice(0, MAX_TERM_CHARS).join("");
    if (t && lowered.includes(t) && !found.includes(t)) found.push(t);
  }
  return found;
}

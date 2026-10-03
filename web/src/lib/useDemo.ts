// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { loadDemo, type Chapter, type Demo } from "./data";
import { check } from "./guard.ts";

type State = { status: "loading" } | { status: "ready"; demo: Demo } | { status: "error"; error: string };

const Ctx = createContext<State>({ status: "loading" });

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    loadDemo()
      .then((demo) => alive && setState({ status: "ready", demo }))
      .catch((e: unknown) => alive && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, []);
  return createElement(Ctx.Provider, { value: state }, children);
}

export const useDemo = () => useContext(Ctx);

/** Does this recorded chapter pass the guardrail as it stands today? */
export function passesNow(d: Demo, c: Chapter): { ok: boolean; violations: string[] } {
  return check(d.guard, c.text, { avoid: d.stories.child.avoid, alsoScreen: c.title, maxWords: Math.round(c.knobs.target_words * 1.8) });
}

/** Derived numbers every page quotes, computed once from the fixtures. */
export function stats(d: Demo) {
  const ch = d.stories.chapters;
  const refusedNights = d.stories.nights.filter((n) => n.exit !== 0);
  const rejected = ch.reduce((s, c) => s + c.rejected.length, 0) + refusedNights.reduce((s, n) => s + n.refused_drafts.length, 0);
  const attempts = ch.reduce((s, c) => s + c.attempts, 0) + refusedNights.reduce((s, n) => s + n.refused_drafts.length, 0);
  const avgSec = ch.reduce((s, c) => s + c.gen_ms, 0) / Math.max(1, ch.length) / 1000;
  const words = ch.map((c) => c.features.word_count);
  const slipped = ch.filter((c) => !passesNow(d, c).ok);
  return {
    slipped,
    chapters: ch.length,
    nights: d.stories.nights.length,
    refusedNights: refusedNights.length,
    rejected,
    attempts,
    avgSec,
    minWords: Math.min(...words),
    maxWords: Math.max(...words),
    leaks: ch.reduce((s, c) => s + c.rejected.filter((r) => r.violations.some((v) => v.startsWith("raw model scaffolding"))).length, 0),
  };
}

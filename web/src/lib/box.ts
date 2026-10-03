// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Talks to `nightjar serve` when this page is served by the laptop box.
// Every call has a timeout and every answer is shape checked.

import type { Chapter } from "./data";

export interface Health {
  ok: true;
  model: string;
  ollama: boolean;
  narration: string;
  busy: boolean;
  name: string;
  loves: string[];
}

export type Stage = "queued" | "tuning" | "writing" | "rewriting" | "narrating" | "done" | "refused" | "error";
export interface Job {
  stage: Stage;
  attempt?: number;
  last_refusal?: string[];
  soften?: string[];
  error?: string;
  chapter?: Chapter;
}

async function call<T>(path: string, init: RequestInit = {}, ms = 4000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(path, { ...init, signal: ctl.signal, headers: { "Content-Type": "application/json" } });
    const text = await res.text();
    if (text.length > 200_000) throw new Error("box answer too large");
    const body = JSON.parse(text) as T & { error?: string };
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(t);
  }
}

const STAGES = new Set<Stage>(["queued", "tuning", "writing", "rewriting", "narrating", "done", "refused", "error"]);

/** Null when this page is not being served by a Nightjar box (the public site). */
export async function boxHealth(): Promise<Health | null> {
  // The box only ever serves on this machine, so the public site never probes.
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) return null;
  try {
    const h = await call<Health>("/api/health", {}, 1500);
    return h && h.ok === true && typeof h.model === "string" && Array.isArray(h.loves) ? h : null;
  } catch {
    return null;
  }
}

export async function startStory(request: string): Promise<string> {
  const r = await call<{ job: string }>("/api/tonight", { method: "POST", body: JSON.stringify({ request: request.slice(0, 200) }) });
  if (!/^[0-9a-f]{16}$/.test(r.job)) throw new Error("bad job id");
  return r.job;
}

export async function pollJob(job: string): Promise<Job> {
  const j = await call<Job>(`/api/job/${job}`);
  if (!STAGES.has(j.stage)) throw new Error("bad job state");
  if (j.stage === "done") {
    const c = j.chapter;
    if (!c || typeof c.title !== "string" || typeof c.text !== "string" || c.text.length > 20_000) throw new Error("bad chapter");
    if (c.audio && (!/^api\/audio\/[0-9a-z-]{1,120}\.wav$/.test(c.audio.src) || !Array.isArray(c.audio.words))) c.audio = null;
  }
  return j;
}

export async function logAsleep(minutes: number): Promise<number> {
  const r = await call<{ ok: boolean; labelled: number }>("/api/asleep", { method: "POST", body: JSON.stringify({ minutes }) });
  return r.labelled;
}

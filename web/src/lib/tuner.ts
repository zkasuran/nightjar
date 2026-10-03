// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// TypeScript port of the k-NN backend in nightjar/tune.py, so the tuner runs
// live in the browser on whatever rows the visitor edits. TabPFN cannot run
// here; its grid predictions are exported from Python and shown as such.

export const FEATURES = [
  "word_count",
  "sentence_count",
  "avg_sentence_len",
  "fk_grade",
  "pace_wpm",
  "calm_level",
  "is_sequel",
  "cast_size",
  "bedtime_hour",
  "narration_seconds",
] as const;
export type Feature = (typeof FEATURES)[number];
export type Row = Record<Feature, number> & { minutes_to_asleep: number };
export type Cand = Record<Feature, number>;

export const WORD_GRID = [220, 300, 380, 460];
export const PACE_GRID = [95, 110, 125];
export const CALM_GRID = [3, 4, 5];
export const SEQUEL_GRID = [0, 1];
export const BANDWIDTH = 0.6;

/** Python's round(): half to even. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
}

export interface Knobs {
  target_words: number;
  pace_wpm: number;
  calm_level: number;
  is_sequel: number;
}

export function candidates(history: Row[], castSize = 2): Array<{ knobs: Knobs; f: Cand }> {
  const mean = (c: Feature, d: number) => (history.length ? history.reduce((s, r) => s + r[c], 0) / history.length : d);
  const sent = mean("avg_sentence_len", 8);
  const fk = mean("fk_grade", 1.5);
  const hour = Math.trunc(mean("bedtime_hour", 19));
  const out: Array<{ knobs: Knobs; f: Cand }> = [];
  for (const w of WORD_GRID)
    for (const p of PACE_GRID)
      for (const c of CALM_GRID)
        for (const s of SEQUEL_GRID)
          out.push({
            knobs: { target_words: w, pace_wpm: p, calm_level: c, is_sequel: s },
            f: {
              word_count: w,
              sentence_count: Math.max(1, pyRound(w / sent)),
              avg_sentence_len: sent,
              fk_grade: fk,
              pace_wpm: p,
              calm_level: c,
              is_sequel: s,
              cast_size: Math.max(1, castSize),
              bedtime_hour: hour,
              narration_seconds: pyRound((w / p) * 60),
            },
          });
  return out;
}

/** Gaussian kernel weighted nearest neighbours, identical to tune._predict_knn. */
export function knn(history: Row[], cands: Cand[]): number[] {
  const mins = FEATURES.map((c) => Math.min(...history.map((r) => r[c])));
  const maxs = FEATURES.map((c) => Math.max(...history.map((r) => r[c])));
  const spans = mins.map((lo, i) => maxs[i] - lo || 1);
  const norm = (v: number[]) => v.map((x, i) => (x - mins[i]) / spans[i]);
  const hist = history.map((r) => [norm(FEATURES.map((c) => r[c])), r.minutes_to_asleep] as const);
  const avg = hist.reduce((s, [, t]) => s + t, 0) / hist.length;
  return cands.map((cand) => {
    const cv = norm(FEATURES.map((c) => cand[c]));
    let num = 0;
    let den = 0;
    for (const [hv, target] of hist) {
      let sq = 0;
      for (let i = 0; i < cv.length; i++) sq += (cv[i] - hv[i]) ** 2;
      const dist = Math.sqrt(sq);
      const w = Math.exp(-(dist ** 2) / (2 * BANDWIDTH ** 2));
      num += w * target;
      den += w;
    }
    return den ? num / den : avg;
  });
}

export interface Recommendation {
  best: number;
  preds: number[];
  baseline: number;
  grid: Array<{ knobs: Knobs; f: Cand }>;
}

export function recommend(history: Row[], castSize = 2): Recommendation | null {
  if (history.length < 2) return null;
  const grid = candidates(history, castSize);
  const preds = knn(history, grid.map((g) => g.f));
  let best = 0;
  for (let i = 1; i < preds.length; i++) if (preds[i] < preds[best]) best = i;
  const baseline = history.reduce((s, r) => s + r.minutes_to_asleep, 0) / history.length;
  return { best, preds, baseline, grid };
}

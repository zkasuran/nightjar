// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Failed, Loading, PageHead, Sample } from "../components/ui";
import type { Demo } from "../lib/data";
import { CALM_GRID, PACE_GRID, recommend, SEQUEL_GRID, WORD_GRID, type Row } from "../lib/tuner";
import { useDemo } from "../lib/useDemo";

function Num({ v, d = 1 }: { v: number; d?: number }) {
  const mv = useMotionValue(v);
  const t = useTransform(mv, (x) => x.toFixed(d));
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      mv.set(v);
      return;
    }
    const c = animate(mv, v, { duration: 0.5, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [v, mv, reduce]);
  return <motion.span className="num">{t}</motion.span>;
}

/** Fast (good) to slow (bad), per theme via CSS colour mixing. */
function colour(v: number, lo: number, hi: number) {
  const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
  return `color-mix(in oklab, var(--good) ${Math.round((1 - t) * 70)}%, var(--bad) ${Math.round(t * 70)}%)`;
}

type Backend = "knn" | "tabpfn";

function Body({ d }: { d: Demo }) {
  const original = useMemo(() => d.log.rows.map((r) => ({ ...r })), [d]);
  const [rows, setRows] = useState(original);
  const [backend, setBackend] = useState<Backend>(d.tuner.grid[0]?.tabpfn != null ? "tabpfn" : "knn");
  const [scan, setScan] = useState<number | null>(null);
  const [shown, setShown] = useState(true);
  const reduce = useReducedMotion();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const edited = JSON.stringify(rows) !== JSON.stringify(original);
  const useTab = backend === "tabpfn" && !edited && d.tuner.grid[0]?.tabpfn != null;

  const rec = useMemo(() => recommend(rows as Row[], 2), [rows]);
  const preds = useMemo(() => (useTab ? d.tuner.grid.map((g) => g.tabpfn as number) : rec?.preds ?? []), [useTab, d, rec]);
  const best = preds.length ? preds.indexOf(Math.min(...preds)) : -1;
  const lo = Math.min(...preds);
  const hi = Math.max(...preds);
  const baseline = rows.length ? rows.reduce((s, r) => s + r.minutes_to_asleep, 0) / rows.length : 0;
  const grid = rec?.grid ?? [];
  const bk = best >= 0 ? grid[best]?.knobs : undefined;

  const run = () => {
    if (timer.current) clearInterval(timer.current);
    if (reduce) {
      setShown(true);
      return;
    }
    setShown(false);
    let i = 0;
    timer.current = setInterval(() => {
      setScan(order[i]);
      i++;
      if (i >= order.length) {
        if (timer.current) clearInterval(timer.current);
        setScan(null);
        setShown(true);
      }
    }, 22);
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // index in the 72-grid for (words, pace, calm, sequel), matching the Python loop order
  const idx = (w: number, p: number, c: number, s: number) => ((WORD_GRID.indexOf(w) * PACE_GRID.length + PACE_GRID.indexOf(p)) * CALM_GRID.length + CALM_GRID.indexOf(c)) * SEQUEL_GRID.length + SEQUEL_GRID.indexOf(s);
  const order: number[] = [];
  for (const w of WORD_GRID) for (const c of CALM_GRID) for (const p of PACE_GRID) for (const s of SEQUEL_GRID) order.push(idx(w, p, c, s));

  const setMin = (i: number, v: number) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, minutes_to_asleep: Math.max(0, Math.min(240, Number.isFinite(v) ? v : 0)) } : r)));
  const remove = (i: number) => setRows((rs) => (rs.length > 2 ? rs.filter((_, k) => k !== i) : rs));
  const addTonight = () => {
    if (!bk || rows.length >= 60) return;
    const base = rows[rows.length - 1];
    setRows((rs) => [
      ...rs,
      { ...base, night: "tonight", title: "Tonight (you)", word_count: bk.target_words, pace_wpm: bk.pace_wpm, calm_level: bk.calm_level, is_sequel: bk.is_sequel, narration_seconds: Math.round((bk.target_words / bk.pace_wpm) * 60), minutes_to_asleep: 9 },
    ]);
  };

  return (
    <>
      <PageHead eyebrow="Try it · The tuner" title="Change one night. Watch tomorrow move.">
        Each row is a night: what the story was like and how long she took to fall asleep. The tuner scores all 72 story settings against those rows and picks the fastest.
      </PageHead>
      <section className="sec" style={{ paddingTop: 24 }}>
        <div className="wrap split wide-l">
          <div className="stack">
            <div className="card stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="stack" style={{ gap: 4 }}>
                  <span className="eyebrow">Tomorrow's pick</span>
                  {bk ? (
                    <h2 className="h-l" style={{ fontSize: 30 }}>{bk.target_words} words · {bk.pace_wpm} wpm · calm {bk.calm_level}/5 · {bk.is_sequel ? "sequel" : "new story"}</h2>
                  ) : (
                    <h2 className="h-m">Log at least two nights</h2>
                  )}
                </div>
                <div className="seg" role="group" aria-label="Model">
                  <button aria-pressed={backend === "tabpfn"} onClick={() => setBackend("tabpfn")} disabled={d.tuner.grid[0]?.tabpfn == null}>TabPFN</button>
                  <button aria-pressed={backend === "knn"} onClick={() => setBackend("knn")}>k-NN live</button>
                </div>
              </div>
              <div className="grid-3" style={{ gap: 12 }}>
                <div className="stat acc"><span className="v"><Num v={best >= 0 ? preds[best] : 0} /><span className="u">min</span></span><span className="k">predicted to sleep</span></div>
                <div className="stat"><span className="v"><Num v={baseline} /><span className="u">min</span></span><span className="k">average so far</span></div>
                <div className="stat"><span className="v"><Num v={best >= 0 ? baseline - preds[best] : 0} /><span className="u">min</span></span><span className="k">faster than average</span></div>
              </div>
              <p className="t-xs">
                {useTab
                  ? `TabPFN ${d.tuner.tabpfn_version ?? ""} ran these 72 predictions in Python on the sample log. Built with PriorLabs-TabPFN.`
                  : backend === "tabpfn" && edited
                    ? "You edited the log, so this is the k-NN model running live in your browser. TabPFN only ran in Python on the original rows."
                    : "k-NN with a Gaussian kernel, running live in your browser. Same maths as tune.py, held to it by a parity test."}
              </p>
            </div>

            <div className="card stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 className="h-s">All 72 settings, scored</h3>
                <button className="btn sm primary" onClick={run}>Run the tuner</button>
              </div>
              <div className="heat" role="grid" aria-label="Predicted minutes to sleep for every setting">
                <span />
                {PACE_GRID.flatMap((p) => SEQUEL_GRID.map((s) => <span key={`${p}${s}`} className="hd">{p} wpm<br />{s ? "sequel" : "new"}</span>))}
                {WORD_GRID.flatMap((w) =>
                  CALM_GRID.map((c) => (
                    <div key={`${w}-${c}`} style={{ display: "contents" }}>
                      <span className="rl">{w}w · calm {c}</span>
                      {PACE_GRID.flatMap((p) =>
                        SEQUEL_GRID.map((s) => {
                          const i = idx(w, p, c, s);
                          const v = preds[i];
                          const on = shown || order.indexOf(i) <= order.indexOf(scan ?? -1);
                          return (
                            <motion.span
                              key={i}
                              role="gridcell"
                              className={`cell ${shown && i === best ? "best" : ""} ${scan === i ? "scan" : ""}`}
                              style={{ background: on && v !== undefined ? colour(v, lo, hi) : "var(--panel-2)" }}
                              title={v !== undefined ? `${w} words, ${p} wpm, calm ${c}, ${s ? "sequel" : "new"}: ${v.toFixed(2)} min` : ""}
                              animate={shown && i === best && !reduce ? { scale: [1, 1.14, 1.06] } : { scale: 1 }}
                              transition={{ duration: 0.5 }}
                            >
                              {on && v !== undefined ? v.toFixed(1) : ""}
                            </motion.span>
                          );
                        }),
                      )}
                    </div>
                  )),
                )}
              </div>
              <div className="legend">
                <span>falls asleep faster</span>
                <span className="ramp" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--good) 70%, transparent), color-mix(in oklab, var(--bad) 70%, transparent))" }} />
                <span>slower</span>
              </div>
            </div>
          </div>

          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 className="h-s">The bedtime log</h3>
              <Sample />
            </div>
            <p className="t-s">Edit any minutes value. The pick on the left recomputes instantly. {d.log.note}</p>
            <div className="tbl-scroll">
              <table className="data">
                <thead>
                  <tr><th>Night</th><th className="n">Words</th><th className="n">wpm</th><th className="n">Calm</th><th className="n">Asleep in</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <motion.tr key={`${r.night}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <td><b style={{ fontSize: 13 }}>{r.title.replace(" (sample)", "")}</b><br /><span className="t-xs">{r.night}</span></td>
                      <td className="n">{r.word_count}</td>
                      <td className="n">{r.pace_wpm}</td>
                      <td className="n">{r.calm_level}</td>
                      <td className="n"><input type="number" min={0} max={240} value={r.minutes_to_asleep} aria-label={`Minutes to sleep, ${r.title}`} onChange={(e) => setMin(i, Number(e.target.value))} /></td>
                      <td><button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => remove(i)} aria-label={`Remove ${r.title}`} disabled={rows.length <= 2}>×</button></td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <button className="btn sm" onClick={addTonight} disabled={!bk}>Log tonight with the pick</button>
              <button className="btn sm" onClick={() => setRows(original)} disabled={!edited}>Reset</button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function Tuner() {
  const st = useDemo();
  if (st.status === "loading") return <div className="wrap sec"><Loading /></div>;
  if (st.status === "error") return <div className="wrap sec"><Failed what="The sleep log" err={st.error} /></div>;
  return <Body d={st.demo} />;
}

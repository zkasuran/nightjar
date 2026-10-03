// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Storybox } from "../components/Storybox";
import { Failed, Loading, PageHead, Real, Sample } from "../components/ui";
import type { Demo } from "../lib/data";
import { passesNow, useDemo } from "../lib/useDemo";

function Body({ d }: { d: Demo }) {
  const nights = d.stories.nights;
  const byNight = new Map(d.stories.chapters.map((c) => [c.night, c]));
  const [sel, setSel] = useState(nights[0]?.night ?? "");
  const night = nights.find((n) => n.night === sel) ?? nights[0];
  const ch = byNight.get(night.night);
  return (
    <>
      <PageHead eyebrow="Try it · Tonight's chapter" title="Eight nights, recorded for real">
        Every chapter below came out of the shipped command line with {d.stories.model} on a CPU laptop. Press play to hear it at the pace the tuner chose.
      </PageHead>
      <section className="sec" style={{ paddingTop: 24 }}>
        <div className="wrap split wide-r">
          <div className="stack">
            <div className="row"><Real>Real model output</Real><Sample>Sample child profile</Sample></div>
            <div className="nights" role="list">
              {nights.map((n) => {
                const c = byNight.get(n.night);
                return (
                  <motion.button key={n.night} role="listitem" className={`night ${n.exit ? "fail" : ""}`} aria-pressed={n.night === night.night} onClick={() => setSel(n.night)} whileTap={{ scale: 0.98 }}>
                    <span className="idx">{n.index}</span>
                    <span style={{ minWidth: 0 }}>
                      <b>{c ? c.title : "No new chapter"}</b>
                      <span>"{n.request}"</span>
                    </span>
                    {n.exit ? <span className="chip bad">refused</span> : c && !passesNow(d, c).ok ? <span className="chip bad">slipped</span> : c && c.attempts > 1 ? <span className="chip acc">{c.attempts} tries</span> : <span className="chip good">1 try</span>}
                  </motion.button>
                );
              })}
            </div>
            <p className="t-xs">{d.stories.note}</p>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={night.night} className="stack" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.3 }}>
              {ch ? (
                <>
                  <Storybox chapter={ch} label={`Night ${night.index} · "${night.request}"`} passes={passesNow(d, ch).ok} />
                  {!passesNow(d, ch).ok && (
                    <div className="card tight stack" style={{ borderColor: "var(--bad)" }}>
                      <span className="chip bad" style={{ justifySelf: "start" }}>Slipped through when recorded</span>
                      <p className="t-s">This chapter passed the guardrail on the night. Reading the run back, it ends with the prompt's own field name read aloud ({passesNow(d, ch).violations.join("; ")}). That became a new rule, so today it would be refused and rewritten.</p>
                    </div>
                  )}
                  <div className="grid-4">
                    <div className="stat"><span className="v" style={{ fontSize: 28 }}>{ch.features.word_count}</span><span className="k">words</span></div>
                    <div className="stat"><span className="v" style={{ fontSize: 28 }}>{ch.features.fk_grade}</span><span className="k">reading grade</span></div>
                    <div className="stat"><span className="v" style={{ fontSize: 28 }}>{(ch.gen_ms / 1000).toFixed(0)}s</span><span className="k">to write, all tries</span></div>
                    <div className="stat"><span className="v" style={{ fontSize: 28 }}>{ch.attempts}</span><span className="k">attempt{ch.attempts > 1 ? "s" : ""}</span></div>
                  </div>
                  <div className="card tight stack">
                    <h3 className="h-s">Knobs the tuner set for this night</h3>
                    <div className="row">
                      <span className="chip">target {ch.knobs.target_words} words</span>
                      <span className="chip">{ch.knobs.pace_wpm} wpm</span>
                      <span className="chip">calm {ch.knobs.calm_level}/5</span>
                      <span className="chip">{ch.knobs.is_sequel ? "sequel" : "standalone"}</span>
                      {ch.knobs.cast.map((c) => <span key={c} className="chip acc">{c}</span>)}
                    </div>
                    <p className="t-xs">The model wrote {ch.features.word_count} words against a target of {ch.knobs.target_words}. Length control on a 1B model is weak, see Limits.</p>
                  </div>
                  {ch.rejected.length > 0 && <Drafts drafts={ch.rejected} />}
                </>
              ) : (
                <div className="card stack">
                  <span className="chip bad" style={{ justifySelf: "start" }}>No new chapter tonight</span>
                  <h2 className="h-m">"{night.request}"</h2>
                  <p className="lede">The guardrail refused all {night.refused_drafts.length} drafts. {night.fallback ? `Nightjar said: ${night.fallback}.` : ""}</p>
                  <Drafts drafts={night.refused_drafts} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>
    </>
  );
}

function Drafts({ drafts }: { drafts: Demo["stories"]["chapters"][number]["rejected"] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="card tight stack">
      <h3 className="h-s">Drafts the guardrail refused (redacted)</h3>
      {drafts.map((dr) => (
        <div key={dr.attempt} className="inset stack" style={{ gap: 8 }}>
          <button className="row" style={{ justifyContent: "space-between", background: "none", border: 0, cursor: "pointer", padding: 0, textAlign: "left" }} onClick={() => setOpen(open === dr.attempt ? null : dr.attempt)} aria-expanded={open === dr.attempt}>
            <b>Attempt {dr.attempt}</b>
            <span className="row" style={{ gap: 6 }}>{dr.violations.map((v) => <span key={v} className="chip bad">{v}</span>)}</span>
          </button>
          <AnimatePresence>
            {open === dr.attempt && (
              <motion.p className="preview" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: "hidden", fontSize: 14 }}>
                {dr.text || "(empty)"}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

export function Story() {
  const st = useDemo();
  if (st.status === "loading") return <div className="wrap sec"><Loading /></div>;
  if (st.status === "error") return <div className="wrap sec"><Failed what="The recorded series" err={st.error} /></div>;
  return <Body d={st.demo} />;
}

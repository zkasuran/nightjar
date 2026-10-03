// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Sky } from "../components/Sky";
import { Storybox } from "../components/Storybox";
import { Code, CountUp, Failed, Loading, Real, Reveal, Sample, SectionHead } from "../components/ui";
import type { Demo } from "../lib/data";
import { passesNow, stats, useDemo } from "../lib/useDemo";

export const LOOP = [
  { k: "Ask", t: "She asks for tonight's story", d: "One button, one sentence. \"Can the moon come down and visit?\"" },
  { k: "Recall", t: "The series bible remembers", d: "Who exists, what happened last night and the thread left loose." },
  { k: "Write", t: "Gemma writes on the laptop", d: "An open model running locally through Ollama. No network call." },
  { k: "Screen", t: "A hard guardrail reads it first", d: "Banned words, her own fear list and leaked JSON. Fail means rewrite." },
  { k: "Read", t: "The box reads it aloud", d: "At the pace the tuner picked for tonight, in a consented voice." },
  { k: "Log", t: "One tap when she is asleep", d: "Minutes to sleep. The only number a tired parent will reliably give." },
  { k: "Tune", t: "Tomorrow's knobs get picked", d: "TabPFN scores 72 story settings against every logged night." },
];

function Loop() {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (hold || reduce) return;
    const t = setInterval(() => setI((x) => (x + 1) % LOOP.length), 2600);
    return () => clearInterval(t);
  }, [hold, reduce]);
  const R = 120;
  const pos = (k: number) => {
    const a = (k / LOOP.length) * Math.PI * 2 - Math.PI / 2;
    return [150 + R * Math.cos(a), 150 + R * Math.sin(a)];
  };
  const [cx, cy] = pos(i);
  return (
    <div className="loop-wrap">
      <div className="loop-steps" onMouseLeave={() => setHold(false)}>
        {LOOP.map((s, k) => (
          <button key={s.k} className={`loop-step ${k === i ? "on" : ""}`} onClick={() => { setI(k); setHold(true); }} onMouseEnter={() => { setI(k); setHold(true); }} aria-pressed={k === i}>
            <span className="n">{k + 1}</span>
            <span>
              <b className="h-s" style={{ display: "block" }}>{s.t}</b>
              <AnimatePresence initial={false}>
                {k === i && (
                  <motion.span className="t-s" style={{ display: "block", overflow: "hidden" }} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
                    {s.d}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </button>
        ))}
      </div>
      <div className="card" style={{ display: "grid", placeItems: "center", padding: 16 }}>
        <svg viewBox="0 -18 300 336" width="100%" style={{ maxWidth: 420 }} role="img" aria-label={`Step ${i + 1} of 7: ${LOOP[i].t}`}>
          <circle cx="150" cy="150" r={R} fill="none" stroke="var(--edge)" strokeWidth="2" strokeDasharray="3 7" />
          <motion.circle cx="150" cy="150" r={R} fill="none" stroke="var(--acc)" strokeWidth="2.5" strokeLinecap="round" pathLength={1} animate={{ pathLength: (i + 1) / LOOP.length }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} style={{ rotate: -90, transformOrigin: "150px 150px" }} />
          {LOOP.map((s, k) => {
            const [x, y] = pos(k);
            return (
              <g key={s.k} style={{ cursor: "pointer" }} onClick={() => { setI(k); setHold(true); }}>
                <circle cx={x} cy={y} r={k === i ? 19 : 15} fill={k <= i ? "var(--acc)" : "var(--panel-2)"} stroke="var(--edge)" style={{ transition: "all 300ms" }} />
                <text x={x} y={y + 4.5} textAnchor="middle" fontSize="13" fontWeight="700" fill={k <= i ? "var(--acc-ink)" : "var(--muted)"} fontFamily="var(--font-ui)">{k + 1}</text>
                <text x={x} y={y + (y > 150 ? 36 : -26)} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink-2)" fontFamily="var(--font-ui)">{s.k}</text>
              </g>
            );
          })}
          <motion.circle r="6" fill="var(--acc-2)" animate={{ cx, cy }} transition={{ type: "spring", stiffness: 90, damping: 16 }} style={{ filter: "drop-shadow(0 0 6px var(--acc))" }} />
          <text x="150" y="146" textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--ink)" fontFamily="var(--font-display)">Every night</text>
          <text x="150" y="166" textAnchor="middle" fontSize="12" fill="var(--muted)" fontFamily="var(--font-ui)">one turn of the loop</text>
        </svg>
      </div>
    </div>
  );
}

function Body({ d }: { d: Demo }) {
  const s = stats(d);
  const reduce = useReducedMotion();
  const ch = d.stories.chapters.filter((c) => passesNow(d, c).ok);
  const refused = d.stories.nights.find((n) => n.exit !== 0);
  const pick = d.tuner.grid.reduce((a, b) => ((b.tabpfn ?? b.knn) < (a.tabpfn ?? a.knn) ? b : a));
  const thread = d.stories.bible.chapters.find((c) => c.open_thread)?.open_thread ?? "";
  return (
    <>
      <section className="hero">
        <Sky />
        <div className="wrap">
          <div className="copy">
            <motion.span className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>Built for one four year old</motion.span>
            <motion.h1 className="h-xl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
              Bedtime stories that learn what puts her to sleep.
            </motion.h1>
            <motion.p className="lede" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}>
              A new chapter every night, written by an open model on your own laptop. A hard guardrail reads every word first. Then it learns which stories get her to sleep faster.
            </motion.p>
            <motion.div className="row" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
              <a className="btn primary" href="#/ask">Ask for a story</a>
              <a className="btn" href="#/story">Hear a recorded chapter</a>
            </motion.div>
            <motion.div className="facts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
              <span className="chip acc">Gemma 3, local</span>
              <span className="chip">Works offline</span>
              <span className="chip">Nothing uploaded</span>
              <span className="chip">Built with PriorLabs-TabPFN</span>
            </motion.div>
          </div>
          <motion.div initial={{ opacity: 0, y: 24, rotate: 1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }} className={reduce ? undefined : "breathe"}>
            <Storybox chapter={ch[0]} autoplay={!reduce} childName={d.stories.child.name} label={`Night 1 · recorded with ${d.stories.model}`} endActions={<a className="btn sm primary" href="#/ask">Ask for a new one</a>} />
          </motion.div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap grid-4">
          {[
            { v: s.chapters, k: "chapters written by gemma3:1b on a CPU laptop", acc: true },
            { v: s.rejected, k: "drafts the guardrail refused before anyone heard them" },
            { v: 72, k: "story settings the tuner scores every night" },
            { v: s.avgSec, k: "seconds per chapter, including rewrites", dec: 0, u: "s" },
          ].map((x, i) => (
            <Reveal key={i} delay={i * 0.06} className={`stat ${x.acc ? "acc" : ""}`}>
              <span className="v"><CountUp to={x.v} decimals={x.dec ?? 0} />{x.u && <span className="u">{x.u}</span>}</span>
              <span className="k">{x.k}</span>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="sec" id="loop">
        <div className="wrap">
          <SectionHead eyebrow="The loop" title="Seven steps, one turn per night">
            Other story generators stop at step three. Nightjar keeps going until it knows whether the story worked.
          </SectionHead>
          <Loop />
        </div>
      </section>

      <section className="sec">
        <div className="wrap grid-3">
          <Reveal>
            <a className="card link" href="#/how/bible" style={{ height: "100%" }}>
              <span className="eyebrow">It remembers</span>
              <h3 className="h-m">Pim the Turtle comes back</h3>
              <p className="t-s">Every chapter writes back who was in it and one loose thread. Tomorrow starts there.</p>
              {thread && <p className="inset" style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>Loose thread: "{thread}"</p>}
            </a>
          </Reveal>
          <Reveal delay={0.06}>
            <a className="card link" href="#/guard" style={{ height: "100%" }}>
              <span className="eyebrow">It refuses</span>
              <h3 className="h-m">{s.rejected} drafts thrown away</h3>
              <p className="t-s">Too short, a scary word, her fear list or the model printing its own JSON. Any one of them means a rewrite before anyone hears it.</p>
              <div className="row"><span className="chip bad">too short</span><span className="chip bad">raw model scaffolding</span></div>
            </a>
          </Reveal>
          <Reveal delay={0.12}>
            <a className="card link" href="#/tuner" style={{ height: "100%" }}>
              <span className="eyebrow">It learns</span>
              <h3 className="h-m">Tonight: {pick.target_words} words at {pick.pace_wpm} wpm</h3>
              <p className="t-s">TabPFN predicts <b className="hl">{(pick.tabpfn ?? pick.knn).toFixed(1)} min</b> to sleep against a {d.tuner.baseline_minutes.toFixed(1)} min average.</p>
              <div className="row"><Sample>Sample sleep log</Sample></div>
            </a>
          </Reveal>
        </div>
      </section>

      {refused && (
        <section className="sec">
          <div className="wrap split wide-r" style={{ alignItems: "center" }}>
            <Reveal className="stack">
              <span className="eyebrow">Night {refused.index}</span>
              <h2 className="h-l">The night it said no</h2>
              <p className="lede">She asked for "{refused.request}". Every draft failed the guardrail, so nothing new was read aloud. Nightjar fell back to last night's chapter instead.</p>
              <div className="row"><Real>Recorded run</Real><a className="btn sm" href="#/reports/series">See all eight nights</a></div>
            </Reveal>
            <Reveal delay={0.08} className="card stack">
              {refused.refused_drafts.map((dr) => (
                <div key={dr.attempt} className="row" style={{ justifyContent: "space-between" }}>
                  <span className="t-s" style={{ fontWeight: 600 }}>Draft {dr.attempt}</span>
                  <span className="row" style={{ gap: 6 }}>{dr.violations.map((v) => <span key={v} className="chip bad">{v}</span>)}</span>
                </div>
              ))}
              <div className="divider" style={{ margin: 0 }} />
              <p className="t-s">{refused.fallback || "Fallback: read last night's chapter again."}</p>
            </Reveal>
          </div>
        </section>
      )}

      {!refused && s.slipped.length > 0 && (
        <section className="sec">
          <div className="wrap split wide-r" style={{ alignItems: "center" }}>
            <Reveal className="stack">
              <span className="eyebrow">Reading the run back</span>
              <h2 className="h-l">The {s.slipped.length} it missed</h2>
              <p className="lede">Every chapter passed on the night. Reading the transcripts the next morning, {s.slipped.length} of them ended by reading the prompt's own field name aloud. That is now a rule, and the regression test uses the real text.</p>
              <div className="row"><Real>Recorded run</Real><a className="btn sm" href="#/story">Read them</a></div>
            </Reveal>
            <Reveal delay={0.08} className="card stack">
              {s.slipped.map((c) => {
                const tail = c.text.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "";
                return (
                  <div key={c.night} className="stack" style={{ gap: 6 }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <b>{c.title}</b>
                      <span className="row" style={{ gap: 6 }}>{passesNow(d, c).violations.map((v) => <span key={v} className="chip bad">{v}</span>)}</span>
                    </div>
                    <p className="inset" style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>"...{tail.slice(-140)}"</p>
                  </div>
                );
              })}
            </Reveal>
          </div>
        </section>
      )}

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow="Why open weights" title="A closed API could not have built this">
            Not on principle. On four concrete problems.
          </SectionHead>
          <div className="grid-4">
            {[
              ["Her data stays home", "A child's name, fears and sleep times are the worst thing to post to someone else's server."],
              ["Free every night", "350 chapters a year cost nothing, so it becomes a habit and not a decision."],
              ["Works with the wifi down", "At 7:30 pm with a tired child, a broken promise costs more than a slow model."],
              ["Tuned to one child", "Her reading level, her fear list, her characters. You cannot reach inside a closed endpoint."],
            ].map(([t, b], i) => (
              <Reveal key={t} delay={i * 0.05} className="card tight stack" >
                <h3 className="h-s">{t}</h3>
                <p className="t-s">{b}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap split" style={{ alignItems: "center" }}>
          <Reveal className="stack">
            <span className="eyebrow">Run it tonight</span>
            <h2 className="h-l">Four commands on your laptop</h2>
            <p className="lede">Python 3.11 and Ollama. The core has no pip dependencies at all.</p>
            <div className="row"><a className="btn primary" href="#/developers/cli">Read the CLI guide</a><a className="btn" href="#/lab">Or try it in this tab</a></div>
          </Reveal>
          <Reveal delay={0.08}>
            <Code>{`ollama pull gemma3:1b
cp data/child.example.json data/child.json
python3 -m nightjar.cli tonight "the slow turtle"
python3 -m nightjar.cli asleep 14   # she was out in 14 minutes`}</Code>
          </Reveal>
        </div>
      </section>
    </>
  );
}

export function Home() {
  const st = useDemo();
  if (st.status === "loading") return <div className="wrap sec"><Loading h={520} /></div>;
  if (st.status === "error") return <div className="wrap sec"><Failed what="The recorded stories" err={st.error} /></div>;
  return <Body d={st.demo} />;
}

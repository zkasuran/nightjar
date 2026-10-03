// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { Failed, Loading, PageHead } from "../components/ui";
import type { Demo } from "../lib/data";
import { check, hits } from "../lib/guard";
import { useDemo } from "../lib/useDemo";

const MAX_INPUT = 6000;

function Highlight({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={i} className="mark">{text.slice(a, b)}</mark>);
    at = b;
  });
  out.push(text.slice(at));
  return <div className="preview">{out}</div>;
}

function Body({ d }: { d: Demo }) {
  const presets = useMemo(() => d.guard.cases.filter((c) => !c.name.startsWith("recorded chapter")).slice(0, 14), [d]);
  const [pi, setPi] = useState<number | null>(1);
  const [title, setTitle] = useState(presets[1]?.title ?? "");
  const [text, setText] = useState(presets[1]?.text ?? "");
  const [avoid, setAvoid] = useState<string[]>(d.stories.child.avoid);
  const [term, setTerm] = useState("");
  const v = useMemo(() => check(d.guard, text, { avoid, alsoScreen: title }), [d, text, avoid, title]);
  const ranges = useMemo(() => hits(d.guard, text, avoid), [d, text, avoid]);
  const preset = pi !== null ? presets[pi] : null;
  const pyAgrees = preset && preset.text === text && preset.title === title && JSON.stringify(preset.avoid) === JSON.stringify(avoid) ? JSON.stringify(preset.expect.violations) === JSON.stringify(v.violations) : null;

  const load = (i: number) => {
    setPi(i);
    setTitle(presets[i].title);
    setText(presets[i].text);
    setAvoid(presets[i].avoid.length ? presets[i].avoid : d.stories.child.avoid);
  };

  return (
    <>
      <PageHead eyebrow="Try it · Break the guardrail" title="Try to sneak a monster past it">
        The guardrail runs on the model's output, outside the model. Type anything or load one of the real tricks below. It runs in your browser, the same rules as the Python.
      </PageHead>
      <section className="sec" style={{ paddingTop: 24 }}>
        <div className="wrap split wide-r">
          <div className="stack">
            <h3 className="h-s">Load an attempt</h3>
            <div className="stack" style={{ gap: 6 }}>
              {presets.map((p, i) => (
                <button key={p.name} className="preset" aria-pressed={pi === i} onClick={() => load(i)}>
                  <b>{p.name}</b>
                  <span>{p.expect.ok ? "Python verdict: passes" : `Python verdict: ${p.expect.violations[0]}`}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="stack">
            <div className="card stack">
              <label className="field">Title (screened too, since it is read aloud)
                <input type="text" value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); setPi(null); }} />
              </label>
              <label className="field">Story draft
                <textarea rows={7} value={text} maxLength={MAX_INPUT} onChange={(e) => { setText(e.target.value); setPi(null); }} />
              </label>
              <div className="stack" style={{ gap: 8 }}>
                <span className="t-s" style={{ fontWeight: 600 }}>Her own fear list</span>
                <div className="row" style={{ gap: 6 }}>
                  {avoid.map((a) => (
                    <button key={a} className="chip acc" style={{ cursor: "pointer" }} onClick={() => setAvoid(avoid.filter((x) => x !== a))} aria-label={`Remove ${a}`}>{a} ×</button>
                  ))}
                  <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const t = term.trim().slice(0, 64); if (t && avoid.length < 64 && !avoid.includes(t)) setAvoid([...avoid, t]); setTerm(""); }}>
                    <input type="text" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="add a fear" style={{ width: 140, padding: "4px 10px" }} aria-label="Add a fear" />
                  </form>
                </div>
              </div>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={v.ok ? "ok" : "no"} className={`verdict ${v.ok ? "ok" : "no"}`} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} role="status">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>{v.ok ? <path d="M4 12.5 9.5 18 20 6.5" /> : <path d="M6 6l12 12M18 6 6 18" />}</svg>
                {v.ok ? "Passes. This would be read aloud." : `Refused. ${v.violations.length} rule${v.violations.length > 1 ? "s" : ""} broken, Nightjar asks for a rewrite.`}
                {pyAgrees !== null && <span className={`chip ${pyAgrees ? "good" : "bad"}`} style={{ marginLeft: "auto" }}>{pyAgrees ? "Python agrees" : "Python disagrees"}</span>}
              </motion.div>
            </AnimatePresence>
            {!v.ok && (
              <div className="row" style={{ gap: 6 }}>
                <AnimatePresence>
                  {v.violations.map((x, i) => (
                    <motion.span key={x} className="chip bad" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.04 }}>{x}</motion.span>
                  ))}
                </AnimatePresence>
              </div>
            )}
            <div className="card tight stack">
              <h3 className="h-s">What it caught</h3>
              <Highlight text={text} ranges={ranges} />
              <p className="t-xs">Text is normalised first (NFKC, zero width characters stripped, curly apostrophes folded), so a full width or hidden character spelling of a banned word is the same word. The highlight shows plain matches only.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function Guard() {
  const st = useDemo();
  if (st.status === "loading") return <div className="wrap sec"><Loading /></div>;
  if (st.status === "error") return <div className="wrap sec"><Failed what="The guardrail rules" err={st.error} /></div>;
  return <Body d={st.demo} />;
}

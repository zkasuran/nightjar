// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Sky } from "../components/Sky";
import { Storybox } from "../components/Storybox";
import { Failed, Loading } from "../components/ui";
import { boxHealth, logAsleep, pollJob, startStory, type Health, type Stage } from "../lib/box";
import type { Chapter, Demo } from "../lib/data";
import { check, screenRequest } from "../lib/guard";
import { useDemo } from "../lib/useDemo";
import type { In, Out } from "../workers/gemma";

const SYSTEM =
  "You are a gentle bedtime storyteller for one small child. You write calm, warm, slightly dull stories designed to help a child fall asleep. Nothing frightening ever happens. There is no danger, no villain, no peril and no loud noise. Problems are small and are solved kindly. The story ends with everyone safe, warm and already sleepy. Write simple short sentences a young child can follow. Never mention that you are an AI and never address the reader.";

/** Picture tiles a four year old can choose without reading. */
const TOPICS: Array<{ emoji: string; label: string; ask: string }> = [
  { emoji: "🐢", label: "Pim the turtle", ask: "Pim the turtle goes on a slow little walk" },
  { emoji: "🌙", label: "The moon", ask: "the moon comes down to visit" },
  { emoji: "❄️", label: "Snow", ask: "soft snow falling on the garden" },
  { emoji: "👢", label: "Red boots", ask: "my red boots go on a tiny adventure" },
  { emoji: "🐉", label: "A friendly dragon", ask: "a friendly little dragon who is very sleepy" },
  { emoji: "🚂", label: "A sleepy train", ask: "a sleepy train going home at night" },
  { emoji: "🧸", label: "Teddy", ask: "my teddy bear has a picnic under the stars" },
  { emoji: "🌊", label: "The sea", ask: "little waves at the beach at night" },
];

const STAGE_TEXT: Record<Stage, string> = {
  queued: "Getting ready",
  tuning: "Choosing tonight's pace",
  writing: "Writing your story",
  rewriting: "Making it gentler",
  narrating: "Warming up the voice",
  done: "Ready",
  refused: "No new story tonight",
  error: "Something went wrong",
};

type Mode = "checking" | "box" | "tab";
type Phase = { k: "pick" } | { k: "working"; stage: Stage; note?: string } | { k: "ready"; chapter: Chapter; soften: string[] } | { k: "refused" } | { k: "error"; msg: string };

function TabNote({ gpu }: { gpu: boolean | null }) {
  return (
    <p className="t-xs" style={{ textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
      This public page writes the story in your browser with Gemma 3 270M. The first time it downloads {gpu ? "about 280 MB" : "about 550 MB"} to this device and {gpu ? "takes under a minute" : "can take five minutes on a laptop without WebGPU"}. It reads along without a voice here. On the laptop box (<code className="mono">nightjar serve</code>) the story is ready in about a minute and read aloud.
    </p>
  );
}

function Body({ d }: { d: Demo }) {
  const [mode, setMode] = useState<Mode>("checking");
  const [health, setHealth] = useState<Health | null>(null);
  const [gpu, setGpu] = useState<boolean | null>(null);
  const [req, setReq] = useState("");
  const [phase, setPhase] = useState<Phase>({ k: "pick" });
  const [asleep, setAsleep] = useState<string>("");
  const worker = useRef<Worker | null>(null);
  const name = health?.name || d.stories.child.name;
  const avoid = d.stories.child.avoid;
  const soften = screenRequest(d.guard, req, avoid);

  useEffect(() => {
    boxHealth().then((h) => {
      setHealth(h);
      setMode(h ? "box" : "tab");
    });
    (async () => {
      try {
        const g = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        setGpu(!!g && !!(await g.requestAdapter()));
      } catch {
        setGpu(false);
      }
    })();
    return () => worker.current?.terminate();
  }, []);

  const makeBox = async (ask: string) => {
    setPhase({ k: "working", stage: "queued" });
    try {
      const job = await startStory(ask);
      const started = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await pollJob(job);
        if (j.stage === "done" && j.chapter) {
          try {
            sessionStorage.setItem("nightjar-voice", "1");
          } catch {
            /* voice still available by tapping */
          }
          return setPhase({ k: "ready", chapter: j.chapter, soften: j.soften ?? [] });
        }
        if (j.stage === "refused") return setPhase({ k: "refused" });
        if (j.stage === "error") return setPhase({ k: "error", msg: j.error ?? "unknown error" });
        setPhase({ k: "working", stage: j.stage, note: j.stage === "rewriting" ? `Try ${j.attempt}` : undefined });
        if (Date.now() - started > 15 * 60_000) return setPhase({ k: "error", msg: "That took too long. Is Ollama running?" });
      }
    } catch (e) {
      setPhase({ k: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const makeTab = (ask: string) => {
    worker.current?.terminate();
    const w = new Worker(new URL("../workers/gemma.ts", import.meta.url), { type: "module" });
    worker.current = w;
    let text = "";
    let tries = 0;
    const prompt = [
      `Tonight you are writing for ${name}, who is ${d.stories.child.age} years old.`,
      `${name} asked for this tonight, and the story must be about it: ${ask}.`,
      soften.length ? `Some of that could feel scary (${soften.join(", ")}). Keep the idea but make it friendly, small and gentle. Do not use those words.` : "",
      "Write about 120 words. Very quiet; almost nothing happens. Short sentences. End with everyone safe and asleep.",
      "Put a short title on the first line, then the story. No other text.",
    ].filter(Boolean).join("\n");
    const generate = () => {
      tries++;
      text = "";
      setPhase({ k: "working", stage: tries > 1 ? "rewriting" : "writing", note: tries > 1 ? `Try ${tries}` : undefined });
      w.postMessage({ type: "generate", system: SYSTEM, prompt, maxTokens: 400 } satisfies In);
    };
    w.onmessage = (e: MessageEvent<Out>) => {
      const m = e.data;
      if (m.type === "progress") setPhase({ k: "working", stage: "queued", note: m.total ? `Downloading the story model, ${Math.round((m.loaded / m.total) * 100)}%` : undefined });
      else if (m.type === "ready") generate();
      else if (m.type === "token") text += m.text;
      else if (m.type === "done") {
        const raw = (m.text.trim() ? m.text : text).replace(/```[a-z]*\n?/g, "");
        const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
        const title = lines.length > 1 && lines[0].length < 70 ? lines[0].replace(/^[#*[\]"\s]+|[*[\]"\s]+$/g, "") : "Tonight's Chapter";
        const body = (lines.length > 1 && lines[0].length < 70 ? lines.slice(1) : lines).join("\n");
        const v = check(d.guard, body, { avoid, alsoScreen: title, minWords: 40 });
        if (!v.ok) return tries < 3 ? generate() : setPhase({ k: "refused" });
        setPhase({
          k: "ready",
          soften,
          chapter: {
            night: new Date().toISOString().slice(0, 10),
            title,
            text: body,
            knobs: { target_words: 120, pace_wpm: 95, calm_level: 5, cast: [], is_sequel: false },
            attempts: tries,
            rejected: [],
            gen_ms: m.ms,
            eval_tokens: m.tokens,
            features: { word_count: body.split(/\s+/).length },
            audio: null,
          },
        });
      } else if (m.type === "error") setPhase({ k: "error", msg: m.message });
    };
    w.onerror = (e) => setPhase({ k: "error", msg: e.message || "the story model crashed" });
    setPhase({ k: "working", stage: "queued", note: "Starting the story model" });
    w.postMessage({ type: "load", model: "onnx-community/gemma-3-270m-it-ONNX", device: gpu ? "webgpu" : "wasm", dtype: gpu ? "q4f16" : "q8" } satisfies In);
  };

  const go = (ask: string) => {
    const a = ask.trim().slice(0, 200);
    if (!a) return;
    setReq(a);
    if (mode === "box") makeBox(a);
    else makeTab(a);
  };

  const sleepButtons = mode === "box" && phase.k === "ready" && (
    <span className="row" style={{ gap: 6 }}>
      {asleep ? (
        <span className="chip good">{asleep}</span>
      ) : (
        <>
          <span className="t-xs">Grown-ups: asleep in</span>
          {[5, 10, 15, 20, 30].map((n) => (
            <button key={n} className="chip" style={{ cursor: "pointer" }} onClick={() => logAsleep(n).then((c) => setAsleep(`Logged ${n} min. ${c} nights in the loop.`)).catch((e) => setAsleep(`Not logged: ${e.message}`))}>
              {n}
            </button>
          ))}
        </>
      )}
    </span>
  );

  return (
    <section className="hero ask" style={{ minHeight: "calc(100vh - var(--hdr))" }}>
      <Sky stars={90} />
      <div className="wrap ask-wrap">
        <AnimatePresence mode="wait">
          {phase.k === "pick" && (
            <motion.div key="pick" className="stack" style={{ gap: 24 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.35 }}>
              <div style={{ textAlign: "center" }} className="stack">
                <span className="eyebrow">{mode === "box" ? `Nightjar box · ${health?.model}` : mode === "tab" ? "In this browser" : "Looking for the box"}</span>
                <h1 className="h-xl">What story tonight, {name}?</h1>
              </div>
              <div className="tiles" role="list">
                {TOPICS.map((t, i) => (
                  <motion.button key={t.label} role="listitem" className="tile" onClick={() => go(t.ask)} disabled={mode === "checking" || (mode === "tab" && gpu === null)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }} whileHover={{ y: -4 }} whileTap={{ scale: 0.95 }} aria-label={`A story about ${t.label}`}>
                    <span className="tile-emoji" aria-hidden>{t.emoji}</span>
                    <span>{t.label}</span>
                  </motion.button>
                ))}
              </div>
              <form className="ask-form" onSubmit={(e) => { e.preventDefault(); go(req); }}>
                <input type="text" value={req} maxLength={200} onChange={(e) => setReq(e.target.value)} placeholder="Or tell me what it should be about" aria-label="What should the story be about" />
                <button className="btn primary" disabled={!req.trim() || mode === "checking" || (mode === "tab" && gpu === null)}>Make my story</button>
              </form>
              <AnimatePresence>
                {soften.length > 0 && (
                  <motion.p className="soft-note" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    Nightjar keeps bedtime cozy. Anything scary, like "{soften.join('" or "')}", turns soft and friendly.
                  </motion.p>
                )}
              </AnimatePresence>
              {mode === "tab" && <TabNote gpu={gpu} />}
              {mode === "box" && health && !health.ollama && <p className="soft-note">The story model is not running on this laptop. Start it with <code className="mono">ollama serve</code>.</p>}
            </motion.div>
          )}

          {phase.k === "working" && (
            <motion.div key="working" className="working" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} role="status" aria-live="polite">
              <motion.div className="orb" animate={{ scale: [1, 1.08, 1], opacity: [0.85, 1, 0.85] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
                <svg viewBox="0 0 64 64" width="96" height="96" aria-hidden><path d="M44 10a24 24 0 1 0 10 34A20 20 0 0 1 44 10z" fill="var(--acc)" /></svg>
              </motion.div>
              <AnimatePresence mode="wait">
                <motion.h2 key={phase.stage} className="h-l" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>{STAGE_TEXT[phase.stage]}…</motion.h2>
              </AnimatePresence>
              <p className="t-s">"{req}"</p>
              {phase.note && <p className="t-xs">{phase.note}</p>}
              <div className="dots" aria-hidden>{[0, 1, 2].map((i) => <motion.span key={i} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />)}</div>
            </motion.div>
          )}

          {phase.k === "ready" && (
            <motion.div key="ready" className="stack" style={{ gap: 16, maxWidth: 760, margin: "0 auto", width: "100%" }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
              <Storybox chapter={phase.chapter} autoplay childName={name} label={`Tonight · "${req}"`} endActions={sleepButtons || undefined} />
              {phase.soften.length > 0 && <p className="soft-note">Anything scary was made gentle, and the guardrail read every word first.</p>}
              {mode === "tab" && <p className="t-xs" style={{ textAlign: "center" }}>Written on this device in {(phase.chapter.gen_ms / 1000).toFixed(0)}s and passed the guardrail. Read along without a voice here; the laptop box reads it aloud.</p>}
              <div className="row" style={{ justifyContent: "center" }}>
                <button className="btn sm" onClick={() => { setAsleep(""); setPhase({ k: "pick" }); }}>Pick a different story</button>
              </div>
            </motion.div>
          )}

          {(phase.k === "refused" || phase.k === "error") && (
            <motion.div key="fail" className="working" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert">
              <h2 className="h-l">{phase.k === "refused" ? "No new story tonight" : "The story could not be written"}</h2>
              <p className="lede" style={{ textAlign: "center" }}>
                {phase.k === "refused" ? "Every draft failed the guardrail, so nothing new is read. Here is a story you already know." : phase.msg}
              </p>
              <div className="row" style={{ justifyContent: "center" }}>
                <a className="btn primary" href="#/story">Hear a recorded chapter</a>
                <button className="btn" onClick={() => setPhase({ k: "pick" })}>Try another topic</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

export function Ask() {
  const st = useDemo();
  if (st.status === "loading") return <div className="wrap sec"><Loading /></div>;
  if (st.status === "error") return <div className="wrap sec"><Failed what="The story box" err={st.error} /></div>;
  return <Body d={st.demo} />;
}

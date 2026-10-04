// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Sky } from "../components/Sky";
import { Storybox, unlockSpeech } from "../components/Storybox";
import { Failed, Loading } from "../components/ui";
import { boxHealth, logAsleep, pollJob, startStory, type Health, type Stage } from "../lib/box";
import type { Chapter, Demo } from "../lib/data";
import { check, gentleRequest } from "../lib/guard";
import { useDemo } from "../lib/useDemo";
import type { In, Out } from "../workers/gemma";

const SYSTEM =
  "You are a gentle bedtime storyteller for one small child. You write calm, warm, slightly dull stories designed to help a child fall asleep. Nothing frightening ever happens. There is no danger, no villain, no peril and no loud noise. Problems are small and are solved kindly. The story ends with everyone safe, warm and already sleepy. Write simple short sentences a young child can follow. Never mention that you are an AI and never address the reader.";

/** Same rules as story.SYSTEM_MIDDLE and story._continue_prompt in Python. */
const SYSTEM_MIDDLE = SYSTEM.replace(
  "The story ends with everyone safe, warm and already sleepy.",
  "You are writing only one part of a longer story. Never end it, never say goodnight and never put anyone to sleep yet.",
);
function continuePrompt(name: string, age: number, ask: string, soFar: string, part: number, parts: number): string {
  const sents = soFar.trim().split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const opening = sents.length > 4 ? sents.slice(0, 2) : [];
  return [
    `You are continuing tonight's bedtime story for ${name}, who is ${age} years old.`,
    `The story is about: ${ask}.`,
    opening.length ? `The story began like this: ${opening.join(" ")}` : "",
    `The story so far ends like this: ${sents.slice(-2).join(" ")}`,
    "Keep every name exactly the same.",
    `Write part ${part} of ${parts}. Begin with something new that happens next, with the same characters. Never repeat a sentence that was already written.`,
    "About 120 words. Short sentences. Very quiet and gentle.",
    part === parts ? "This is the last part. Bring the characters home, warm and safe, and let them drift off." : "Do not end the story yet. Stop at a calm moment.",
    "Reply with the story text only. No title, no notes.",
  ].filter(Boolean).join("\n");
}
const sentenceSet = (t: string) =>
  new Set(
    [...t.toLowerCase().matchAll(/[^.!?\n]+[.!?]?/g)]
      .map((m) => (m[0].match(/[a-z']+/g) ?? []).join(" "))
      .filter((x) => x.split(" ").length >= 5),
  );
function repeats(part: string, before: string): boolean {
  const b = sentenceSet(before);
  return [...sentenceSet(part)].some((x) => b.has(x));
}

type Length = "short" | "long";
const LENGTH_KEY = "nightjar-length";
const lengthPref = (): Length => {
  try {
    return sessionStorage.getItem(LENGTH_KEY) === "long" ? "long" : "short";
  } catch {
    return "short";
  }
};

/** Picture tiles a four year old can choose without reading. */
const TOPICS: Array<{ emoji: string; label: string; ask: string }> = [
  { emoji: "🐢", label: "Pim the turtle", ask: "Pim the turtle goes on a slow little walk" },
  { emoji: "🌙", label: "The moon", ask: "the moon comes down to visit" },
  { emoji: "❄️", label: "Snow", ask: "soft snow falling on the garden" },
  { emoji: "🐉", label: "A friendly dragon", ask: "a friendly little dragon who is very sleepy" },
  { emoji: "🚂", label: "A sleepy train", ask: "a sleepy train going home at night" },
  { emoji: "🧸", label: "Teddy", ask: "my teddy bear has a picnic under the stars" },
  { emoji: "🎒", label: "Big school", ask: "my first days at big school, the new friends and the kind teacher, and coming home safe" },
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
      This public page writes the story in your browser with Gemma 3 270M. The first time it downloads {gpu ? "about 280 MB" : "about 550 MB"} to this device and {gpu ? "takes under a minute" : "can take five minutes on a laptop without WebGPU"}. It reads aloud with this device's own voice. On the laptop box (<code className="mono">nightjar serve</code>) it is written in about three minutes (six for a long one) and read aloud in a softer offline voice.
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
  const [length, setLengthState] = useState<Length>(lengthPref);
  const setLength = (l: Length) => {
    setLengthState(l);
    try {
      sessionStorage.setItem(LENGTH_KEY, l);
    } catch {
      /* lasts for this page */
    }
  };
  const worker = useRef<Worker | null>(null);
  const name = health?.name || d.stories.child.name;
  const avoid = d.stories.child.avoid;
  const softened = gentleRequest(d.guard, req, avoid);
  const soften = softened.found;

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
      const job = await startStory(ask, length);
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
        const partNote = length === "long" && j.part && j.part !== "1/1" ? `Part ${j.part.replace("/", " of ")}` : "";
        setPhase({ k: "working", stage: j.stage, note: [partNote, j.stage === "rewriting" ? `try ${j.attempt}` : ""].filter(Boolean).join(", ") || undefined });
        if (Date.now() - started > 15 * 60_000) return setPhase({ k: "error", msg: "That took too long. Is Ollama running?" });
      }
    } catch (e) {
      setPhase({ k: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const makeTab = (asked: string) => {
    // The model only ever sees the gentle version of what was asked.
    const ask = gentleRequest(d.guard, asked, avoid).text || asked;
    worker.current?.terminate();
    const w = new Worker(new URL("../workers/gemma.ts", import.meta.url), { type: "module" });
    worker.current = w;
    let text = "";
    let tries = 0;
    // A phone that runs out of memory can kill the model without any error
    // reaching the page. If nothing at all happens for two minutes, say so
    // instead of spinning forever.
    let lastSign = Date.now();
    let finished = false;
    const watchdog = window.setInterval(() => {
      if (finished) return window.clearInterval(watchdog);
      if (Date.now() - lastSign > 120_000) {
        finished = true;
        window.clearInterval(watchdog);
        w.terminate();
        setPhase({ k: "error", msg: "The story model stopped answering. This device may not have enough memory for it. The recorded chapters still work, with a real voice." });
      }
    }, 5000);
    const parts = length === "long" ? 3 : 1;
    const texts: string[] = [];
    let title = "Tonight's Chapter";
    let totalMs = 0;
    let totalTokens = 0;
    let attempts = 0;
    const first = [
      `Tonight you are writing for ${name}, who is ${d.stories.child.age} years old.`,
      `${name} asked for this tonight, and the story must be about it: ${ask}.`,
      ask !== asked ? "Keep everything friendly, small and gentle. Nothing frightening at all." : "",
      parts > 1
        ? `This is part 1 of ${parts} of a longer story. Write about 120 words. Very quiet. Short sentences. Do not end the story yet; stop at a calm moment.`
        : "Write about 120 words. Very quiet; almost nothing happens. Short sentences. End with everyone safe and asleep.",
      "Put a short title on the first line, then the story. No other text.",
    ].filter(Boolean).join("\n");
    const promptFor = (part: number) => (part === 1 ? first : continuePrompt(name, d.stories.child.age, ask, texts.join("\n"), part, parts));
    const generate = () => {
      tries++;
      attempts++;
      text = "";
      const part = texts.length + 1;
      const label = parts > 1 ? `Part ${part} of ${parts}` : undefined;
      setPhase({ k: "working", stage: tries > 1 ? "rewriting" : "writing", note: [label, tries > 1 ? `try ${tries}` : ""].filter(Boolean).join(", ") || undefined });
      w.postMessage({ type: "generate", system: part < parts ? SYSTEM_MIDDLE : SYSTEM, prompt: promptFor(part), maxTokens: 400 } satisfies In);
    };
    w.onmessage = (e: MessageEvent<Out>) => {
      const m = e.data;
      lastSign = Date.now();
      if (m.type === "progress") setPhase({ k: "working", stage: "queued", note: m.total ? `Downloading the story model, ${Math.round((m.loaded / m.total) * 100)}%` : undefined });
      else if (m.type === "ready") generate();
      else if (m.type === "token") text += m.text;
      else if (m.type === "done") {
        totalMs += m.ms;
        totalTokens += m.tokens;
        const part = texts.length + 1;
        const raw = (m.text.trim() ? m.text : text).replace(/```[a-z]*\n?/g, "").replace(/[ \t]*\\+[ \t]*$/gm, "");
        const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
        const hasTitle = part === 1 && lines.length > 1 && lines[0].length < 70;
        const partTitle = hasTitle ? lines[0].replace(/^[#*[\]"\s]+|[*[\]"\s]+$/g, "") : title;
        const body = (hasTitle ? lines.slice(1) : lines).join("\n");
        let v = check(d.guard, body, { avoid, alsoScreen: part === 1 ? partTitle : "", minWords: 40, maxWords: 270 });
        if (v.ok && texts.length && repeats(body, texts.join("\n"))) v = { ok: false, violations: ["repeats an earlier sentence"] };
        if (!v.ok) {
          if (tries < 3) return generate();
          finished = true;
          return setPhase({ k: "refused" });
        }
        if (part === 1) title = partTitle;
        texts.push(body);
        tries = 0;
        if (texts.length < parts) return generate();
        finished = true;
        const full = texts.join("\n\n");
        setPhase({
          k: "ready",
          soften,
          chapter: {
            night: new Date().toISOString().slice(0, 10),
            title,
            text: full,
            knobs: { target_words: 120 * parts, pace_wpm: 95, calm_level: 5, cast: [], is_sequel: false, parts },
            attempts,
            rejected: [],
            gen_ms: totalMs,
            eval_tokens: totalTokens,
            features: { word_count: full.split(/\s+/).length },
            audio: null,
          },
        });
      } else if (m.type === "error") {
        finished = true;
        setPhase({ k: "error", msg: m.message });
      }
    };
    w.onerror = (e) => {
      finished = true;
      setPhase({ k: "error", msg: e.message || "the story model crashed" });
    };
    setPhase({ k: "working", stage: "queued", note: "Starting the story model" });
    w.postMessage({ type: "load", model: "onnx-community/gemma-3-270m-it-ONNX", device: gpu ? "webgpu" : "wasm", dtype: gpu ? "q4f16" : "q8" } satisfies In);
  };

  const go = (ask: string) => {
    const a = ask.trim().slice(0, 200);
    if (!a) return;
    unlockSpeech(); // a phone only lets the voice start after a tap: this is the tap
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
      <Sky stars={90} moon={false} />
      <div className="wrap ask-wrap">
        <AnimatePresence mode="wait">
          {phase.k === "pick" && (
            <motion.div key="pick" className="stack" style={{ gap: 24 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.35 }}>
              <div style={{ textAlign: "center" }} className="stack">
                <span className="eyebrow">{mode === "box" ? `Nightjar box · ${health?.model}` : mode === "tab" ? "In this browser" : "Looking for the box"}</span>
                <h1 className="h-xl">What story tonight, {name}?</h1>
              </div>
              <div className="length" role="group" aria-label="How long a story">
                {(["short", "long"] as const).map((l) => (
                  <button key={l} className="length-btn" aria-pressed={length === l} onClick={() => setLength(l)}>
                    <span aria-hidden>{l === "short" ? "🌙" : "🌙🌙🌙"}</span>
                    <b>{l === "short" ? "Short story" : "Long story"}</b>
                    <span className="t-xs">{l === "short" ? "about a minute to listen" : "about four minutes, in three parts"}</span>
                  </button>
                ))}
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
                    Bedtime stays cosy, so tonight's story will be: <i>{softened.text}</i>
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
              {mode === "tab" && (
                <motion.p className="tap-hint" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                  Your story is ready. Tap the play button to hear it.
                </motion.p>
              )}
              <Storybox chapter={phase.chapter} autoplay={mode === "box"} childName={name} label={`Tonight · "${req}"`} endActions={sleepButtons || undefined} />
              {phase.soften.length > 0 && <p className="soft-note">The scary part became something friendly. The guardrail read every word first.</p>}
              {mode === "tab" && <p className="t-xs" style={{ textAlign: "center" }}>Written on this device in {(phase.chapter.gen_ms / 1000).toFixed(0)}s and passed the guardrail. Read aloud with this device's own voice; the laptop box uses a softer offline voice.</p>}
              <div className="row" style={{ justifyContent: "center" }}>
                <button className="btn sm" onClick={() => { setAsleep(""); setPhase({ k: "pick" }); }}>Pick a different story</button>
              </div>
            </motion.div>
          )}

          {(phase.k === "refused" || phase.k === "error") && (
            <motion.div key="fail" className="working" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert">
              <h2 className="h-l">{phase.k === "refused" ? "No new story tonight" : "The story could not be written"}</h2>
              <p className="lede" style={{ textAlign: "center" }}>
                {phase.k === "refused" ? "Every draft came out too exciting for bedtime, so none of them is read aloud. Trying again usually works." : phase.msg}
              </p>
              <div className="row" style={{ justifyContent: "center" }}>
                <button className="btn primary" onClick={() => go(req)}>Try again</button>
                <button className="btn" onClick={() => setPhase({ k: "pick" })}>Pick another topic</button>
                <a className="btn" href="#/story">Hear a recorded chapter</a>
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

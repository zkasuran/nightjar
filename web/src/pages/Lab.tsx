// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Failed, Loading, PageHead, Tick } from "../components/ui";
import type { Demo } from "../lib/data";
import { check } from "../lib/guard";
import { useDemo } from "../lib/useDemo";
import type { In, Out } from "../workers/gemma";

const SYSTEM =
  "You are a gentle bedtime storyteller for one small child. You write calm, warm, slightly dull stories designed to help a child fall asleep. Nothing frightening ever happens. There is no danger, no villain, no peril and no loud noise. Problems are small and are solved kindly. The story ends with everyone safe, warm and already sleepy. Write simple short sentences a young child can follow. Never mention that you are an AI and never address the reader.";

const MODELS = [
  { id: "onnx-community/gemma-3-270m-it-ONNX", name: "Gemma 3 270M", size: "about 280 MB with WebGPU, 550 MB on CPU", note: "Runs on most laptops, WebGPU or plain CPU", gpuOnly: false },
  { id: "onnx-community/gemma-3-1b-it-ONNX-GQA", name: "Gemma 3 1B", size: "about 770 MB", note: "The same size as the laptop version, needs WebGPU", gpuOnly: true },
] as const;

type Phase = "idle" | "loading" | "ready" | "writing" | "done" | "error";

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function splitTitle(raw: string): { title: string; body: string } {
  const lines = raw.replace(/```[a-z]*\n?/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0].length < 70) return { title: lines[0].replace(/^[#*\s]+|[*\s]+$/g, ""), body: lines.slice(1).join("\n") };
  return { title: "Tonight's Chapter", body: lines.join("\n") };
}

function Body({ d }: { d: Demo }) {
  const child = d.stories.child;
  const [gpu, setGpu] = useState<boolean | null>(null);
  const [model, setModel] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [files, setFiles] = useState<Record<string, [number, number]>>({});
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [req, setReq] = useState("the slow turtle finds a soft place to sleep");
  const [meta, setMeta] = useState({ loadMs: 0, genMs: 0, tokens: 0 });
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    hasWebGPU().then(setGpu);
    return () => worker.current?.terminate();
  }, []);

  const send = (m: In) => worker.current?.postMessage(m);

  const load = () => {
    worker.current?.terminate();
    const w = new Worker(new URL("../workers/gemma.ts", import.meta.url), { type: "module" });
    worker.current = w;
    setFiles({});
    setErr("");
    setPhase("loading");
    w.onmessage = (e: MessageEvent<Out>) => {
      const m = e.data;
      if (m.type === "progress") setFiles((f) => ({ ...f, [m.file]: [m.loaded, m.total] }));
      else if (m.type === "ready") { setMeta((x) => ({ ...x, loadMs: m.ms })); setPhase("ready"); }
      else if (m.type === "token") setText((t) => (t + m.text).slice(0, 20000));
      else if (m.type === "done") { setText((t) => (m.text.trim() ? m.text : t)); setMeta((x) => ({ ...x, genMs: m.ms, tokens: m.tokens })); setPhase("done"); }
      else if (m.type === "error") { setErr(m.message); setPhase("error"); }
    };
    w.onerror = (e) => { setErr(e.message || "the model worker crashed"); setPhase("error"); };
    const useGpu = !!gpu;
    send({ type: "load", model: MODELS[model].id, device: useGpu ? "webgpu" : "wasm", dtype: useGpu ? "q4f16" : "q8" });
  };

  const write = () => {
    setText("");
    setPhase("writing");
    const prompt = [
      `Tonight you are writing for ${child.name}, who is ${child.age} years old.`,
      `${child.name} loves: ${child.loves.join(", ")}.`,
      `What ${child.name} asked for tonight: ${req.slice(0, 200)}`,
      "Write about 120 words. Very quiet; almost nothing happens. Short sentences. End with everyone safe and asleep.",
      "Put a short title on the first line, then the story. No other text.",
    ].join("\n");
    send({ type: "generate", system: SYSTEM, prompt, maxTokens: 450 });
  };

  const tot = Object.values(files).reduce((s, [, t]) => s + t, 0);
  const got = Object.values(files).reduce((s, [l]) => s + l, 0);
  const pct = tot ? Math.min(100, (got / tot) * 100) : 0;
  const { title, body } = splitTitle(text);
  const empty = phase === "done" && !body.trim();
  const verdict = phase === "done" && !empty ? check(d.guard, body, { avoid: child.avoid, alsoScreen: title, minWords: 40 }) : null;
  const m = MODELS[model];

  return (
    <>
      <PageHead eyebrow="Try it · Gemma in your browser" title="Write tonight's chapter on this device">
        The model downloads once from the Hugging Face hub and runs inside this tab. After that it works with the wifi off. Your request never leaves the browser.
      </PageHead>
      <section className="sec" style={{ paddingTop: 24 }}>
        <div className="wrap split wide-r">
          <div className="stack">
            <div className="card stack">
              <h3 className="h-s">1. Pick a model</h3>
              {MODELS.map((x, i) => (
                <button key={x.id} className="preset" aria-pressed={model === i} disabled={(x.gpuOnly && gpu === false) || phase === "loading" || phase === "writing"} onClick={() => { setModel(i); setPhase("idle"); }}>
                  <b>{x.name} <span className="t-xs">· {x.size}</span></b>
                  <span>{x.gpuOnly && gpu === false ? "Needs WebGPU, which this browser does not offer" : x.note}</span>
                </button>
              ))}
              <div className="row">
                <span className={`chip ${gpu ? "good" : "acc"}`}><span className="dot" />{gpu === null ? "Checking for WebGPU" : gpu ? "WebGPU available" : "No WebGPU, using CPU"}</span>
              </div>
              <button className="btn primary" onClick={load} disabled={gpu === null || phase === "loading" || phase === "writing"}>
                {phase === "ready" || phase === "done" ? "Reload model" : `Download ${m.name} (${m.size})`}
              </button>
              <p className="t-xs">Without WebGPU it runs on one CPU thread: about 30 seconds to load and three to five minutes per chapter, measured in headless Chrome. The 270M model often talks to the child instead of telling a story; the guardrail now refuses that. Weights are public files from huggingface.co ({m.id}), used under the Gemma Terms of Use. The browser caches them for next time.</p>
            </div>
            <div className="card stack">
              <h3 className="h-s">What stays on this device</h3>
              <Tick>Your request and the story</Tick>
              <Tick>The guardrail verdict</Tick>
              <Tick>The model, once cached</Tick>
              <p className="t-xs">The only network traffic is GET requests for public model files.</p>
            </div>
          </div>
          <div className="stack">
            <div className="card stack">
              <h3 className="h-s">2. What does she want tonight?</h3>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input type="text" value={req} maxLength={200} onChange={(e) => setReq(e.target.value)} aria-label="Tonight's request" />
                <button className="btn primary" onClick={write} disabled={phase !== "ready" && phase !== "done"}>Write it</button>
              </div>
              <AnimatePresence>
                {phase === "loading" && (
                  <motion.div className="stack" style={{ gap: 6 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                    <span className="t-xs num">{tot ? `${(got / 1e6).toFixed(0)} of ${(tot / 1e6).toFixed(0)} MB · ${pct.toFixed(0)}%` : "Starting the download"}</span>
                  </motion.div>
                )}
              </AnimatePresence>
              {phase === "idle" && <div className="empty" style={{ padding: 32 }}><p className="t-s">Download a model on the left to begin.</p></div>}
              {phase === "error" && (
                <div className="empty" role="alert" style={{ padding: 24 }}>
                  <b>The model could not run here</b>
                  <p className="mono t-s">{err.slice(0, 300)}</p>
                  <p className="t-s">The eight recorded nights still work: <a href="#/story">hear one</a>.</p>
                </div>
              )}
              {(phase === "writing" || phase === "done" || (phase === "ready" && text)) && (
                <div className="inset stack">
                  {title && phase === "done" && <h3 className="h-m">{title}</h3>}
                  <div className="stream">{phase === "done" ? body : text}{phase === "writing" && <span className="caret" />}</div>
                </div>
              )}
              {phase === "ready" && !text && <p className="t-s">Model ready in {(meta.loadMs / 1000).toFixed(1)}s. Press Write it.</p>}
            </div>
            {empty && (
              <div className="verdict no" role="status">The model stopped before writing anything. Nothing to read aloud. Press Write it for a new draft.</div>
            )}
            <AnimatePresence>
              {verdict && (
                <motion.div className={`verdict ${verdict.ok ? "ok" : "no"}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} role="status">
                  {verdict.ok ? "Guardrail passed. This chapter could be read aloud." : `Guardrail refused: ${verdict.violations.join("; ")}. Press Write it for a new draft.`}
                  <span className="chip" style={{ marginLeft: "auto" }}>{(meta.genMs / 1000).toFixed(0)}s on this device</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </section>
    </>
  );
}

export function Lab() {
  const st = useDemo();
  if (st.status === "loading") return <div className="wrap sec"><Loading /></div>;
  if (st.status === "error") return <div className="wrap sec"><Failed what="The lab" err={st.error} /></div>;
  return <Body d={st.demo} />;
}

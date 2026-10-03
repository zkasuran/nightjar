// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Runs Gemma in a Web Worker so the page stays smooth while it thinks.
// Weights come from the Hugging Face hub once and are cached by the browser;
// after that this works with the network off. Nothing is ever sent upstream:
// the only requests are GETs for public model files.

import { env, pipeline, TextStreamer, type TextGenerationPipeline } from "@huggingface/transformers";

export type In =
  | { type: "load"; model: string; device: "webgpu" | "wasm"; dtype: "q4f16" | "q8" | "q4" }
  | { type: "generate"; system: string; prompt: string; maxTokens: number };
export type Out =
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "ready"; ms: number }
  | { type: "token"; text: string }
  | { type: "done"; text: string; ms: number; tokens: number }
  | { type: "error"; message: string };

const ALLOWED = new Set(["onnx-community/gemma-3-270m-it-ONNX", "onnx-community/gemma-3-1b-it-ONNX-GQA"]);

env.allowLocalModels = false;
env.allowRemoteModels = true;
// Self hosted ONNX Runtime: no script is ever loaded from a CDN.
env.useWasmCache = false;
/** The asyncify build serves WebGPU. The plain build carries the full CPU
 *  kernel set (GatherBlockQuantized is missing from the asyncify CPU path). */
function useOrt(device: "webgpu" | "wasm") {
  const name = device === "webgpu" ? "ort-wasm-simd-threaded.asyncify" : "ort-wasm-simd-threaded";
  if (!env.backends.onnx.wasm) return;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL(`/ort/${name}.mjs`, self.location.origin).href,
    wasm: new URL(`/ort/${name}.wasm`, self.location.origin).href,
  };
  env.backends.onnx.wasm.numThreads = 1;
}

let gen: TextGenerationPipeline | null = null;
const post = (m: Out) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      if (!ALLOWED.has(m.model)) throw new Error("model not on the allow list");
      useOrt(m.device);
      const t0 = performance.now();
      gen = (await pipeline("text-generation", m.model, {
        device: m.device,
        dtype: m.dtype,
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === "progress" && p.file) post({ type: "progress", file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
        },
      })) as TextGenerationPipeline;
      post({ type: "ready", ms: performance.now() - t0 });
    } else if (m.type === "generate") {
      if (!gen) throw new Error("model not loaded");
      const t0 = performance.now();
      let tokens = 0;
      const streamer = new TextStreamer(gen.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          tokens++;
          post({ type: "token", text });
        },
      });
      const messages = [
        { role: "system", content: m.system.slice(0, 2000) },
        { role: "user", content: m.prompt.slice(0, 4000) },
      ];
      const out = (await gen(messages, { max_new_tokens: Math.min(700, m.maxTokens), do_sample: true, temperature: 0.8, top_p: 0.95, streamer })) as unknown as Array<{ generated_text: Array<{ role: string; content: string }> }>;
      const text = out?.[0]?.generated_text?.at(-1)?.content ?? "";
      post({ type: "done", text: String(text).slice(0, 20000), ms: performance.now() - t0, tokens });
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/** Hosts the in-browser model lab may fetch weights from. Nothing else is reachable. */
const MODEL_HOSTS = ["https://huggingface.co", "https://*.huggingface.co", "https://*.hf.co"];

/** ONNX Runtime is self-hosted so no script ever loads from a CDN. */
const ORT = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

function ortAssets(): Plugin {
  return {
    name: "nightjar-ort",
    buildStart() {
      mkdirSync("public/ort", { recursive: true });
      for (const f of ORT) copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `public/ort/${f}`);
    },
  };
}

/** Strict CSP, production build only (dev needs inline HMR). The no-flash theme
 *  script is allowed by its hash. 'wasm-unsafe-eval' is for ONNX Runtime. */
function csp(): Plugin {
  return {
    name: "nightjar-csp",
    apply: "build",
    transformIndexHtml(html) {
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
      );
      const policy = [
        "default-src 'none'",
        `script-src 'self' 'wasm-unsafe-eval' ${inline.join(" ")}`,
        "worker-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        `connect-src 'self' ${MODEL_HOSTS.join(" ")}`,
        "media-src 'self' blob:",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
      ].join("; ");
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="no-referrer" />`,
      );
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), ortAssets(), csp()],
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1200, sourcemap: false },
});

// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Post build gate: the CSP made it into the HTML, the fixtures match their
// manifest, ONNX Runtime is self hosted and nothing points at a script CDN.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const fail = (m) => { console.error(`check-dist: ${m}`); process.exit(1); };
const html = readFileSync("dist/index.html", "utf8");
if (!html.includes('http-equiv="Content-Security-Policy"')) fail("no CSP meta in dist/index.html");
if (!html.includes("default-src 'none'")) fail("CSP is not default-src 'none'");
const m = JSON.parse(readFileSync("dist/demo/manifest.json", "utf8"));
for (const [name, { sha256 }] of Object.entries(m.files)) {
  const got = createHash("sha256").update(readFileSync(`dist/demo/${name}`)).digest("hex");
  if (got !== sha256) fail(`${name} does not match manifest`);
}
for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) if (!existsSync(`dist/ort/${f}`)) fail(`missing dist/ort/${f}`);
for (const f of readdirSync("dist/assets")) {
  if (!f.endsWith(".js")) continue;
  const s = readFileSync(`dist/assets/${f}`, "utf8");
  if (/<script[^>]+src=["']https?:/.test(s)) fail(`${f} injects a remote script`);
}
console.log(`check-dist: CSP present, ${Object.keys(m.files).length} fixtures match, ORT self hosted`);

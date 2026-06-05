import { mkdirSync, existsSync, cpSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const TRANSFORMERS_VERSION = "3.8.1";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const ortDir = join(distDir, "ort");

mkdirSync(distDir, { recursive: true });
mkdirSync(ortDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "src", "offscreen-processor.js")],
  outfile: join(distDir, "offscreen.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome109"],
  sourcemap: true,
  logLevel: "info",
});

// Extensions can't load remote scripts → bundle the ONNX runtime locally.
const tfDist = join(
  root,
  "node_modules",
  "@huggingface",
  "transformers",
  "dist"
);
const jsepMjs = "ort-wasm-simd-threaded.jsep.mjs";
const jsepWasm = "ort-wasm-simd-threaded.jsep.wasm";

if (existsSync(join(tfDist, jsepMjs))) {
  cpSync(join(tfDist, jsepMjs), join(ortDir, jsepMjs));
  console.log("Copied ORT loader:", jsepMjs);
} else {
  console.warn("Missing", jsepMjs, "in transformers dist");
}

const wasmDest = join(ortDir, jsepWasm);
if (!existsSync(wasmDest)) {
  const url = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/${jsepWasm}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(wasmDest, Buffer.from(await res.arrayBuffer()));
    console.log("Fetched ORT wasm:", jsepWasm);
  } catch (e) {
    console.warn(
      `\nCould not download ${jsepWasm} (${e.message}). Download it manually:\n  ${url}\n  -> ${wasmDest}\n`
    );
  }
} else {
  console.log("ORT wasm already present.");
}

console.log("Build complete: dist/offscreen.js + dist/ort/");

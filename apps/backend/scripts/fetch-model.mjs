// Fetch the offline LaBSE embedding model into apps/backend/models/ so the app can
// run cross-language duplicate detection with NO network at runtime. Run this once
// per machine before `pnpm dev` (cross-language) or before packaging (`pnpm dist`):
//
//   node apps/backend/scripts/fetch-model.mjs
//
// It downloads through transformers.js itself (allowRemoteModels + cacheDir), so the
// exact file set the runtime loader needs lands in the exact layout it reads from
// (<models>/Xenova/LaBSE/… incl. onnx/model_quantized.onnx). The runtime adapter
// (adapters/embedding/labse.ts) then loads the SAME dir with allowRemoteModels=false.
//
// Skipping this is safe — the app just runs with cross-language detection disabled
// (STM_MODEL_PATH points at a missing model → the service degrades gracefully).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = join(here, "..", "models");
const MODEL_ID = "Xenova/LaBSE";
const DTYPE = "q8"; // int8 (~471MB). Switch to "fp16" (~941MB) if short-title accuracy needs it.

console.log(`Fetching ${MODEL_ID} (${DTYPE}) → ${modelsDir}`);
console.log("This is a one-time ~471MB download; it may take a few minutes.\n");

const { pipeline, env } = await import("@huggingface/transformers");
env.allowRemoteModels = true; // this script IS the online step; runtime stays offline
env.cacheDir = modelsDir; // downloads land here in <cacheDir>/<MODEL_ID>/… layout
env.localModelPath = modelsDir;

const extractor = await pipeline("feature-extraction", MODEL_ID, {
  dtype: DTYPE,
  // surface download progress so a multi-minute fetch isn't a silent hang
  progress_callback: (p) => {
    if (p.status === "progress" && p.file && typeof p.progress === "number") {
      process.stdout.write(`\r  ${p.file}: ${p.progress.toFixed(0)}%   `);
    }
  },
});

// Warm up once so a broken/incomplete download fails HERE, loudly, not at runtime.
const out = await extractor(["测试 warmup"], { pooling: "mean", normalize: true });
const dim = out.tolist()[0]?.length ?? 0;
console.log(`\n\nDone. Model cached under ${modelsDir}/${MODEL_ID}; embedding dim = ${dim}.`);
console.log("Now: `pnpm dev` (dev cross-language) or `pnpm dist` (package it in).");

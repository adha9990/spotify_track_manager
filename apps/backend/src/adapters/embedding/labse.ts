import type { EmbeddingGateway } from "../../ports/embedding-gateway";

// LaBSE (language-agnostic BERT sentence embedding) via transformers.js, running
// fully offline over a locally-staged ONNX model (onnxruntime-node is pulled in
// transitively as transformers.js's backend — never imported directly here).
//
// The model is loaded lazily on first embed(), not at construction, so a missing
// or not-yet-staged model can't crash the composition root at boot (ADR-5): the
// service catches embed() failures and degrades gracefully instead.

export const LABSE_MODEL_ID = "Xenova/LaBSE";

export type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: true },
) => Promise<{ tolist(): number[][] }>;

export interface LabseOptions {
  /** Directory containing the staged model files (see packaging T7). */
  modelPath: string;
  /** Overrides LABSE_MODEL_ID — used to invalidate stale cached vectors. */
  modelId?: string;
  /** Test seam: injects a fake extractor loader so tests never touch the real model. */
  loadExtractor?: (modelPath: string) => Promise<Extractor>;
}

// `@huggingface/transformers` is ESM-only, but this backend is bundled to CJS by
// esbuild. A plain `await import(...)` would get rewritten by esbuild's CJS output
// into a `require(...)` call, which throws ERR_REQUIRE_ESM at runtime. Hiding the
// specifier behind `new Function` keeps esbuild from seeing (and rewriting) the
// import, so it stays a genuine dynamic `import()` at runtime.
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<any>;

async function loadRealExtractor(modelPath: string, modelId: string): Promise<Extractor> {
  const { pipeline, env } = await dynamicImport("@huggingface/transformers");
  // Fully offline: never reach out to the HF Hub, load only from the staged path.
  env.allowRemoteModels = false;
  env.localModelPath = modelPath;
  const pipe = await pipeline("feature-extraction", modelId, { dtype: "q8" });
  return (texts, opts) => pipe(texts, opts);
}

/** Builds the LaBSE-backed EmbeddingGateway. Construction is side-effect-free. */
export function createLabseGateway(options: LabseOptions): EmbeddingGateway {
  const modelId = options.modelId ?? LABSE_MODEL_ID;
  const loadExtractor = options.loadExtractor ?? ((path) => loadRealExtractor(path, modelId));
  let extractorPromise: Promise<Extractor> | null = null;

  const getExtractor = (): Promise<Extractor> => {
    // Memoize the successful load, but on a REJECTED load reset the cache so a later
    // embed() retries — otherwise a single transient failure (AV file lock, a race
    // with model staging) would permanently disable cross-language for the process.
    if (!extractorPromise) {
      extractorPromise = loadExtractor(options.modelPath).catch((err) => {
        extractorPromise = null;
        throw err;
      });
    }
    return extractorPromise;
  };

  return {
    modelId,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const extractor = await getExtractor();
      const result = await extractor(texts, { pooling: "mean", normalize: true });
      return result.tolist();
    },
  };
}

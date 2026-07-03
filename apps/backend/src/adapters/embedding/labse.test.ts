import { describe, expect, it, vi } from "vitest";
import { createLabseGateway, LABSE_MODEL_ID, type Extractor } from "./labse";

// Fake extractor factory — never touches transformers.js or the real 471MB model.
const fakeExtractorReturning = (rows: number[][]): Extractor =>
  vi.fn(async (_texts: string[], _opts: { pooling: "mean"; normalize: true }) => ({
    tolist: () => rows,
  })) as unknown as Extractor;

describe("createLabseGateway", () => {
  it("modelId defaults to LABSE_MODEL_ID", () => {
    // Requirement: gateway exposes the model identifier used to invalidate stale cached vectors.
    expect(LABSE_MODEL_ID).toEqual(expect.any(String));
    expect(LABSE_MODEL_ID.length).toBeGreaterThan(0);

    const gateway = createLabseGateway({ modelPath: "/x" });
    expect(gateway.modelId).toBe(LABSE_MODEL_ID);

    const customGateway = createLabseGateway({ modelPath: "/x", modelId: "custom" });
    expect(customGateway.modelId).toBe("custom");
  });

  it("construction does not load the model (lazy)", () => {
    // Requirement: constructing the gateway must not load the model — a missing model
    // must not crash at boot; loading only happens on first embed().
    const loadExtractor = vi.fn(async () => fakeExtractorReturning([]));

    createLabseGateway({ modelPath: "/x", loadExtractor });

    expect(loadExtractor).not.toHaveBeenCalled();
  });

  it("embed loads the extractor once and reuses it, passing each batch's exact texts", async () => {
    // Requirement: the extractor is loaded lazily on first embed() and reused thereafter,
    // and each call forwards that call's own texts + the mean/normalize opts (a batching
    // regression that dropped/duplicated texts must not slip past a loose matcher).
    const extractor = vi.fn(async (_texts: string[], _opts: { pooling: "mean"; normalize: true }) => ({
      tolist: () => [[0, 1]],
    }));
    const loadExtractor = vi.fn(async () => extractor as unknown as Extractor);
    const gateway = createLabseGateway({ modelPath: "/x", loadExtractor });

    await gateway.embed(["a"]);
    await gateway.embed(["b", "c"]);

    expect(loadExtractor).toHaveBeenCalledTimes(1);
    expect(extractor.mock.calls[0]).toEqual([["a"], { pooling: "mean", normalize: true }]);
    expect(extractor.mock.calls[1]).toEqual([["b", "c"], { pooling: "mean", normalize: true }]);
  });

  it("retries loading after a failed load instead of poisoning the gateway for the process (F5)", async () => {
    // Requirement: a rejected model load must not be memoized forever — a transient
    // failure (AV lock, a race with model staging) would otherwise disable cross-language
    // for the whole process. The next embed() must attempt the load again.
    const extractor = fakeExtractorReturning([[1, 0]]);
    const loadExtractor = vi
      .fn<(path: string) => Promise<Extractor>>()
      .mockRejectedValueOnce(new Error("transient load failure"))
      .mockResolvedValueOnce(extractor);
    const gateway = createLabseGateway({ modelPath: "/x", loadExtractor });

    await expect(gateway.embed(["a"])).rejects.toThrow("transient load failure");
    await expect(gateway.embed(["a"])).resolves.toEqual([[1, 0]]);
    expect(loadExtractor).toHaveBeenCalledTimes(2);
  });

  it("embed returns the extractor's tolist() rows", async () => {
    // Requirement: embed() returns one L2-normalized row per input text, order preserved,
    // sourced from the extractor's Tensor.tolist() output.
    const expectedRows = [
      [0, 1],
      [1, 2],
    ];
    const loadExtractor = vi.fn(async () => fakeExtractorReturning(expectedRows));
    const gateway = createLabseGateway({ modelPath: "/x", loadExtractor });

    const result = await gateway.embed(["x", "y"]);

    expect(result).toEqual(expectedRows);
  });

  it("embed([]) returns [] without loading the extractor", async () => {
    // Requirement: an empty batch short-circuits — no point loading a model to embed nothing.
    const loadExtractor = vi.fn(async () => fakeExtractorReturning([]));
    const gateway = createLabseGateway({ modelPath: "/x", loadExtractor });

    const result = await gateway.embed([]);

    expect(result).toEqual([]);
    expect(loadExtractor).not.toHaveBeenCalled();
  });
});

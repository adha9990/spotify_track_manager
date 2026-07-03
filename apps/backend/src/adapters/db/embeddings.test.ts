import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Embeddings } from "./embeddings";

// Each test gets a fresh in-memory database, so no file I/O and full isolation
// (mirrors adapters/db/dismissals.test.ts). Vectors are stored as Float32, so we
// use values that round-trip exactly through float32 (0, 0.5, 1, -0.25) and still
// assert per-element with toBeCloseTo to be safe against precision surprises.
let embeddings: Embeddings;
beforeEach(() => {
  embeddings = new Embeddings(":memory:");
});
afterEach(() => embeddings.close());

describe("Embeddings", () => {
  it("round-trips a stored embedding", () => {
    // Requirement: put() persists a row that get() returns verbatim (pure storage, no freshness logic).
    embeddings.put([{ trackId: "t1", vec: [0.5, -0.25, 1], nameHash: "演员", model: "labse-int8" }]);

    const result = embeddings.get(["t1"]);

    expect(result.has("t1")).toBe(true);
    const row = result.get("t1")!;
    expect(row.vec).toHaveLength(3);
    expect(row.vec[0]).toBeCloseTo(0.5);
    expect(row.vec[1]).toBeCloseTo(-0.25);
    expect(row.vec[2]).toBeCloseTo(1);
    expect(row.nameHash).toBe("演员");
    expect(row.model).toBe("labse-int8");
  });

  it("omits ids that were never stored", () => {
    // Requirement: get() returns a map missing any id with no cached row — caller can distinguish "no id" from "no key".
    embeddings.put([{ trackId: "t1", vec: [0, 0.5, 1], nameHash: "hash1", model: "labse-int8" }]);

    const result = embeddings.get(["t1", "missing"]);

    expect(result.has("t1")).toBe(true);
    expect(result.has("missing")).toBe(false);
    expect(result.size).toBe(1);
  });

  it("upserts: putting the same trackId again overwrites vec/nameHash/model", () => {
    // Requirement: re-putting a trackId replaces the row (single latest row wins) — lets the
    // service invalidate a renamed track or a model change by re-putting rather than needing a delete.
    embeddings.put([{ trackId: "t1", vec: [0, 0, 0], nameHash: "old", model: "labse-int8" }]);
    embeddings.put([{ trackId: "t1", vec: [1, -0.25, 0.5], nameHash: "new", model: "labse-fp16" }]);

    const result = embeddings.get(["t1"]);

    expect(result.size).toBe(1);
    const row = result.get("t1")!;
    expect(row.vec).toHaveLength(3);
    expect(row.vec[0]).toBeCloseTo(1);
    expect(row.vec[1]).toBeCloseTo(-0.25);
    expect(row.vec[2]).toBeCloseTo(0.5);
    expect(row.nameHash).toBe("new");
    expect(row.model).toBe("labse-fp16");
  });

  it("put with an empty array is a no-op / get with an empty array returns an empty map", () => {
    // Requirement: both batch operations must handle degenerate empty input safely without throwing.
    expect(() => embeddings.put([])).not.toThrow();
    expect(embeddings.get([])).toEqual(new Map());

    embeddings.put([{ trackId: "t1", vec: [0, 0.5, 1], nameHash: "hash1", model: "labse-int8" }]);
    expect(() => embeddings.put([])).not.toThrow();
    expect(embeddings.get(["t1"]).size).toBe(1);
  });

  it("persists across a reopen of the same db file", () => {
    // Requirement: the cache is durable storage (a real sqlite file), not in-process only.
    const dir = mkdtempSync(join(tmpdir(), "stm-embeddings-"));
    const dbPath = join(dir, "embeddings.db");
    try {
      const first = new Embeddings(dbPath);
      first.put([{ trackId: "t1", vec: [0, 0.5, -0.25], nameHash: "hash1", model: "labse-int8" }]);
      first.close();

      const second = new Embeddings(dbPath);
      const result = second.get(["t1"]);
      expect(result.has("t1")).toBe(true);
      const row = result.get("t1")!;
      expect(row.vec[0]).toBeCloseTo(0);
      expect(row.vec[1]).toBeCloseTo(0.5);
      expect(row.vec[2]).toBeCloseTo(-0.25);
      expect(row.nameHash).toBe("hash1");
      expect(row.model).toBe("labse-int8");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

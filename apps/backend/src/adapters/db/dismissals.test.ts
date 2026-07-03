import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dismissals } from "./dismissals";

// Each test gets a fresh in-memory database, so no file I/O and full isolation
// (mirrors adapters/db/history.test.ts). The persistence test below is the one
// exception: it needs a real file on disk to prove data survives a reopen.
let dismissals: Dismissals;
beforeEach(() => {
  dismissals = new Dismissals(":memory:");
});
afterEach(() => dismissals.close());

describe("Dismissals", () => {
  it("starts empty", () => {
    expect(dismissals.list()).toEqual([]);
  });

  it("add makes the pairKey visible via list", () => {
    dismissals.add("trackA|trackB", "2026-01-01T00:00:00Z");
    expect(dismissals.list()).toEqual(["trackA|trackB"]);
  });

  it("is idempotent: adding the same pairKey twice does not throw and list shows it once", () => {
    dismissals.add("trackA|trackB", "2026-01-01T00:00:00Z");
    expect(() => dismissals.add("trackA|trackB", "2026-01-02T00:00:00Z")).not.toThrow();
    expect(dismissals.list()).toEqual(["trackA|trackB"]);
  });

  it("persists across reopening the same on-disk file", () => {
    const dir = mkdtempSync(join(tmpdir(), "stm-dismissals-"));
    const dbPath = join(dir, "dismissals.db");
    try {
      const first = new Dismissals(dbPath);
      first.add("trackA|trackB", "2026-01-01T00:00:00Z");
      first.close();

      const second = new Dismissals(dbPath);
      expect(second.list()).toEqual(["trackA|trackB"]);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

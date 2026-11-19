import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { History } from "./history";

// Each test gets a fresh in-memory database, so no file I/O and full isolation.
let history: History;
beforeEach(() => {
  history = new History(":memory:");
});
afterEach(() => history.close());

describe("History", () => {
  it("starts empty", () => {
    expect(history.list()).toEqual([]);
  });

  it("records a batch and lists it with the right count", () => {
    const details = { id: "b", name: "Song B", artists: ["One", "Two"], album: "Live" };
    history.record("delete", ["a", "b", "c"], "b1", "2026-01-01T00:00:00Z", [details]);
    const [batch] = history.list();
    expect(batch).toMatchObject({ batchId: "b1", action: "delete", count: 3, undone: false });
    expect(batch?.tracks).toEqual([
      { id: "a", name: null, artists: [], album: "" },
      details,
      { id: "c", name: null, artists: [], album: "" },
    ]);
  });

  it("fills track names for an existing ID-only batch and preserves its undo payload", () => {
    history.record("delete", ["a"], "legacy", "2026-01-01T00:00:00Z");
    const details = { id: "a", name: "Original recording", artists: ["Artist"], album: "Single" };
    history.rememberTracks([details]);
    history.rememberTracks([{ ...details, name: "Later title" }]);
    expect(history.list()[0]?.tracks).toEqual([details]);
    expect(history.beginUndo("legacy")).toEqual({ action: "delete", trackIds: ["a"] });
  });

  it("lists batches newest first", () => {
    history.record("delete", ["a"], "old", "2026-01-01T00:00:00Z");
    history.record("add", ["b"], "new", "2026-02-01T00:00:00Z");
    expect(history.list().map((b) => b.batchId)).toEqual(["new", "old"]);
  });

  it("beginUndo returns the reversal payload and marks the batch undone", () => {
    history.record("delete", ["x", "y"], "b1", "2026-01-01T00:00:00Z");
    const reversal = history.beginUndo("b1");
    expect(reversal).toEqual({ action: "delete", trackIds: ["x", "y"] });
    expect(history.list()[0]!.undone).toBe(true);
  });

  it("refuses to undo an unknown or already-undone batch", () => {
    expect(history.beginUndo("nope")).toBeNull();
    history.record("add", ["z"], "b1", "2026-01-01T00:00:00Z");
    expect(history.beginUndo("b1")).not.toBeNull();
    expect(history.beginUndo("b1")).toBeNull(); // second time: already undone
  });

  it("cancelUndo restores the flag so a failed reversal can be retried", () => {
    history.record("delete", ["a"], "b1", "2026-01-01T00:00:00Z");
    history.beginUndo("b1");
    history.cancelUndo("b1");
    expect(history.list()[0]!.undone).toBe(false);
    expect(history.beginUndo("b1")).not.toBeNull(); // undoable again
  });
});

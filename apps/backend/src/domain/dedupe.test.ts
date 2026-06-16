import { describe, expect, it } from "vitest";
import { makeTrack } from "./fixtures";
import { chunk, deleteIds, isEmptyPlan, planDeletions } from "./dedupe";

const dup = (id: string, over: Partial<Parameters<typeof makeTrack>[0]> = {}) =>
  makeTrack({ id, name: "Song", artists: ["A"], ...over });

describe("planDeletions — popularity strategy", () => {
  it("keeps the most popular", () => {
    const plan = planDeletions([[dup("low", { popularity: 10 }), dup("high", { popularity: 90 })]]);
    expect(plan.resolutions[0]!.keep.id).toBe("high");
    expect(plan.resolutions[0]!.remove.map((t) => t.id)).toEqual(["low"]);
  });

  it("breaks ties toward the earliest added", () => {
    const plan = planDeletions([
      [
        dup("newer", { popularity: 50, addedAt: "2022-01-01T00:00:00Z" }),
        dup("older", { popularity: 50, addedAt: "2020-01-01T00:00:00Z" }),
      ],
    ]);
    expect(plan.resolutions[0]!.keep.id).toBe("older");
  });

  it("is deterministic when popularity and addedAt both tie", () => {
    const plan = planDeletions([[dup("b", { addedAt: null }), dup("a", { addedAt: null })]]);
    expect(plan.resolutions[0]!.keep.id).toBe("a");
    expect(plan.resolutions[0]!.remove.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("planDeletions — oldest strategy", () => {
  it("keeps the earliest added", () => {
    const plan = planDeletions(
      [
        [
          dup("new", { addedAt: "2022-01-01T00:00:00Z" }),
          dup("old", { addedAt: "2019-01-01T00:00:00Z" }),
        ],
      ],
      "oldest",
    );
    expect(plan.resolutions[0]!.keep.id).toBe("old");
  });

  it("treats a missing addedAt as newest (keeps the dated copy)", () => {
    const plan = planDeletions(
      [[dup("no_date", { addedAt: null }), dup("dated", { addedAt: "2020-01-01T00:00:00Z" })]],
      "oldest",
    );
    expect(plan.resolutions[0]!.keep.id).toBe("dated");
  });
});

describe("planDeletions — playability override", () => {
  it("keeps the playable copy even when the dead one is more popular", () => {
    const plan = planDeletions([
      [
        dup("dead", { popularity: 99, isPlayable: false }),
        dup("alive", { popularity: 10, isPlayable: true }),
      ],
    ]);
    expect(plan.resolutions[0]!.keep.id).toBe("alive");
    expect(plan.resolutions[0]!.remove.map((t) => t.id)).toEqual(["dead"]);
  });
});

describe("plan composition", () => {
  it("removes all but one per group", () => {
    const plan = planDeletions([
      [
        dup("a", { popularity: 10 }),
        dup("b", { popularity: 20 }),
        dup("c", { popularity: 30 }),
      ],
    ]);
    expect(plan.resolutions[0]!.keep.id).toBe("c");
    expect(new Set(plan.resolutions[0]!.remove.map((t) => t.id))).toEqual(new Set(["a", "b"]));
  });

  it("flattens delete ids across groups", () => {
    const plan = planDeletions([
      [dup("a", { popularity: 10 }), dup("keep1", { popularity: 99 })],
      [dup("b", { popularity: 10 }), dup("keep2", { popularity: 99 })],
    ]);
    expect(new Set(deleteIds(plan))).toEqual(new Set(["a", "b"]));
  });

  it("gives an empty plan for no groups", () => {
    const plan = planDeletions([]);
    expect(deleteIds(plan)).toEqual([]);
    expect(isEmptyPlan(plan)).toBe(true);
  });
});

describe("chunk", () => {
  it("splits into fixed-size batches with a short final batch", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `t${i}`);
    expect(chunk(ids, 50).map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it("returns no batches for an empty list", () => {
    expect(chunk([], 50)).toEqual([]);
  });
});

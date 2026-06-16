import { describe, expect, it } from "vitest";
import { makeTrack } from "./fixtures";
import { buildCleanup } from "./cleanup";

const song = (id: string, over: Partial<Parameters<typeof makeTrack>[0]> = {}) =>
  makeTrack({ id, name: "Song", artists: ["A"], ...over });

describe("buildCleanup", () => {
  it("returns nothing when there are no confident duplicates", () => {
    expect(
      buildCleanup([song("1", { name: "A" }), song("2", { name: "B" })]),
    ).toEqual([]);
  });

  it("lists every removable copy, keeping one per group", () => {
    const items = buildCleanup([
      song("keep", { popularity: 90 }),
      song("drop1", { popularity: 10 }),
      song("drop2", { popularity: 20 }),
    ]);
    expect(items.map((i) => i.id).sort()).toEqual(["drop1", "drop2"]);
  });

  it("flags a dead copy that has a playable twin with the stale reason", () => {
    const items = buildCleanup([
      song("alive", { isPlayable: true, popularity: 10 }),
      song("dead", { isPlayable: false, popularity: 99 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("dead");
    expect(items[0]!.reason).toContain("已失效");
  });

  it("uses the duplicate reason when both copies are playable", () => {
    const items = buildCleanup([
      song("keep", { popularity: 90 }),
      song("drop", { popularity: 10 }),
    ]);
    expect(items[0]!.reason).toContain("重複");
  });

  it("joins multiple artists into the display string", () => {
    const items = buildCleanup([
      song("keep", { artists: ["A", "B"], popularity: 90 }),
      song("drop", { artists: ["A", "B"], popularity: 10 }),
    ]);
    expect(items[0]!.artist).toBe("A, B");
  });
});

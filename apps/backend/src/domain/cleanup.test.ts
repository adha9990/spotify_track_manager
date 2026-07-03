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

  it("returns one group per duplicate set, pairing keep with its removals", () => {
    const groups = buildCleanup([
      song("keep", { popularity: 90 }),
      song("drop1", { popularity: 10 }),
      song("drop2", { popularity: 20 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.id).toBe("keep");
    expect(groups[0]!.removals.map((r) => r.track.id).sort()).toEqual(["drop1", "drop2"]);
  });

  it("carries the keep side's full track info (the UI renders both sides)", () => {
    const groups = buildCleanup([
      song("keep", { popularity: 90, album: "首版" }),
      song("drop", { popularity: 10, album: "重發版" }),
    ]);
    expect(groups[0]!.keep.album).toBe("首版");
    expect(groups[0]!.removals[0]!.track.album).toBe("重發版");
  });

  it("flags a dead copy that has a playable twin with the stale reason", () => {
    const groups = buildCleanup([
      song("alive", { isPlayable: true, popularity: 10 }),
      song("dead", { isPlayable: false, popularity: 99 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.id).toBe("alive");
    expect(groups[0]!.removals[0]!.track.id).toBe("dead");
    expect(groups[0]!.removals[0]!.reason).toContain("已失效");
  });

  it("uses the duplicate reason when both copies are playable", () => {
    const groups = buildCleanup([
      song("keep", { popularity: 90 }),
      song("drop", { popularity: 10 }),
    ]);
    expect(groups[0]!.removals[0]!.reason).toContain("重複");
  });

  it("mixes reasons within one group (a dead copy and a low-popularity copy)", () => {
    const groups = buildCleanup([
      song("keep", { popularity: 90 }),
      song("dead", { isPlayable: false, popularity: 99 }),
      song("low", { popularity: 10 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.id).toBe("keep");
    const byId = Object.fromEntries(groups[0]!.removals.map((r) => [r.track.id, r.reason]));
    expect(byId["dead"]).toContain("已失效");
    expect(byId["low"]).toContain("重複");
  });

  it("keeps the playable Simplified-Chinese copy over a dead Traditional-Chinese copy of the same song (S2)", () => {
    const groups = buildCleanup([
      makeTrack({
        id: "dead-trad",
        name: "演員",
        artists: ["薛之謙"],
        isPlayable: false,
        popularity: 90,
      }),
      makeTrack({
        id: "alive-simp",
        name: "演员",
        artists: ["薛之谦"],
        isPlayable: true,
        popularity: 55,
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.id).toBe("alive-simp");
    expect(groups[0]!.removals).toHaveLength(1);
    expect(groups[0]!.removals[0]!.track.id).toBe("dead-trad");
    expect(groups[0]!.removals[0]!.reason).toContain("已失效");
  });
});

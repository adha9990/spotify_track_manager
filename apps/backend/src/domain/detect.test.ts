import { describe, expect, it } from "vitest";
import { makeTrack } from "./fixtures";
import {
  findConfidentDuplicates,
  findExactDuplicates,
  findIsrcDuplicates,
  findNameOnlyDuplicates,
  findUnplayable,
  normalize,
} from "./detect";

const ids = (group: { id: string }[]) => new Set(group.map((t) => t.id));

describe("normalize", () => {
  it("lowercases and trims", () => {
    expect(normalize("  Hello World  ")).toBe("hello world");
  });
  it("collapses internal whitespace", () => {
    expect(normalize("Hello    World")).toBe("hello world");
  });
});

describe("findExactDuplicates", () => {
  it("groups same name and artist", () => {
    const groups = findExactDuplicates([
      makeTrack({ id: "1", name: "Song", artists: ["A"] }),
      makeTrack({ id: "2", name: "Song", artists: ["A"] }),
      makeTrack({ id: "3", name: "Other", artists: ["A"] }),
    ]);
    expect(groups).toHaveLength(1);
    expect(ids(groups[0]!)).toEqual(new Set(["1", "2"]));
  });

  it("ignores case and spacing", () => {
    const groups = findExactDuplicates([
      makeTrack({ id: "1", name: "Song", artists: ["A"] }),
      makeTrack({ id: "2", name: "  song ", artists: ["a"] }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("does not group a different artist", () => {
    expect(
      findExactDuplicates([
        makeTrack({ id: "1", name: "Song", artists: ["A"] }),
        makeTrack({ id: "2", name: "Song", artists: ["B"] }),
      ]),
    ).toEqual([]);
  });
});

describe("findIsrcDuplicates", () => {
  it("groups identical ISRC", () => {
    const groups = findIsrcDuplicates([
      makeTrack({ id: "1", name: "X", isrc: "US1111111111" }),
      makeTrack({ id: "2", name: "Y", isrc: "US1111111111" }),
      makeTrack({ id: "3", name: "Z", isrc: "US2222222222" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(ids(groups[0]!)).toEqual(new Set(["1", "2"]));
  });

  it("ignores null ISRC", () => {
    expect(
      findIsrcDuplicates([
        makeTrack({ id: "1", name: "X", isrc: null }),
        makeTrack({ id: "2", name: "Y", isrc: null }),
      ]),
    ).toEqual([]);
  });
});

describe("findConfidentDuplicates", () => {
  it("merges overlapping name and ISRC groups via union-find", () => {
    // 1&2 same name+artist; 2&3 same ISRC → all three are one component.
    const groups = findConfidentDuplicates([
      makeTrack({ id: "1", name: "Song", artists: ["A"], isrc: "US1111111111" }),
      makeTrack({ id: "2", name: "Song", artists: ["A"], isrc: "US9999999999" }),
      makeTrack({ id: "3", name: "Diff", artists: ["B"], isrc: "US9999999999" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(ids(groups[0]!)).toEqual(new Set(["1", "2", "3"]));
  });

  it("keeps unrelated groups separate", () => {
    const groups = findConfidentDuplicates([
      makeTrack({ id: "1", name: "Song", artists: ["A"] }),
      makeTrack({ id: "2", name: "Song", artists: ["A"] }),
      makeTrack({ id: "3", name: "Other", artists: ["B"], isrc: "US3333333333" }),
      makeTrack({ id: "4", name: "Other", artists: ["B"], isrc: "US3333333333" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => ids(g)))).toBeDefined();
    expect(groups.map((g) => g.length).sort()).toEqual([2, 2]);
  });
});

describe("findNameOnlyDuplicates", () => {
  it("returns one representative per distinct artist for coincidental same names", () => {
    const groups = findNameOnlyDuplicates([
      makeTrack({ id: "1", name: "Halo", artists: ["A"] }),
      makeTrack({ id: "2", name: "Halo", artists: ["A"] }), // same artist → one row
      makeTrack({ id: "3", name: "Halo", artists: ["B"] }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2); // one per distinct artist (A, B)
    expect(new Set(groups[0]!.map((t) => t.artists[0]))).toEqual(new Set(["A", "B"]));
  });

  it("ignores a title that only appears under one artist", () => {
    expect(
      findNameOnlyDuplicates([
        makeTrack({ id: "1", name: "Halo", artists: ["A"] }),
        makeTrack({ id: "2", name: "Halo", artists: ["A"] }),
      ]),
    ).toEqual([]);
  });
});

describe("findUnplayable", () => {
  it("returns only the unplayable tracks", () => {
    const dead = findUnplayable([
      makeTrack({ id: "1", isPlayable: true }),
      makeTrack({ id: "2", isPlayable: false }),
    ]);
    expect(dead.map((t) => t.id)).toEqual(["2"]);
  });
});

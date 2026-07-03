import { describe, expect, it } from "vitest";
import { makeTrack } from "./fixtures";
import { findSuspectPairs } from "./suspects";

// findSuspectPairs surfaces *suspected* duplicates that findConfidentDuplicates (detect.ts)
// would miss — near-identical titles by the same primary artist, e.g. a live/remaster
// version or a title with a typo. It must never overlap the confident-duplicate layer
// (S7) and must respect the user's per-pair "not a duplicate" dismissals.
//
// Test names cite the requirement they pin down: the numbered items from the spec
// (1, 2a, 2b, 3a, 3b, 3c, 4, 5, 6, 7, 8), plus the cross-cutting codes S6 (hint wording)
// and S7 (no overlap with confident duplicates) called out explicitly in the spec.

const keyOf = (a: string, b: string) => [a, b].sort().join("|");
const noDismissals = () => ({ dismissed: new Set<string>() });

describe("findSuspectPairs — candidates are limited to the same primary artist (1)", () => {
  it("does not match same-titled tracks across different primary artists", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Lemon", artists: ["米津玄師"], isPlayable: true }),
        makeTrack({ id: "2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false }),
        makeTrack({ id: "3", name: "Lemon", artists: ["Other Artist"], isPlayable: true }),
      ],
      noDismissals(),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.pairKey).toBe(keyOf("1", "2"));
  });

  it("ignores a shared featured artist — only artists[0] determines the bucket", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Sunshine", artists: ["Alice", "Common Feature"] }),
        makeTrack({ id: "2", name: "Sunshine - Live", artists: ["Carol", "Common Feature"] }),
      ],
      noDismissals(),
    );
    expect(pairs).toEqual([]);
  });

  it("buckets the primary artist via canonical, so a Traditional/Simplified spelling counts as the same artist", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "夜空中最亮的星 陪我長大", artists: ["薛之謙"] }),
        makeTrack({ id: "2", name: "夜空中最亮的星 陪伴我長大", artists: ["薛之谦"] }),
      ],
      noDismissals(),
    );
    expect(pairs).toHaveLength(1);
  });
});

describe("findSuspectPairs — version-suffix admission (2a)", () => {
  it.each([
    ["Track Title", "Track Title - Live"],
    ["Track Title", "Track Title (Remastered)"],
    ["Track Title", "Track Title (feat. Guest)"],
  ])("pairs %s with the version-suffixed %s, score 1", (base, suffixed) => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: base, artists: ["米津玄師"] }),
        makeTrack({ id: "2", name: suffixed, artists: ["米津玄師"] }),
      ],
      noDismissals(),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.score).toBe(1);
    expect(pairs[0]!.hints.some((h) => h.includes("版本差異"))).toBe(true);
  });

  it("matches the spec example (Lemon / Lemon - Live, 米津玄師)", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Lemon", artists: ["米津玄師"], isPlayable: true, popularity: 80 }),
        makeTrack({ id: "2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false, popularity: 60 }),
      ],
      noDismissals(),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.score).toBe(1);
    expect(pairs[0]!.hints.some((h) => h.includes("版本差異"))).toBe(true);
  });
});

describe("findSuspectPairs — char-bigram Dice admission (2b)", () => {
  it("pairs near-identical titles that are not a version-suffix relation, score = Dice value in [0.85, 1)", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "夜空中最亮的星 陪我長大", artists: ["逃跑計劃"], isPlayable: true, popularity: 70 }),
        makeTrack({ id: "2", name: "夜空中最亮的星 陪伴我長大", artists: ["逃跑計劃"], isPlayable: true, popularity: 40 }),
      ],
      noDismissals(),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.score).toBeGreaterThanOrEqual(0.85);
    expect(pairs[0]!.score).toBeLessThan(1);
    expect(pairs[0]!.hints.some((h) => h.includes("名稱相似"))).toBe(true);
  });

  it("does not pair titles below the 0.85 Dice threshold", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Hello World", artists: ["Artist"] }),
        makeTrack({ id: "2", name: "Goodbye World", artists: ["Artist"] }),
      ],
      noDismissals(),
    );
    expect(pairs).toEqual([]);
  });
});

describe("findSuspectPairs — excludes confident duplicates, no overlap with detect.ts (3a / S7)", () => {
  it("does not surface a Traditional/Simplified exact duplicate (already confident) as a suspect pair", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "演員", artists: ["薛之謙"], isPlayable: true, popularity: 72 }),
        makeTrack({ id: "2", name: "演员", artists: ["薛之谦"], isPlayable: true, popularity: 55 }),
      ],
      noDismissals(),
    );
    expect(pairs).toEqual([]);
  });

  it("does not surface a same-ISRC pair even though the titles alone would pass the Dice threshold", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "夜空中最亮的星 陪我長大", artists: ["逃跑計劃"], isrc: "USABC1234567" }),
        makeTrack({ id: "2", name: "夜空中最亮的星 陪伴我長大", artists: ["逃跑計劃"], isrc: "USABC1234567" }),
      ],
      noDismissals(),
    );
    expect(pairs).toEqual([]);
  });
});

describe("findSuspectPairs — dismissed pairs are excluded (3b)", () => {
  it("drops a pair whose pairKey is in opts.dismissed", () => {
    const tracks = [
      makeTrack({ id: "1", name: "Lemon", artists: ["米津玄師"], isPlayable: true }),
      makeTrack({ id: "2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false }),
    ];
    expect(
      findSuspectPairs(tracks, { dismissed: new Set([keyOf("1", "2")]) }),
    ).toEqual([]);
  });

  it("keeps the pair when opts.dismissed holds an unrelated key", () => {
    const tracks = [
      makeTrack({ id: "1", name: "Lemon", artists: ["米津玄師"], isPlayable: true }),
      makeTrack({ id: "2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false }),
    ];
    expect(
      findSuspectPairs(tracks, { dismissed: new Set(["x|y"]) }),
    ).toHaveLength(1);
  });
});

describe("findSuspectPairs — same title, different primary artist is coincidence, not a pair (3c)", () => {
  it("does not pair identical titles when the primary artist differs", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Halo", artists: ["Beyoncé"] }),
        makeTrack({ id: "2", name: "Halo", artists: ["Måneskin"] }),
      ],
      noDismissals(),
    );
    expect(pairs).toEqual([]);
  });
});

describe("findSuspectPairs — keep/remove follow the keep-policy (4)", () => {
  it("keeps the playable copy over the dead one regardless of popularity", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Lemon", artists: ["米津玄師"], isPlayable: true, popularity: 20 }),
        makeTrack({ id: "2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false, popularity: 95 }),
      ],
      noDismissals(),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.keep.id).toBe("1");
    expect(pairs[0]!.remove.id).toBe("2");
  });

  it("when both copies are playable, keeps the more popular one", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "夜空中最亮的星 陪我長大", artists: ["逃跑計劃"], isPlayable: true, popularity: 30 }),
        makeTrack({ id: "2", name: "夜空中最亮的星 陪伴我長大", artists: ["逃跑計劃"], isPlayable: true, popularity: 90 }),
      ],
      noDismissals(),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.keep.id).toBe("2");
    expect(pairs[0]!.remove.id).toBe("1");
  });
});

describe("findSuspectPairs — hint for a dead copy with a playable twin (5 / S6)", () => {
  it("adds a 庫中已有相似曲 hint when remove is unplayable and keep is playable", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Lemon", artists: ["米津玄師"], isPlayable: true, popularity: 80 }),
        makeTrack({ id: "2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false, popularity: 60 }),
      ],
      noDismissals(),
    );
    expect(pairs[0]!.hints.some((h) => h.includes("庫中已有相似曲"))).toBe(true);
  });

  it("does not add the hint when both copies are playable", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Lemon", artists: ["米津玄師"], isPlayable: true, popularity: 80 }),
        makeTrack({ id: "2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: true, popularity: 60 }),
      ],
      noDismissals(),
    );
    expect(pairs[0]!.hints.some((h) => h.includes("庫中已有相似曲"))).toBe(false);
  });
});

describe("findSuspectPairs — pairKey format (6)", () => {
  it("is the two ids sorted and joined with |, independent of input array order", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "z9", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false }),
        makeTrack({ id: "a1", name: "Lemon", artists: ["米津玄師"], isPlayable: true }),
      ],
      noDismissals(),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.pairKey).toBe("a1|z9");
  });
});

describe("findSuspectPairs — auxiliary duration/album hints (7)", () => {
  it("adds 時長相近 when durations differ by at most 5 seconds (inclusive boundary)", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Track Title", artists: ["Artist"], isPlayable: true, durationMs: 200_000 }),
        makeTrack({ id: "2", name: "Track Title - Live", artists: ["Artist"], isPlayable: false, durationMs: 205_000 }),
      ],
      noDismissals(),
    );
    expect(pairs[0]!.hints.some((h) => h.includes("時長相近"))).toBe(true);
  });

  it("omits 時長相近 once the gap exceeds 5 seconds", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Track Title", artists: ["Artist"], isPlayable: true, durationMs: 200_000 }),
        makeTrack({ id: "2", name: "Track Title - Live", artists: ["Artist"], isPlayable: false, durationMs: 205_001 }),
      ],
      noDismissals(),
    );
    expect(pairs[0]!.hints.some((h) => h.includes("時長相近"))).toBe(false);
  });

  it("adds 同專輯 when both copies share an album name", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "夜空中最亮的星 陪我長大", artists: ["逃跑計劃"], album: "同張專輯" }),
        makeTrack({ id: "2", name: "夜空中最亮的星 陪伴我長大", artists: ["逃跑計劃"], album: "同張專輯" }),
      ],
      noDismissals(),
    );
    expect(pairs[0]!.hints.some((h) => h.includes("同專輯"))).toBe(true);
  });

  it("omits 同專輯 when the album names differ", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "夜空中最亮的星 陪我長大", artists: ["逃跑計劃"], album: "首版專輯" }),
        makeTrack({ id: "2", name: "夜空中最亮的星 陪伴我長大", artists: ["逃跑計劃"], album: "重發專輯" }),
      ],
      noDismissals(),
    );
    expect(pairs[0]!.hints.some((h) => h.includes("同專輯"))).toBe(false);
  });
});

describe("findSuspectPairs — pure function (8)", () => {
  it("returns the same result for the same input across repeated calls", () => {
    const tracks = [
      makeTrack({ id: "1", name: "Lemon", artists: ["米津玄師"], isPlayable: true, popularity: 80 }),
      makeTrack({ id: "2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false, popularity: 60 }),
      makeTrack({ id: "3", name: "Unrelated Title", artists: ["Someone Else"] }),
    ];
    const opts = noDismissals();
    expect(findSuspectPairs(tracks, opts)).toEqual(findSuspectPairs(tracks, opts));
  });
});

describe("findSuspectPairs — multiple independent artist buckets", () => {
  it("returns one pair per matching bucket and ignores a singleton bucket", () => {
    const pairs = findSuspectPairs(
      [
        makeTrack({ id: "1", name: "Lemon", artists: ["米津玄師"], isPlayable: true }),
        makeTrack({ id: "2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false }),
        makeTrack({ id: "3", name: "夜空中最亮的星 陪我長大", artists: ["逃跑計劃"] }),
        makeTrack({ id: "4", name: "夜空中最亮的星 陪伴我長大", artists: ["逃跑計劃"] }),
        makeTrack({ id: "5", name: "Completely Unrelated Solo Title", artists: ["Solo Artist"] }),
      ],
      noDismissals(),
    );
    expect(pairs.map((p) => p.pairKey).sort()).toEqual([keyOf("1", "2"), keyOf("3", "4")]);
  });
});

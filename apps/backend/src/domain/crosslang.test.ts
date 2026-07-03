import { describe, expect, it } from "vitest";
import { findConfidentDuplicates } from "./detect";
import { makeTrack } from "./fixtures";
import { findCrossLanguagePairs } from "./crosslang";

// findCrossLanguagePairs surfaces suspected duplicates whose titles are semantically
// the same across languages (e.g. a Chinese title and its English title) where no
// text-similarity signal (suspects.ts) would ever catch it. Matching is driven purely
// by an injected trackId -> vector map (L2-normalized) + cosine-similarity admission,
// so titles/artists here are cross-language decoration only — the vectors are what the
// function actually reads. Vectors are deliberately simple 2D unit vectors so the cosine
// is exact and test intent is legible: [1,0]·[1,0] = 1 (identical), [1,0]·[0,1] = 0
// (orthogonal / unrelated).
//
// Test names cite the requirement they pin down: S1-S8 from the contract.

const keyOf = (a: string, b: string) => [a, b].sort().join("|");
const baseOpts = () => ({
  vectors: new Map<string, number[]>(),
  confidentGroups: [] as ReturnType<typeof findConfidentDuplicates>,
  dismissed: new Set<string>(),
});

describe("findCrossLanguagePairs — surfaces a cross-language pair on cosine >= threshold (S1)", () => {
  it("pairs 告白氣球/周杰倫 with Bubble/Jay Chou when their injected vectors are identical (cosine 1)", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], isPlayable: true, popularity: 80, durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], isPlayable: true, popularity: 40, durationMs: 201_000 }),
    ];
    const vectors = new Map<string, number[]>([
      ["1", [1, 0]],
      ["2", [1, 0]],
    ]);

    const pairs = findCrossLanguagePairs(tracks, {
      ...baseOpts(),
      vectors,
      threshold: 0.82,
    });

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.pairKey).toBe(keyOf("1", "2"));
    expect(pairs[0]!.hints).toContain("跨語言相似");
    expect(pairs[0]!.score).toBeCloseTo(1, 5);
    // keep-policy: both playable, higher popularity wins -> id "1" is kept.
    expect(pairs[0]!.keep.id).toBe("1");
    expect(pairs[0]!.remove.id).toBe("2");
  });
});

describe("findCrossLanguagePairs — duration guard vetoes an otherwise-qualifying pair (S2)", () => {
  it("does not pair when |durationMs diff| exceeds durationHintMs even though cosine >= threshold", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], durationMs: 250_000 }),
    ];
    const vectors = new Map<string, number[]>([
      ["1", [1, 0]],
      ["2", [1, 0]],
    ]);

    const pairs = findCrossLanguagePairs(tracks, {
      ...baseOpts(),
      vectors,
      threshold: 0.82,
      durationHintMs: 5000,
    });

    expect(pairs).toEqual([]);
  });
});

describe("findCrossLanguagePairs — below-threshold cosine never admits a pair (S3)", () => {
  it("does not pair when the injected vectors are orthogonal (cosine 0), even with close durations", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Unrelated Song", artists: ["Other Artist"], durationMs: 200_500 }),
    ];
    const vectors = new Map<string, number[]>([
      ["1", [1, 0]],
      ["2", [0, 1]],
    ]);

    const pairs = findCrossLanguagePairs(tracks, {
      ...baseOpts(),
      vectors,
      threshold: 0.82,
    });

    expect(pairs).toEqual([]);
  });
});

describe("findCrossLanguagePairs — never overlaps the confident-duplicate layer (S4)", () => {
  it("does not surface a pair whose two tracks are already members of the same confidentGroups entry", () => {
    const trackA = makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 });
    const trackB = makeTrack({ id: "2", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 });
    const vectors = new Map<string, number[]>([
      ["1", [1, 0]],
      ["2", [1, 0]],
    ]);

    const pairs = findCrossLanguagePairs([trackA, trackB], {
      vectors,
      confidentGroups: [[trackA, trackB]],
      dismissed: new Set(),
      threshold: 0.82,
    });

    expect(pairs).toEqual([]);
  });
});

describe("findCrossLanguagePairs — respects the caller's dismissed pairKeys (S5)", () => {
  it("drops an otherwise-qualifying pair whose sorted-id pairKey is in opts.dismissed", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], durationMs: 200_500 }),
    ];
    const vectors = new Map<string, number[]>([
      ["1", [1, 0]],
      ["2", [1, 0]],
    ]);

    const pairs = findCrossLanguagePairs(tracks, {
      vectors,
      confidentGroups: [],
      dismissed: new Set([keyOf("1", "2")]),
      threshold: 0.82,
    });

    expect(pairs).toEqual([]);
  });
});

describe("findCrossLanguagePairs — a same-id pair is skipped, never crashes (S6)", () => {
  it("returns [] without throwing when two track entries share the same id", () => {
    const shared = makeTrack({ id: "dup-1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 });
    const vectors = new Map<string, number[]>([["dup-1", [1, 0]]]);

    expect(() =>
      findCrossLanguagePairs([shared, { ...shared }], {
        vectors,
        confidentGroups: [],
        dismissed: new Set(),
        threshold: 0.82,
      }),
    ).not.toThrow();

    const pairs = findCrossLanguagePairs([shared, { ...shared }], {
      vectors,
      confidentGroups: [],
      dismissed: new Set(),
      threshold: 0.82,
    });
    expect(pairs).toEqual([]);
  });
});

describe("findCrossLanguagePairs — a track missing from the vectors map is skipped silently (S7)", () => {
  it("does not throw or produce a NaN-score pair for the vector-less track, but still surfaces a qualifying pair among the rest", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], durationMs: 200_500 }),
      makeTrack({ id: "3", name: "No Vector Track", artists: ["Some Artist"], durationMs: 200_100 }),
    ];
    // "3" is deliberately absent from vectors.
    const vectors = new Map<string, number[]>([
      ["1", [1, 0]],
      ["2", [1, 0]],
    ]);

    let pairs: ReturnType<typeof findCrossLanguagePairs> = [];
    expect(() => {
      pairs = findCrossLanguagePairs(tracks, {
        vectors,
        confidentGroups: [],
        dismissed: new Set(),
        threshold: 0.82,
      });
    }).not.toThrow();

    expect(pairs.some((p) => Number.isNaN(p.score))).toBe(false);
    expect(pairs.some((p) => p.pairKey === keyOf("1", "3") || p.pairKey === keyOf("2", "3"))).toBe(false);
    expect(pairs.some((p) => p.pairKey === keyOf("1", "2"))).toBe(true);
  });
});

describe("findCrossLanguagePairs — dead-copy hint reused from suspects.ts buildHints (S8)", () => {
  it("adds 庫中已有相似曲 when the removed track is unplayable and the kept one is playable", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], isPlayable: true, popularity: 80, durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], isPlayable: false, popularity: 40, durationMs: 200_500 }),
    ];
    const vectors = new Map<string, number[]>([
      ["1", [1, 0]],
      ["2", [1, 0]],
    ]);

    const pairs = findCrossLanguagePairs(tracks, {
      vectors,
      confidentGroups: [],
      dismissed: new Set(),
      threshold: 0.82,
    });

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.keep.id).toBe("1");
    expect(pairs[0]!.remove.id).toBe("2");
    expect(pairs[0]!.hints).toContain("庫中已有相似曲");
  });
});

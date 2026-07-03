import { describe, expect, it } from "vitest";
import { findConfidentDuplicates } from "./detect";
import { makeTrack } from "./fixtures";
import { CROSSLANG_MAX_TRACKS, findCrossLanguagePairs } from "./crosslang";

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

// --- Hardening guards below: pin new behaviors not yet implemented (F1, F3, F8, perf-cap). ---

describe("findCrossLanguagePairs — a NaN-producing vector is never admitted (F1)", () => {
  it("does not pair (and never emits a NaN score) when one vector contains NaN even though the naive comparison NaN<threshold is false", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], durationMs: 200_500 }),
    ];
    const vectors = new Map<string, number[]>([
      ["1", [NaN, 0]],
      ["2", [1, 0]],
    ]);

    const pairs = findCrossLanguagePairs(tracks, {
      ...baseOpts(),
      vectors,
      threshold: 0.82,
    });

    expect(pairs).toEqual([]);
    expect(pairs.some((p) => Number.isNaN(p.score))).toBe(false);
  });

  // A [0,0] vs [0,0] case does NOT actually reproduce the bug this guard exists for:
  // a plain dot product of two zero vectors is 0 (not NaN), so `cosine < threshold`
  // already rejects it under the old (unguarded) code too — it proves nothing about
  // the NaN guard specifically. This case instead uses a vector whose magnitude is
  // itself infinite, so dotProduct/(|a|*|b|) genuinely evaluates to NaN (Infinity *
  // 0 = NaN in the dot product, and any further division by Infinity is NaN too) —
  // a case the naive `cosine < threshold` comparison would silently ADMIT, since
  // `NaN < threshold` is `false` in JS and would fall through to accepting the pair.
  it("does not pair (and never emits a NaN score) when a vector's dot product/cosine evaluates to NaN via infinite components", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], durationMs: 200_500 }),
    ];
    const vectors = new Map<string, number[]>([
      ["1", [Infinity, -Infinity]],
      ["2", [1, 0]],
    ]);

    const pairs = findCrossLanguagePairs(tracks, {
      ...baseOpts(),
      vectors,
      threshold: 0.82,
    });

    expect(pairs).toEqual([]);
    expect(pairs.some((p) => Number.isNaN(p.score))).toBe(false);
  });
});

describe("findCrossLanguagePairs — mismatched vector dimensions are never admitted (F3)", () => {
  it("skips a pair whose vectors have different lengths instead of computing a truncated (meaningless) dot product", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], durationMs: 200_500 }),
    ];
    // Truncated dot (Math.min length=2) would compute 1*1 + 0*0 = 1 >= threshold and wrongly admit.
    const vectors = new Map<string, number[]>([
      ["1", [1, 0, 0]],
      ["2", [1, 0]],
    ]);

    const pairs = findCrossLanguagePairs(tracks, {
      ...baseOpts(),
      vectors,
      threshold: 0.82,
    });

    expect(pairs).toEqual([]);
  });
});

describe("findCrossLanguagePairs — boundary values are inclusive (F8)", () => {
  it("admits a pair whose cosine is exactly equal to the threshold", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], durationMs: 200_500 }),
    ];
    // a=[1,0], b=[0.5, sqrt(0.75)] are both unit vectors and a·b = 0.5 exactly.
    const vectors = new Map<string, number[]>([
      ["1", [1, 0]],
      ["2", [0.5, Math.sqrt(0.75)]],
    ]);

    const pairs = findCrossLanguagePairs(tracks, {
      ...baseOpts(),
      vectors,
      threshold: 0.5,
    });

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.score).toBeCloseTo(0.5, 5);
  });

  it("admits a pair whose |durationMs diff| is exactly equal to durationHintMs", () => {
    const tracks = [
      makeTrack({ id: "1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
      makeTrack({ id: "2", name: "Bubble", artists: ["Jay Chou"], durationMs: 205_000 }),
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

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.pairKey).toBe(keyOf("1", "2"));
  });
});

describe("findCrossLanguagePairs — a large library skips the O(n^2) pass entirely (perf cap)", () => {
  it("returns [] when tracks.length exceeds CROSSLANG_MAX_TRACKS, even though every pair would otherwise qualify", () => {
    const tracks = Array.from({ length: CROSSLANG_MAX_TRACKS + 1 }, (_, i) =>
      makeTrack({ id: `t${i}`, name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000 }),
    );
    const vectors = new Map<string, number[]>(tracks.map((t) => [t.id, [1, 0]]));

    const pairs = findCrossLanguagePairs(tracks, {
      ...baseOpts(),
      vectors,
      threshold: 0.82,
    });

    expect(pairs).toEqual([]);
  });
});

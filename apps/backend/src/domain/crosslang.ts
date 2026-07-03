import type { SuspectPair, Track } from "@stm/shared";
import { type Admission, pairKeyOf, toPair } from "./suspects";

// Cross-language duplicate detection: the same song under a Chinese title and its
// English (or other-language) title, which findSuspectPairs' text-similarity signal
// (canonical/Dice) can never catch since the strings don't overlap at all. Matching
// instead relies on a caller-injected trackId -> embedding-vector map (semantic
// similarity, e.g. from a text-embedding model) admitted by cosine similarity.
// Pure logic, zero I/O: this module never computes a vector itself, only consumes
// the ones it's handed — the model call is an adapter-layer concern, not domain's.
// Never overlaps the confident-duplicate layer and always respects dismissals,
// mirroring findSuspectPairs' contract.

/** Cosine-similarity floor for admitting a cross-language pair. */
export const CROSSLANG_THRESHOLD = 0.82;

/**
 * Safety ceiling on the O(n²) pass below: at 6000 tracks that's ~18M pair
 * checks — comfortably above a typical library (~1700 tracks) and Spotify's
 * ~10k-liked-tracks ceiling is where the full 50M-pair pass would stall the
 * event loop for multiple seconds. Past this size cross-language detection
 * just stays off (degrades like ADR-5) rather than blocking the request.
 */
export const CROSSLANG_MAX_TRACKS = 6000;

/** Cheap pre-filter: skip the cosine computation for pairs whose durations differ too much. */
const DEFAULT_DURATION_HINT_MS = 5000;

/** trackId -> confident-duplicate group index, so pairing can skip same-group tracks. */
function groupIndexOf(groups: Track[][]): Map<string, number> {
  const map = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const t of group) map.set(t.id, index);
  });
  return map;
}

/** Dot product of two equal-length vectors; callers pass L2-normalized vectors so this equals cosine similarity. */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) sum += a[i]! * b[i]!;
  return sum;
}

export interface FindCrossLanguagePairsOptions {
  /** trackId -> L2-normalized embedding vector, computed and injected by the caller (adapter layer). */
  vectors: Map<string, number[]>;
  /** Same confident-duplicate groups used elsewhere, so this layer never re-surfaces them. */
  confidentGroups: Track[][];
  /** Previously dismissed pairKeys ("not a duplicate"), same key shape as findSuspectPairs. */
  dismissed: Set<string>;
  /** Cosine-similarity floor; defaults to CROSSLANG_THRESHOLD. */
  threshold?: number;
  /** Max |durationMs| difference to even attempt the cosine check; defaults to 5000ms. */
  durationHintMs?: number;
}

/**
 * Find suspected cross-language duplicate pairs via injected embedding-vector cosine
 * similarity: a full O(n²) pass over `tracks` (not artist-bucketed — a cross-language
 * duplicate's artist name differs), skipping same-id and same-confident-group pairs,
 * pairs missing a vector, pairs whose durations differ too much (cheap pre-filter
 * before the dot product), pairs below the cosine threshold, and dismissed pairKeys.
 */
export function findCrossLanguagePairs(
  tracks: Track[],
  opts: FindCrossLanguagePairsOptions,
): SuspectPair[] {
  if (tracks.length > CROSSLANG_MAX_TRACKS) {
    console.warn(
      `findCrossLanguagePairs: skipping — ${tracks.length} tracks exceeds CROSSLANG_MAX_TRACKS (${CROSSLANG_MAX_TRACKS})`,
    );
    return [];
  }

  const threshold = opts.threshold ?? CROSSLANG_THRESHOLD;
  const durationHintMs = opts.durationHintMs ?? DEFAULT_DURATION_HINT_MS;
  const confidentGroup = groupIndexOf(opts.confidentGroups);
  const pairs: SuspectPair[] = [];

  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i]!;
      const b = tracks[j]!;
      if (a.id === b.id) continue;

      const groupA = confidentGroup.get(a.id);
      if (groupA !== undefined && groupA === confidentGroup.get(b.id)) continue;

      const vectorA = opts.vectors.get(a.id);
      const vectorB = opts.vectors.get(b.id);
      if (!vectorA || !vectorB) continue;
      if (vectorA.length !== vectorB.length) continue; // a truncated dot product would be meaningless

      if (Math.abs(a.durationMs - b.durationMs) > durationHintMs) continue;

      const cosine = dotProduct(vectorA, vectorB);
      if (!(cosine >= threshold)) continue; // rejects NaN too (NaN >= x is always false)

      const pairKey = pairKeyOf(a, b);
      if (opts.dismissed.has(pairKey)) continue;

      const admission: Admission = { score: cosine, hint: "跨語言相似" };
      pairs.push(toPair(a, b, admission));
    }
  }
  return pairs;
}

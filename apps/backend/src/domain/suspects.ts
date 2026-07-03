import type { SuspectPair, Track } from "@stm/shared";
import { canonical } from "./canonical";
import { planDeletions } from "./dedupe";
import { findConfidentDuplicates } from "./detect";

// Suspected (not confident) duplicate detection: near-identical titles by the same
// primary artist that findConfidentDuplicates (detect.ts) does not catch — a
// live/remaster/acoustic variant, or a title with a small spelling difference.
// Pure logic, zero I/O. Never overlaps the confident-duplicate layer (see the
// exclusion in findSuspectPairs) and always respects the caller's dismissals.

export const DICE_THRESHOLD = 0.85;
export const DURATION_HINT_MS = 5000;

// Keywords that mark a bracketed/dashed title tail as a *version* marker rather
// than a meaningful subtitle. Lowercase/simplified — stripVersionSuffix only ever
// tests them against an already-canonicalized (lowercased, simplified) string.
// Extend this list as new version markers turn up.
const VERSION_KEYWORDS = [
  "live",
  "remaster",
  "acoustic",
  "demo",
  "version",
  "ver",
  "mix",
  "edit",
  "remix",
  "instrumental",
  "karaoke",
  "feat",
  "现场",
  "伴奏",
  "纯音乐",
  "版",
];

const hasVersionKeyword = (suffix: string): boolean =>
  VERSION_KEYWORDS.some((kw) => suffix.includes(kw));

/**
 * Strip a trailing "(<suffix>)" or " - <suffix>" from a canonicalized title, but
 * only when the suffix itself names a version/edition (live, remaster, feat., …).
 * A bracketed or dashed tail with no version keyword is left alone — stripping it
 * unconditionally would wrongly conflate two distinct songs that happen to share a
 * common prefix (e.g. a meaningful subtitle).
 */
export function stripVersionSuffix(name: string): string {
  const paren = name.match(/\(([^()]*)\)\s*$/);
  if (paren && hasVersionKeyword(paren[1]!)) {
    return name.slice(0, paren.index).trim();
  }
  const dash = name.match(/\s-\s*([^-]+)$/);
  if (dash && hasVersionKeyword(dash[1]!)) {
    return name.slice(0, dash.index).trim();
  }
  return name;
}

/**
 * Char-bigram Dice coefficient: 2 * |shared bigrams| / (|bigrams(a)| + |bigrams(b)|),
 * counted as a multiset intersection (a repeated bigram only matches as many times
 * as it occurs in both). Returns 1 for identical strings, 0 for no overlap.
 */
export function diceBigram(a: string, b: string): number {
  if (a === b) return 1;
  const bigramsOf = (s: string): string[] =>
    s.length < 2 ? [] : Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
  const bigramsA = bigramsOf(a);
  const bigramsB = bigramsOf(b);
  if (bigramsA.length === 0 || bigramsB.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const bg of bigramsA) counts.set(bg, (counts.get(bg) ?? 0) + 1);
  let shared = 0;
  for (const bg of bigramsB) {
    const remaining = counts.get(bg) ?? 0;
    if (remaining > 0) {
      shared++;
      counts.set(bg, remaining - 1);
    }
  }
  return (2 * shared) / (bigramsA.length + bigramsB.length);
}

const primaryArtist = (t: Track): string => t.artists[0] ?? "";

/** Bucket tracks by canonical primary artist; only buckets with >1 track can pair. */
function bucketByArtist(tracks: Track[]): Track[][] {
  const buckets = new Map<string, Track[]>();
  for (const t of tracks) {
    const key = canonical(primaryArtist(t));
    if (key === "") continue;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(t);
  }
  return [...buckets.values()].filter((g) => g.length > 1);
}

/** trackId -> confident-duplicate group index, so pairing can skip same-group tracks. */
function confidentGroupOf(tracks: Track[]): Map<string, number> {
  const map = new Map<string, number>();
  findConfidentDuplicates(tracks).forEach((group, index) => {
    for (const t of group) map.set(t.id, index);
  });
  return map;
}

interface Admission {
  score: number;
  hint: string;
}

/** Version-suffix match (score 1) takes priority over a fuzzy Dice match. */
function admit(a: Track, b: Track): Admission | null {
  const nameA = canonical(a.name);
  const nameB = canonical(b.name);
  if (stripVersionSuffix(nameA) === stripVersionSuffix(nameB)) {
    return { score: 1, hint: "版本差異" };
  }
  const dice = diceBigram(nameA, nameB);
  if (dice >= DICE_THRESHOLD) {
    return { score: dice, hint: "名稱相似" };
  }
  return null;
}

function buildHints(a: Track, b: Track, admitHint: string, keep: Track, remove: Track): string[] {
  const hints = [admitHint];
  if (Math.abs(a.durationMs - b.durationMs) <= DURATION_HINT_MS) hints.push("時長相近");
  if (a.album === b.album) hints.push("同專輯");
  if (!remove.isPlayable && keep.isPlayable) hints.push("庫中已有相似曲");
  return hints;
}

function toPair(a: Track, b: Track, admission: Admission): SuspectPair {
  const { keep, remove } = planDeletions([[a, b]], "popularity").resolutions[0]!;
  const removed = remove[0]!;
  return {
    keep,
    remove: removed,
    pairKey: [a.id, b.id].sort().join("|"),
    score: admission.score,
    hints: buildHints(a, b, admission.hint, keep, removed),
  };
}

/**
 * Find suspected-duplicate pairs: same canonical primary artist, a near-identical
 * title (version suffix or Dice >= DICE_THRESHOLD), not already a confident
 * duplicate, and not dismissed by the caller.
 */
export function findSuspectPairs(
  tracks: Track[],
  opts: { dismissed: Set<string> },
): SuspectPair[] {
  const confidentGroup = confidentGroupOf(tracks);
  const pairs: SuspectPair[] = [];

  for (const bucket of bucketByArtist(tracks)) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;

        const groupA = confidentGroup.get(a.id);
        if (groupA !== undefined && groupA === confidentGroup.get(b.id)) continue;

        const admission = admit(a, b);
        if (!admission) continue;

        const pairKey = [a.id, b.id].sort().join("|");
        if (opts.dismissed.has(pairKey)) continue;

        pairs.push(toPair(a, b, admission));
      }
    }
  }
  return pairs;
}

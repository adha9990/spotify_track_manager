import type { SuspectPair, Track } from "@stm/shared";
import { canonical } from "./canonical";
import { planDeletions } from "./dedupe";
import { findConfidentDuplicates } from "./detect";

// Suspected (not confident) duplicate detection: near-identical titles by the same
// primary artist that findConfidentDuplicates (detect.ts) does not catch — a
// live/remaster/acoustic variant, or a title with a small spelling difference.
// Pure logic, zero I/O. Never overlaps the confident-duplicate layer (see the
// exclusion in findSuspectPairs) and always respects the caller's dismissals.
//
// Known limitation: the char-bigram Dice admission (below) has no structural
// signal on very short titles — a 2-3 char title has only 1-2 bigrams, so a
// single differing character can swing the score by 0.5+ and either miss a
// real near-duplicate or (rarely) admit one that shouldn't match. Accepted as
// a residual risk; the version-suffix path (score 1) is unaffected.

export const DICE_THRESHOLD = 0.85;
export const DURATION_HINT_MS = 5000;

// Latin/ASCII version markers: matched as a whole word (\b...\b) so a short
// keyword doesn't false-positive inside an unrelated word (e.g. "ver" inside
// "foREVER" or "nEVER" — see the A1/A2 regression tests). Lowercase only —
// stripVersionSuffix always tests against an already-canonicalized (lowercased)
// string. "remaster" and "remastered" are both listed because a whole-word
// match on "remaster" alone does not match "remastered" (no boundary between
// "r" and "e"). Extend this list as new version markers turn up.
const LATIN_VERSION_KEYWORDS = [
  "live",
  "remaster",
  "remastered",
  "acoustic",
  "demo",
  "version",
  "mix",
  "edit",
  "remix",
  "instrumental",
  "karaoke",
  "feat",
];
const LATIN_VERSION_PATTERNS = LATIN_VERSION_KEYWORDS.map((kw) => new RegExp(`\\b${kw}\\b`));

// Chinese version markers: matched as a plain substring. \b has no notion of a
// CJK "word", so these stay substring tests (already-canonicalized text has
// been folded to Simplified Chinese by `canonical`, so only the Simplified
// spelling needs listing).
const CJK_VERSION_KEYWORDS = ["现场", "伴奏", "纯音乐", "版"];

const hasVersionKeyword = (suffix: string): boolean =>
  CJK_VERSION_KEYWORDS.some((kw) => suffix.includes(kw)) ||
  LATIN_VERSION_PATTERNS.some((re) => re.test(suffix));

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

/**
 * O(1) upper bound on diceBigram(a, b) from string lengths alone: the shared-bigram
 * count can never exceed the smaller side's bigram count, so
 * 2*min(|bigrams(a)|,|bigrams(b)|) / (|bigrams(a)|+|bigrams(b)|) bounds the real
 * score from above. Lets the O(b²) pairing loop skip the actual bigram-set
 * computation for pairs that can't possibly reach DICE_THRESHOLD. Returns null
 * (no cheap bound available) when either string has fewer than 2 chars — that
 * edge case is rare and diceBigram itself is O(1) for it anyway.
 */
function diceUpperBound(a: string, b: string): number | null {
  const bigramsA = a.length - 1;
  const bigramsB = b.length - 1;
  if (bigramsA <= 0 || bigramsB <= 0) return null;
  return (2 * Math.min(bigramsA, bigramsB)) / (bigramsA + bigramsB);
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

/** The stable pairKey: the two ids sorted and joined with "|", independent of call order. */
export function pairKeyOf(a: Track, b: Track): string {
  return [a.id, b.id].sort().join("|");
}

/** trackId -> confident-duplicate group index, so pairing can skip same-group tracks. */
function groupIndexOf(groups: Track[][]): Map<string, number> {
  const map = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const t of group) map.set(t.id, index);
  });
  return map;
}

interface Admission {
  score: number;
  hint: string;
}

/** A bucket entry with its canonical/stripped name precomputed once, not per O(b²) pair. */
interface PreparedTrack {
  track: Track;
  canonicalName: string;
  strippedName: string;
}

function prepareBucket(bucket: Track[]): PreparedTrack[] {
  return bucket.map((track) => {
    const canonicalName = canonical(track.name);
    return { track, canonicalName, strippedName: stripVersionSuffix(canonicalName) };
  });
}

/** Version-suffix match (score 1) takes priority over a fuzzy Dice match. */
function admit(a: PreparedTrack, b: PreparedTrack): Admission | null {
  if (a.strippedName === b.strippedName) {
    return { score: 1, hint: "版本差異" };
  }
  const bound = diceUpperBound(a.canonicalName, b.canonicalName);
  if (bound !== null && bound < DICE_THRESHOLD) return null;
  const dice = diceBigram(a.canonicalName, b.canonicalName);
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
    pairKey: pairKeyOf(a, b),
    score: admission.score,
    hints: buildHints(a, b, admission.hint, keep, removed),
  };
}

/**
 * Find suspected-duplicate pairs: same canonical primary artist, a near-identical
 * title (version suffix or Dice >= DICE_THRESHOLD), not already a confident
 * duplicate, and not dismissed by the caller.
 *
 * `confidentGroups`, if passed, is used as-is instead of recomputing
 * findConfidentDuplicates(tracks) — for a caller (the library service) that
 * already computed it for buildCleanup, this halves a per-request O(n) pass.
 */
export function findSuspectPairs(
  tracks: Track[],
  opts: { dismissed: Set<string>; confidentGroups?: Track[][] },
): SuspectPair[] {
  const confidentGroup = groupIndexOf(opts.confidentGroups ?? findConfidentDuplicates(tracks));
  const pairs: SuspectPair[] = [];

  for (const bucket of bucketByArtist(tracks)) {
    const prepared = prepareBucket(bucket);
    for (let i = 0; i < prepared.length; i++) {
      for (let j = i + 1; j < prepared.length; j++) {
        const pa = prepared[i]!;
        const pb = prepared[j]!;
        const a = pa.track;
        const b = pb.track;

        const groupA = confidentGroup.get(a.id);
        if (groupA !== undefined && groupA === confidentGroup.get(b.id)) continue;

        const admission = admit(pa, pb);
        if (!admission) continue;

        const pairKey = pairKeyOf(a, b);
        if (opts.dismissed.has(pairKey)) continue;

        pairs.push(toPair(a, b, admission));
      }
    }
  }
  return pairs;
}

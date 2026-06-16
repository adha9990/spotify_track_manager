import type { KeepStrategy, Track } from "@stm/shared";

// Turn a list of "confident duplicate" groups into a deletion plan — pure logic,
// fully unit-testable and dry-runnable. The actual API calls live in the client.
// Ported from the Python `dedupe` module, with one safety enhancement: when
// choosing which copy to keep, a *playable* track always wins over an unplayable
// one, so a cleanup never strands you with the dead copy.

// When addedAt is missing, sort it LAST (treat as newest) so it is never mistaken
// for the "oldest" copy. ￿ is the largest BMP code point — bigger than any
// real ISO timestamp.
const MAX_SENTINEL = "￿";

export interface GroupResolution {
  /** The single track kept from this duplicate group. */
  keep: Track;
  /** Every other copy in the group, marked for deletion. */
  remove: Track[];
}

export interface DeletionPlan {
  resolutions: GroupResolution[];
}

/** Plain string comparison (no locale), returning -1 / 0 / 1. */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Order two copies so the one to KEEP sorts first (compare < 0).
 * Shared prefix for both strategies: prefer playable, then defer to the strategy.
 */
function keepComparator(strategy: KeepStrategy): (a: Track, b: Track) => number {
  return (a, b) => {
    // Never keep an unplayable copy when a playable one exists in the group.
    if (a.isPlayable !== b.isPlayable) return a.isPlayable ? -1 : 1;

    if (strategy === "popularity") {
      // Higher popularity wins; ties break toward the earliest-added copy.
      if (a.popularity !== b.popularity) return b.popularity - a.popularity;
    }
    // "oldest" (and the popularity tie-break): earliest addedAt, then id for determinism.
    const byAdded = cmpStr(a.addedAt ?? MAX_SENTINEL, b.addedAt ?? MAX_SENTINEL);
    if (byAdded !== 0) return byAdded;
    return cmpStr(a.id, b.id);
  };
}

const pickKeep = (group: Track[], cmp: (a: Track, b: Track) => number): Track =>
  group.reduce((best, t) => (cmp(t, best) < 0 ? t : best));

/**
 * For each duplicate group, keep one track and mark the rest for deletion.
 * - "popularity": keep the most popular (ties → earliest added).
 * - "oldest": keep the earliest added.
 * A playable copy is always preferred over an unplayable one, regardless of strategy.
 */
export function planDeletions(
  groups: Track[][],
  strategy: KeepStrategy = "popularity",
): DeletionPlan {
  const cmp = keepComparator(strategy);
  const resolutions = groups.map((group) => {
    const keep = pickKeep(group, cmp);
    const remove = group.filter((t) => t.id !== keep.id);
    return { keep, remove };
  });
  return { resolutions };
}

/** All track ids slated for deletion, flattened across every group. */
export const deleteIds = (plan: DeletionPlan): string[] =>
  plan.resolutions.flatMap((r) => r.remove.map((t) => t.id));

export const isEmptyPlan = (plan: DeletionPlan): boolean => deleteIds(plan).length === 0;

/** Split ids into fixed-size batches (Spotify's saved-tracks endpoints cap at 50). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

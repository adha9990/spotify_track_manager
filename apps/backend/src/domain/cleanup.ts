import type { CleanupGroup, Track } from "@stm/shared";
import { findConfidentDuplicates } from "./detect";
import { planDeletions } from "./dedupe";

// The one-click "cleanup" plan: a safe, explainable list of duplicate groups.
// It only touches *confident* duplicates (same name+artist or same ISRC), so every
// removal leaves an equivalent copy behind — nothing is lost. Both sides of each
// group carry full Track info so the UI can lay them out for human verification;
// the reason belongs to each removal (one group can mix stale + duplicate).

const REASON_STALE = "已失效,且已有可播放的同名同歌手版本";
const REASON_DUPLICATE = "重複(已保留同組人氣最高者)";

/**
 * Build the cleanup groups from a library snapshot. For every confident-duplicate
 * group we keep the best copy (playable, then most popular) and pair it with the
 * rest — flagging the ones that are removable *because* they are dead.
 */
export function buildCleanup(tracks: Track[]): CleanupGroup[] {
  const plan = planDeletions(findConfidentDuplicates(tracks), "popularity");
  return plan.resolutions.map(({ keep, remove }) => ({
    keep,
    removals: remove.map((t) => ({
      track: t,
      reason: !t.isPlayable && keep.isPlayable ? REASON_STALE : REASON_DUPLICATE,
    })),
  }));
}

import type { CleanupItem, Track } from "@stm/shared";
import { findConfidentDuplicates } from "./detect";
import { planDeletions } from "./dedupe";

// The one-click "cleanup" plan: a safe, explainable list of tracks to remove.
// It only touches *confident* duplicates (same name+artist or same ISRC), so every
// removal leaves an equivalent copy behind — nothing is lost. Each row carries the
// reason it is being removed, shown verbatim in the confirmation dialog.

const REASON_STALE = "已失效,且已有可播放的同名同歌手版本";
const REASON_DUPLICATE = "重複(已保留同組人氣最高者)";

const displayArtists = (t: Track): string => t.artists.join(", ");

/**
 * Build the cleanup list from a library snapshot. For every confident-duplicate
 * group we keep the best copy (playable, then most popular) and list the rest for
 * removal — flagging the ones that are removable *because* they are dead.
 */
export function buildCleanup(tracks: Track[]): CleanupItem[] {
  const plan = planDeletions(findConfidentDuplicates(tracks), "popularity");
  const items: CleanupItem[] = [];
  for (const { keep, remove } of plan.resolutions) {
    for (const t of remove) {
      const reason = !t.isPlayable && keep.isPlayable ? REASON_STALE : REASON_DUPLICATE;
      items.push({ id: t.id, name: t.name, artist: displayArtists(t), reason });
    }
  }
  return items;
}

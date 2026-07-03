import { z } from "zod";

/** A track snapshot, normalized from the official Web API. */
export const TrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  isrc: z.string().nullable(),
  popularity: z.number().int(),
  isPlayable: z.boolean(),
  addedAt: z.string().nullable(),
  album: z.string(),
  albumId: z.string(),
  releaseDate: z.string().nullable(),
  durationMs: z.number().int(),
});
export type Track = z.infer<typeof TrackSchema>;

/** One track slated for removal, with the reason it is safe to remove. */
export const CleanupRemovalSchema = z.object({
  track: TrackSchema,
  reason: z.string(),
});
export type CleanupRemoval = z.infer<typeof CleanupRemovalSchema>;

/**
 * One confident-duplicate group in the cleanup plan: the copy we keep, plus every
 * copy to remove. Full Track info on both sides so the UI can lay them out
 * side-by-side for human verification. `keep.id` doubles as the stable group key.
 */
export const CleanupGroupSchema = z.object({
  keep: TrackSchema,
  removals: z.array(CleanupRemovalSchema).min(1),
});
export type CleanupGroup = z.infer<typeof CleanupGroupSchema>;

/** A simplified search result for finding a replacement track. */
export const SearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  artist: z.string(),
  album: z.string(),
  durationMs: z.number().int(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

/** One batch in the operation history (a single user action). */
export const HistoryBatchSchema = z.object({
  batchId: z.string(),
  action: z.enum(["add", "delete"]),
  ts: z.string(),
  count: z.number().int(),
  undone: z.boolean(),
});
export type HistoryBatch = z.infer<typeof HistoryBatchSchema>;

/**
 * One suspected-duplicate pair surfaced for human review: the copy we'd keep, the
 * copy we'd remove, a stable sorted-id `pairKey` to join UI state across refreshes,
 * a confidence `score`, and the human-readable `hints` that explain the match.
 */
export const SuspectPairSchema = z.object({
  keep: TrackSchema,
  remove: TrackSchema,
  pairKey: z.string(),
  score: z.number(),
  hints: z.array(z.string()),
});
export type SuspectPair = z.infer<typeof SuspectPairSchema>;

/** Library snapshot the backend returns to the frontend. */
export const LibrarySchema = z.object({
  tracks: z.array(TrackSchema),
  cleanup: z.array(CleanupGroupSchema),
  suspects: z.array(SuspectPairSchema),
});
export type Library = z.infer<typeof LibrarySchema>;

export const KeepStrategy = z.enum(["popularity", "oldest"]);
export type KeepStrategy = z.infer<typeof KeepStrategy>;

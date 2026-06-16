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

/** One row of the one-click cleanup plan, with the reason it is being removed. */
export const CleanupItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  artist: z.string(),
  reason: z.string(),
});
export type CleanupItem = z.infer<typeof CleanupItemSchema>;

/** A simplified search result for finding a replacement track. */
export const SearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  artist: z.string(),
  album: z.string(),
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

/** Library snapshot the backend returns to the frontend. */
export const LibrarySchema = z.object({
  tracks: z.array(TrackSchema),
  cleanup: z.array(CleanupItemSchema),
});
export type Library = z.infer<typeof LibrarySchema>;

export const KeepStrategy = z.enum(["popularity", "oldest"]);
export type KeepStrategy = z.infer<typeof KeepStrategy>;

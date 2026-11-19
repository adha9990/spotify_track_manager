import { z } from "zod";

/** A track snapshot, normalized from the official Web API. */
export const TrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  primaryArtistId: z.string().nullish(),
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

export const PlaylistSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  itemCount: z.number().int().nonnegative().nullable(),
});
export type PlaylistSummary = z.infer<typeof PlaylistSummarySchema>;

export const PlaylistEntrySchema = z.object({
  position: z.number().int().positive(),
  track: TrackSchema,
});
export type PlaylistEntry = z.infer<typeof PlaylistEntrySchema>;

export const PlaylistContentsSchema = z.object({
  entries: z.array(PlaylistEntrySchema),
  skipped: z.number().int().nonnegative(),
});
export type PlaylistContents = z.infer<typeof PlaylistContentsSchema>;

/** Catalog metadata needed to verify a playable replacement. */
export const SearchResultSchema = TrackSchema.pick({
  id: true, name: true, artists: true, primaryArtistId: true, isrc: true, album: true, durationMs: true,
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const HistoryTrackSchema = TrackSchema.pick({ id: true, name: true, artists: true, album: true }).extend({
  name: z.string().nullable(),
});
export type HistoryTrack = z.infer<typeof HistoryTrackSchema>;

/** One batch in the operation history (a single user action). */
export const HistoryBatchSchema = z.object({
  batchId: z.string(),
  action: z.enum(["add", "delete"]),
  ts: z.string(),
  count: z.number().int(),
  undone: z.boolean(),
  tracks: z.array(HistoryTrackSchema),
});
export type HistoryBatch = z.infer<typeof HistoryBatchSchema>;

/** Snapshot of the user's saved tracks. */
export const LibrarySchema = z.object({
  tracks: z.array(TrackSchema),
  fetchedAt: z.string(),
});
export type Library = z.infer<typeof LibrarySchema>;

const VolumePercent = z.number().int().min(0).max(100);

export const PlaybackStateSchema = z.object({
  item: z.object({
    id: z.string().nullable(),
    name: z.string(),
    artists: z.array(z.string()),
    durationMs: z.number().int().nonnegative(),
  }).nullable(),
  device: z.object({
    id: z.string().nullable(),
    name: z.string(),
    volumePercent: VolumePercent.nullable(),
    supportsVolume: z.boolean(),
  }),
  isPlaying: z.boolean(),
  positionMs: z.number().int().nonnegative(),
  canPause: z.boolean(),
  canResume: z.boolean(),
  canSkipPrevious: z.boolean(),
  canSkipNext: z.boolean(),
  canSeek: z.boolean(),
});
export type PlaybackState = z.infer<typeof PlaybackStateSchema>;

const DeviceId = z.string().min(1).max(256).nullable();

export const PlaybackCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["pause", "resume", "previous", "next"]),
    deviceId: DeviceId,
  }),
  z.object({
    action: z.literal("volume"),
    deviceId: DeviceId,
    volumePercent: VolumePercent,
  }),
  z.object({
    action: z.literal("seek"),
    deviceId: DeviceId,
    positionMs: z.number().int().nonnegative().safe(),
  }),
]);
export type PlaybackCommand = z.infer<typeof PlaybackCommandSchema>;

export const SpotifyIdSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9]+$/);
export const MAX_UPCOMING_TRACKS = 99;

export const PlayTrackSchema = z.object({
  id: SpotifyIdSchema,
  deviceId: DeviceId.optional(),
  positionMs: z.number().int().nonnegative().safe().optional(),
  context: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("playlist"),
      playlistId: SpotifyIdSchema,
      position: z.number().int().positive(),
    }),
    z.object({
      type: z.literal("tracks"),
      following: z.array(SpotifyIdSchema).max(MAX_UPCOMING_TRACKS),
    }),
  ]).optional(),
});
export type PlayTrackRequest = z.infer<typeof PlayTrackSchema>;
export type PlayTrackContext = NonNullable<PlayTrackRequest["context"]>;

export const WebPlaybackTokenSchema = z.object({ accessToken: z.string().min(1) });

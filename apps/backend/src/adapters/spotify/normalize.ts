import type { Track } from "@stm/shared";
import { z } from "zod";

// Normalize Spotify's nested API JSON into the flat, type-safe Track value object.
// All the defensive `?? default` lives here so the rest of the app never reaches
// into raw `track["..."]` and crashes on a missing field. Ported from Python
// `Track.from_item`, extended with the album/duration fields the desktop UI needs.

export const RawTrackSchema = z.object({
  id: z.string().nullish(),
  type: z.string().optional(),
  is_local: z.boolean().optional(),
  name: z.string().nullish(),
  artists: z.array(z.object({ id: z.string().nullish(), name: z.string().nullish() })).nullish(),
  external_ids: z.object({ isrc: z.string().nullish() }).nullish(),
  popularity: z.number().int().nullish(),
  is_playable: z.boolean().nullish(),
  album: z.object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    release_date: z.string().nullish(),
  }).nullish(),
  duration_ms: z.number().int().nullish(),
});
export type RawTrack = z.infer<typeof RawTrackSchema>;

export const RawSavedItemSchema = z.object({
  added_at: z.string().nullish(),
  is_local: z.boolean().optional(),
  item: RawTrackSchema.nullish(),
  track: RawTrackSchema.nullish(),
});
export type RawSavedItem = z.infer<typeof RawSavedItemSchema>;

/**
 * Saved tracks use "track". The new playlist endpoint uses "item".
 * A local file, episode or missing track cannot participate in Spotify ID matching.
 */
export function trackFromItem(item: RawSavedItem | null): Track | null {
  if (!item || item.is_local) return null;
  const t = item.item === undefined ? item.track : item.item;
  if (!t?.id || t.is_local || (t.type && t.type !== "track")) return null;
  const album = t.album ?? {};
  return {
    id: t.id,
    name: t.name ?? "",
    artists: (t.artists ?? []).map((a) => a.name ?? "").filter((n) => n !== ""),
    primaryArtistId: t.artists?.[0]?.id ?? null,
    isrc: t.external_ids?.isrc ?? null,
    popularity: t.popularity ?? 0,
    // A missing field means the request carried no market → assume playable, not dead.
    isPlayable: t.is_playable ?? true,
    addedAt: item.added_at ?? null,
    album: album.name ?? "",
    albumId: album.id ?? "",
    releaseDate: album.release_date ?? null,
    durationMs: t.duration_ms ?? 0,
  };
}

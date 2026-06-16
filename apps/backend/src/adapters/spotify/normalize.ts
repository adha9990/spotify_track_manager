import type { Track } from "@stm/shared";

// Normalize Spotify's nested API JSON into the flat, type-safe Track value object.
// All the defensive `?? default` lives here so the rest of the app never reaches
// into raw `track["..."]` and crashes on a missing field. Ported from Python
// `Track.from_item`, extended with the album/duration fields the desktop UI needs.

interface RawArtist {
  name?: string;
}
interface RawAlbum {
  id?: string;
  name?: string;
  release_date?: string;
}
export interface RawTrack {
  id?: string | null;
  name?: string;
  artists?: RawArtist[];
  external_ids?: { isrc?: string };
  popularity?: number;
  is_playable?: boolean;
  album?: RawAlbum;
  duration_ms?: number;
}
export interface RawSavedItem {
  added_at?: string | null;
  track?: RawTrack | null;
}

/**
 * Build a Track from a saved-tracks / playlist item wrapper ({ added_at, track }).
 * Returns null for local files and unavailable tracks (no id) so they never reach
 * the duplicate detector or the delete path.
 */
export function trackFromItem(item: RawSavedItem): Track | null {
  const t = item.track;
  if (!t || !t.id) return null;
  const album = t.album ?? {};
  return {
    id: t.id,
    name: t.name ?? "",
    artists: (t.artists ?? []).map((a) => a.name ?? "").filter((n) => n !== ""),
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

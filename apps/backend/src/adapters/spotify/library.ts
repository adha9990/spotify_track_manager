import type { SearchResult, Track } from "@stm/shared";
import { chunk } from "../../domain/dedupe";
import { api, apiJson } from "./api";
import { trackFromItem, type RawSavedItem } from "./normalize";

// Read/write the user's library through the official Web API. Fetching is paged;
// mutations are batched at Spotify's 50-id limit. The page-walking loop takes an
// injectable `pager` so it can be unit-tested without touching the network.

const PAGE_SIZE = 50;
// `from_token` resolves to the user's own market, which makes the API include the
// `is_playable` flag we rely on to detect dead tracks.
const MARKET = "from_token";

interface Page {
  items?: RawSavedItem[];
  next?: string | null;
}

export type Pager = (path: string) => Promise<Page>;

// `next` comes back as an absolute URL; reduce it to the path `apiJson` expects.
const toPath = (url: string): string => url.replace("https://api.spotify.com/v1", "");

/** Walk every page from `firstPath`, normalizing and keeping only real, id'd tracks. */
export async function collect(firstPath: string, pager: Pager = apiJson): Promise<Track[]> {
  const tracks: Track[] = [];
  let path: string | null = firstPath;
  while (path) {
    const page = await pager(path);
    for (const item of page.items ?? []) {
      const track = trackFromItem(item);
      if (track) tracks.push(track);
    }
    path = page.next ? toPath(page.next) : null;
  }
  return tracks;
}

/**
 * Drop repeated ids, keeping the first occurrence. Liked Songs are a set keyed by
 * track id, and the whole detect/dedupe/suspects pipeline assumes ids are unique —
 * but Spotify's paging can still hand the same id back twice. A leaked duplicate id
 * collapses inside findConfidentDuplicates (mergeGroups' by-id map) and then crashes
 * findSuspectPairs, so uniqueness is enforced here at the ingestion boundary.
 */
function dedupeById(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/** Fetch the user's Liked Songs in full, with each track id guaranteed to appear once. */
export const fetchSavedTracks = (pager?: Pager): Promise<Track[]> =>
  collect(`/me/tracks?limit=${PAGE_SIZE}&market=${MARKET}`, pager).then(dedupeById);

/** Fetch every track in a playlist. */
export const fetchPlaylistTracks = (playlistId: string, pager?: Pager): Promise<Track[]> =>
  collect(
    `/playlists/${playlistId}/tracks?limit=${PAGE_SIZE}&market=${MARKET}&additional_types=track`,
    pager,
  );

async function mutateSaved(method: "DELETE" | "PUT", ids: string[]): Promise<void> {
  for (const batch of chunk(ids, PAGE_SIZE)) {
    const res = await api("/me/tracks", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: batch }),
    });
    if (!res.ok) throw new Error(`${method} /me/tracks -> ${res.status}`);
  }
}

/** Remove saved tracks (the dedupe/cleanup delete path). */
export const removeSavedTracks = (ids: string[]): Promise<void> => mutateSaved("DELETE", ids);

/** Re-add saved tracks (used to undo a delete batch). */
export const addSavedTracks = (ids: string[]): Promise<void> => mutateSaved("PUT", ids);

interface RawSearchTrack {
  id: string;
  name: string;
  artists?: { name?: string }[];
  album?: { name?: string };
  duration_ms?: number;
  is_playable?: boolean;
}

const SEARCH_LIMIT = 10;
// Over-fetch so dropping unplayable results doesn't starve the list.
const SEARCH_OVERFETCH = 20;

/**
 * Search the catalog for replacement candidates for a dead track. Only playable
 * results survive (a replacement that is itself dead is useless); `fetcher` is
 * injectable so tests stay offline, mirroring `collect`'s pager seam.
 */
export async function searchTracks(
  query: string,
  fetcher: typeof apiJson = apiJson,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    market: MARKET,
    limit: String(SEARCH_OVERFETCH),
  });
  const data = await fetcher<{ tracks?: { items?: RawSearchTrack[] } }>(`/search?${params}`);
  return (data.tracks?.items ?? [])
    .filter((t) => t.is_playable !== false)
    .slice(0, SEARCH_LIMIT)
    .map((t) => ({
      id: t.id,
      name: t.name,
      artist: (t.artists ?? []).map((a) => a.name ?? "").join(", "),
      album: t.album?.name ?? "",
      durationMs: t.duration_ms ?? 0,
    }));
}

/** Start playback of a track on the user's active device (requires Premium + an open client). */
export async function playTrack(trackId: string): Promise<void> {
  const res = await api("/me/player/play", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });
  // 204 No Content = playing; 404 = no active device to target.
  if (!res.ok && res.status !== 204) throw new Error(`play -> ${res.status}`);
}

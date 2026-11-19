import { SearchResultSchema, type HistoryTrack, type PlaylistContents, type PlaylistEntry, type PlaylistSummary, type SearchResult, type Track } from "@stm/shared";
import { z } from "zod";
import { SPOTIFY_API_BASE, type SpotifyApi } from "./api";
import { RawSavedItemSchema, RawTrackSchema, trackFromItem, type RawSavedItem, type RawTrack } from "./normalize";

// Read/write the user's library through the official Web API. Fetching is paged;
// mutations are batched at Spotify's 40-URI limit. The page-walking loop takes an
// injectable `pager` so it can be unit-tested without touching the network.

const PAGE_SIZE = 50;
const LIBRARY_UPDATE_LIMIT = 40;

const pageSchema = <Item>(item: z.ZodType<Item>) => z.object({
  items: z.array(item).optional(),
  next: z.string().nullish(),
  offset: z.number().int().nonnegative().optional(),
});

export type Pager<Item = RawSavedItem | null> =
  (path: string) => Promise<{ items?: Item[]; next?: string | null; offset?: number }>;

export const TrackPage = pageSchema(RawSavedItemSchema.nullable());

async function* pages<Item>(firstPath: string, pager: Pager<Item>) {
  let path: string | null = firstPath;
  const visited = new Set<string>();
  while (path) {
    if (visited.has(path)) throw new Error("Spotify 回傳了重複的分頁網址");
    visited.add(path);
    const page = await pager(path);
    yield page;
    if (page.next && !page.next.startsWith(`${SPOTIFY_API_BASE}/`)) {
      throw new Error("Spotify 回傳了無效的分頁網址");
    }
    path = page.next ? page.next.slice(SPOTIFY_API_BASE.length) : null;
  }
}

async function collectEntries(firstPath: string, pager: Pager): Promise<PlaylistContents> {
  const entries: PlaylistEntry[] = [];
  let position = 0;
  let skipped = 0;
  for await (const page of pages(firstPath, pager)) {
    position = page.offset ?? position;
    for (const item of page.items ?? []) {
      position++;
      const track = trackFromItem(item);
      if (track) entries.push({ position, track });
      else skipped++;
    }
  }
  return { entries, skipped };
}

export async function collect(firstPath: string, pager: Pager): Promise<Track[]> {
  const { entries } = await collectEntries(firstPath, pager);
  return entries.map(({ track }) => track);
}

/** Liked Songs are a set, but changing the library during paging can repeat an ID. */
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
export const fetchSavedTracks = (pager: Pager): Promise<Track[]> =>
  collect(`/me/tracks?limit=${PAGE_SIZE}`, pager).then(dedupeById);

/** Resolve historical entries by their exact Spotify ID, including unsaved tracks. */
export async function fetchTrackDetails(ids: string[], json: SpotifyApi["json"]): Promise<HistoryTrack[]> {
  const tracks: HistoryTrack[] = [];
  const concurrency = 5;
  for (let start = 0; start < ids.length; start += concurrency) {
    const batch = await Promise.allSettled(ids.slice(start, start + concurrency).map(async (id) => {
      const endpoint = `/tracks/${encodeURIComponent(id)}`;
      const raw = RawTrackSchema.parse(await json(endpoint, { signal: AbortSignal.timeout(5_000) }, { retries429: 1 }));
      const track = trackFromItem({ track: raw });
      return track?.id === id && track.name ? track : null;
    }));
    for (const item of batch) {
      if (item.status === "fulfilled" && item.value) tracks.push(item.value);
    }
  }
  return tracks;
}

const TotalItems = z.object({ total: z.number().int().nonnegative().optional() }).nullish();
const RawPlaylist = z.object({
  id: z.string().min(1),
  name: z.string(),
  items: TotalItems,
  tracks: TotalItems,
});
export const PlaylistsPage = pageSchema(RawPlaylist);

export async function fetchPlaylists(pager: Pager<z.infer<typeof RawPlaylist>>): Promise<PlaylistSummary[]> {
  const byId = new Map<string, PlaylistSummary>();
  for await (const page of pages(`/me/playlists?limit=${PAGE_SIZE}`, pager)) {
    for (const playlist of page.items ?? []) {
      byId.set(playlist.id, {
        id: playlist.id,
        name: playlist.name,
        itemCount: playlist.items?.total ?? playlist.tracks?.total ?? null,
      });
    }
  }
  return [...byId.values()];
}

/** Preserve each occurrence and its original position, even when IDs repeat. */
export const fetchPlaylistEntries = (playlistId: string, pager: Pager) =>
  collectEntries(`/playlists/${encodeURIComponent(playlistId)}/items?limit=${PAGE_SIZE}`, pager);

export async function mutateSaved(request: SpotifyApi["request"], method: "DELETE" | "PUT", ids: string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += LIBRARY_UPDATE_LIMIT) {
    const batch = ids.slice(start, start + LIBRARY_UPDATE_LIMIT);
    const params = new URLSearchParams({
      uris: batch.map((id) => `spotify:track:${id}`).join(","),
    });
    const res = await request(`/me/library?${params}`, { method });
    if (!res.ok) throw new Error(`${method} /me/library → ${res.status}`);
  }
}

const SearchPage = z.object({
  tracks: pageSchema(RawTrackSchema.extend({ id: z.string(), name: z.string() })).optional(),
});

const SEARCH_LIMIT = 10;

function playableSearchResults(items: RawTrack[]) {
  return items.flatMap((raw) => {
    const track = trackFromItem({ track: raw });
    return track?.isPlayable && track.name ? [SearchResultSchema.parse(track)] : [];
  });
}

/**
 * Search the catalog for replacement candidates for a dead track. Only playable
 * results survive (a replacement that is itself dead is useless); `fetcher` is
 * injectable so tests stay offline, mirroring `collect`'s pager seam.
 */
export async function searchTracks(
  query: string,
  fetcher: SpotifyApi["json"],
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(SEARCH_LIMIT),
  });
  const data = SearchPage.parse(await fetcher(`/search?${params}`));
  const tracks = playableSearchResults(data.tracks?.items ?? []);
  if (tracks.length < SEARCH_LIMIT && data.tracks?.next) {
    params.set("offset", String(SEARCH_LIMIT));
    const second = SearchPage.parse(await fetcher(`/search?${params}`));
    tracks.push(...playableSearchResults(second.tracks?.items ?? []));
  }
  return tracks.slice(0, SEARCH_LIMIT);
}

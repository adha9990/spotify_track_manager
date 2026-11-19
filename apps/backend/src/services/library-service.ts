import type { Library, Track } from "@stm/shared";
import type { SpotifyGateway } from "../ports/spotify-gateway";

export interface LibraryService {
  getLibrary(now: string, force?: boolean): Promise<Library>;
  cachedTracks(ids: string[]): Track[];
  applyLocalDelete(ids: string[]): void;
  invalidateLibrary(): void;
}

export function createLibraryService(gateway: Pick<SpotifyGateway, "fetchSavedTracks">): LibraryService {
  let cache: Library | undefined;
  let inFlight: Promise<Library> | undefined;

  function getLibrary(now: string, force = false): Promise<Library> {
    if (inFlight) return inFlight;
    if (cache && !force) return Promise.resolve(cache);

    const request: Promise<Library> = gateway.fetchSavedTracks()
      .then((tracks) => {
        // A Spotify mutation can invalidate this request while it is paging.
        if (inFlight !== request) return getLibrary(now);
        cache = { tracks, fetchedAt: now };
        return cache;
      })
      .finally(() => {
        if (inFlight === request) inFlight = undefined;
      });
    inFlight = request;
    return request;
  }

  return {
    getLibrary,
    cachedTracks(ids) {
      const wanted = new Set(ids);
      return cache?.tracks.filter(({ id }) => wanted.has(id)) ?? [];
    },
    applyLocalDelete(ids) {
      inFlight = undefined;
      if (!cache) return;
      const removed = new Set(ids);
      cache = { ...cache, tracks: cache.tracks.filter(({ id }) => !removed.has(id)) };
    },
    invalidateLibrary() {
      cache = undefined;
      inFlight = undefined;
    },
  };
}

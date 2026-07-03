import type { Library, Track } from "@stm/shared";
import { buildCleanup } from "../domain/cleanup";
import type { SpotifyGateway } from "../ports/spotify-gateway";

// Orchestrates the Spotify gateway + the pure cleanup planner, caching the fetched
// snapshot in memory. Built once at the composition root with a concrete gateway, so
// it depends only on the SpotifyGateway port — never on a Spotify adapter directly.

export interface LibrarySnapshot extends Library {
  fetchedAt: string;
}

export interface LibraryService {
  /** Cached library, built once on demand; `force` rebuilds. Concurrent first calls share the fetch. */
  getLibrary(now: string, force?: boolean): Promise<LibrarySnapshot>;
  /** Drop tracks from the cached snapshot after a successful delete, without a refetch. */
  applyLocalDelete(ids: string[]): void;
  invalidateLibrary(): void;
}

export function createLibraryService(gateway: SpotifyGateway): LibraryService {
  let cache: LibrarySnapshot | null = null;
  let inFlight: Promise<LibrarySnapshot> | null = null;

  async function build(now: string): Promise<LibrarySnapshot> {
    const tracks = await gateway.fetchSavedTracks();
    // Suspects computation lands in T5; placeholder keeps the contract satisfied until then.
    const snapshot: LibrarySnapshot = { tracks, cleanup: buildCleanup(tracks), suspects: [], fetchedAt: now };
    cache = snapshot;
    return snapshot;
  }

  return {
    getLibrary(now, force = false) {
      if (cache && !force) return Promise.resolve(cache);
      if (force) cache = null;
      if (!inFlight) {
        inFlight = build(now).finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },

    applyLocalDelete(ids) {
      if (!cache) return;
      const removed = new Set(ids);
      const tracks = cache.tracks.filter((t: Track) => !removed.has(t.id));
      cache = { ...cache, tracks, cleanup: buildCleanup(tracks), suspects: [] };
    },

    invalidateLibrary() {
      cache = null;
    },
  };
}

import type { Library, Track } from "@stm/shared";
import { buildCleanup } from "../domain/cleanup";
import { findSuspectPairs } from "../domain/suspects";
import type { DismissalStore } from "../ports/dismissal-store";
import type { SpotifyGateway } from "../ports/spotify-gateway";

// Orchestrates the Spotify gateway + the pure cleanup/suspects planners, caching the
// fetched snapshot in memory. Built once at the composition root with concrete
// adapters, so it depends only on the SpotifyGateway and DismissalStore ports —
// never on a concrete adapter directly.

export interface LibrarySnapshot extends Library {
  fetchedAt: string;
}

export interface LibraryService {
  /** Cached library, built once on demand; `force` rebuilds. Concurrent first calls share the fetch. */
  getLibrary(now: string, force?: boolean): Promise<LibrarySnapshot>;
  /** Drop tracks from the cached snapshot after a successful delete, without a refetch. */
  applyLocalDelete(ids: string[]): void;
  /** Record a suspect pair as dismissed and recompute the cached snapshot's suspects, if any. */
  dismiss(pairKey: string, ts: string): void;
  invalidateLibrary(): void;
}

export function createLibraryService(gateway: SpotifyGateway, dismissals: DismissalStore): LibraryService {
  let cache: LibrarySnapshot | null = null;
  let inFlight: Promise<LibrarySnapshot> | null = null;

  const suspectsFor = (tracks: Track[]) =>
    findSuspectPairs(tracks, { dismissed: new Set(dismissals.list()) });

  async function build(now: string): Promise<LibrarySnapshot> {
    const tracks = await gateway.fetchSavedTracks();
    const snapshot: LibrarySnapshot = {
      tracks,
      cleanup: buildCleanup(tracks),
      suspects: suspectsFor(tracks),
      fetchedAt: now,
    };
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
      cache = { ...cache, tracks, cleanup: buildCleanup(tracks), suspects: suspectsFor(tracks) };
    },

    dismiss(pairKey, ts) {
      dismissals.add(pairKey, ts);
      if (!cache) return;
      cache = { ...cache, suspects: suspectsFor(cache.tracks) };
    },

    invalidateLibrary() {
      cache = null;
    },
  };
}

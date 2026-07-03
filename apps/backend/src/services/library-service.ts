import type { Library, SuspectPair, Track } from "@stm/shared";
import { canonical } from "../domain/canonical";
import { buildCleanup } from "../domain/cleanup";
import { findCrossLanguagePairs } from "../domain/crosslang";
import { findConfidentDuplicates } from "../domain/detect";
import { findSuspectPairs } from "../domain/suspects";
import type { DismissalStore } from "../ports/dismissal-store";
import type { EmbeddingCache } from "../ports/embedding-cache";
import type { EmbeddingGateway } from "../ports/embedding-gateway";
import type { SpotifyGateway } from "../ports/spotify-gateway";

// Orchestrates the Spotify gateway + the pure cleanup/suspects planners, caching the
// fetched snapshot in memory. Built once at the composition root with concrete
// adapters, so it depends only on the SpotifyGateway/DismissalStore/EmbeddingCache/
// EmbeddingGateway ports — never on a concrete adapter directly.

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

/** Optional cross-language capability: an EmbeddingCache + EmbeddingGateway pair. Absent, cross-language detection is off. */
export interface CrossLanguageEmbedding {
  cache: EmbeddingCache;
  gateway: EmbeddingGateway;
}

/**
 * Merge two SuspectPair passes, deduped by pairKey — a pair caught by both the
 * lexical and cross-language passes must surface exactly once. The lexical pass
 * wins ties since it runs first and is the cheaper, already-battle-tested signal.
 */
function mergeSuspects(lexical: SuspectPair[], crossLanguage: SuspectPair[]): SuspectPair[] {
  const seen = new Set(lexical.map((p) => p.pairKey));
  const extra = crossLanguage.filter((p) => !seen.has(p.pairKey));
  return [...lexical, ...extra];
}

export function createLibraryService(
  gateway: SpotifyGateway,
  dismissals: DismissalStore,
  embed?: CrossLanguageEmbedding,
): LibraryService {
  let cache: LibrarySnapshot | null = null;
  let inFlight: Promise<LibrarySnapshot> | null = null;

  const dismissedSet = () => new Set(dismissals.list());

  /** A cached vector is only trustworthy when the title hasn't changed and the model hasn't changed. */
  function freshVectors(tracks: Track[], capability: CrossLanguageEmbedding): { fresh: Map<string, number[]>; stale: Track[] } {
    const cached = capability.cache.get(tracks.map((t) => t.id));
    const fresh = new Map<string, number[]>();
    const stale: Track[] = [];
    for (const track of tracks) {
      const hit = cached.get(track.id);
      if (hit && hit.nameHash === canonical(track.name) && hit.model === capability.gateway.modelId) {
        fresh.set(track.id, hit.vec);
      } else {
        stale.push(track);
      }
    }
    return { fresh, stale };
  }

  /**
   * Ensure every track has a fresh embedding vector — cached and matching both the
   * current canonical name and the current model — embedding only the tracks that
   * are missing or stale, in a single batch call. Never throws: a model failure
   * (ADR-5 / §10.1) must degrade to "no cross-language pairs this build", not a 500.
   */
  async function vectorsFor(tracks: Track[], capability: CrossLanguageEmbedding): Promise<Map<string, number[]>> {
    try {
      const { fresh, stale } = freshVectors(tracks, capability);
      if (stale.length === 0) return fresh;

      const embedded = await capability.gateway.embed(stale.map((t) => t.name));
      const rows = stale.map((track, i) => ({
        trackId: track.id,
        vec: embedded[i]!,
        nameHash: canonical(track.name),
        model: capability.gateway.modelId,
      }));
      capability.cache.put(rows);
      for (const row of rows) fresh.set(row.trackId, row.vec);
      return fresh;
    } catch (err) {
      console.warn("cross-language embedding failed, skipping cross-language suspects:", err);
      return new Map();
    }
  }

  /** Cross-language pass restricted to already-cached vectors (no embedding call) — the sync path applyLocalDelete needs, since ids only ever shrink. */
  function crossLanguageFromCache(tracks: Track[], confidentGroups: Track[][], dismissed: Set<string>): SuspectPair[] {
    if (!embed) return [];
    try {
      const { fresh } = freshVectors(tracks, embed);
      return findCrossLanguagePairs(tracks, { vectors: fresh, confidentGroups, dismissed });
    } catch (err) {
      console.warn("cross-language lookup failed, skipping cross-language suspects:", err);
      return [];
    }
  }

  async function suspectsFor(tracks: Track[], confidentGroups: Track[][]): Promise<SuspectPair[]> {
    const dismissed = dismissedSet();
    const lexical = findSuspectPairs(tracks, { dismissed, confidentGroups });
    if (!embed) return lexical;
    // Guard the whole cross-language block (vector lookup + pairing), symmetric with
    // crossLanguageFromCache: the lexical suspects (and the rest of the snapshot) must
    // survive any cross-language failure — never a 500 from this newer path (§10.1/ADR-5).
    try {
      const vectors = await vectorsFor(tracks, embed);
      const crossLanguage = findCrossLanguagePairs(tracks, { vectors, confidentGroups, dismissed });
      return mergeSuspects(lexical, crossLanguage);
    } catch (err) {
      console.warn("cross-language suspects failed, using lexical suspects only:", err);
      return lexical;
    }
  }

  async function build(now: string): Promise<LibrarySnapshot> {
    const tracks = await gateway.fetchSavedTracks();
    const confidentGroups = findConfidentDuplicates(tracks);
    const snapshot: LibrarySnapshot = {
      tracks,
      cleanup: buildCleanup(tracks, confidentGroups),
      suspects: await suspectsFor(tracks, confidentGroups),
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
      const confidentGroups = findConfidentDuplicates(tracks);
      // Stays synchronous: a delete only shrinks the track set, so every remaining
      // track already has a fresh cached vector — no embedding call is ever needed
      // here, only a cache read (see crossLanguageFromCache).
      const dismissed = dismissedSet();
      const lexical = findSuspectPairs(tracks, { dismissed, confidentGroups });
      const crossLanguage = crossLanguageFromCache(tracks, confidentGroups, dismissed);
      cache = {
        ...cache,
        tracks,
        cleanup: buildCleanup(tracks, confidentGroups),
        suspects: mergeSuspects(lexical, crossLanguage),
      };
    },

    dismiss(pairKey, ts) {
      dismissals.add(pairKey, ts);
      if (!cache) return;
      // Filter the cached suspects in place rather than recomputing the whole
      // library: dismissing one pair can only ever remove that pair, so a
      // filter is equivalent to a recompute here without the O(n) redo.
      cache = { ...cache, suspects: cache.suspects.filter((p) => p.pairKey !== pairKey) };
    },

    invalidateLibrary() {
      cache = null;
    },
  };
}

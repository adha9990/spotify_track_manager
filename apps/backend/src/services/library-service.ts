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
// fetched snapshot in memory. Cross-language suspect detection (which needs an
// embedding-model round trip) runs as a BACKGROUND pass: build() returns the lexical
// snapshot immediately (crossLanguagePending: true) and later swaps in the merged
// result once the pass settles, so a slow/unavailable model never blocks the
// request. A monotonic `generation` counter guards that swap: a background pass only
// writes its result if nothing has superseded the build it belongs to (force
// refresh, a delete, or a newer build) — otherwise it silently discards its result.
// Built once at the composition root with concrete adapters, so it depends only on
// the SpotifyGateway/DismissalStore/EmbeddingCache/EmbeddingGateway ports — never on
// a concrete adapter directly.

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
  /** Resolves once the in-flight background cross-language pass (if any) has settled; resolves immediately if none is running. */
  settleCrossLanguage(): Promise<void>;
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
  let backgroundPass: Promise<void> | null = null;
  // Bumped by every operation that replaces or clears the cache, so a background
  // pass started against an earlier snapshot can detect it has been superseded.
  let generation = 0;

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
   * are missing or stale, in a single batch call. Throws on a malformed adapter
   * response (length mismatch) or a model failure; callers (the background pass /
   * crossLanguageFromCache) catch and degrade per ADR-5 — never a 500.
   */
  async function vectorsFor(tracks: Track[], capability: CrossLanguageEmbedding): Promise<Map<string, number[]>> {
    const { fresh, stale } = freshVectors(tracks, capability);
    if (stale.length === 0) return fresh;

    const embedded = await capability.gateway.embed(stale.map((t) => t.name));
    if (embedded.length !== stale.length) {
      throw new Error(
        `embedding gateway returned ${embedded.length} vectors for ${stale.length} inputs — refusing to trust index alignment`,
      );
    }
    const rows = stale.map((track, i) => ({
      trackId: track.id,
      vec: embedded[i]!,
      nameHash: canonical(track.name),
      model: capability.gateway.modelId,
    }));
    capability.cache.put(rows);
    for (const row of rows) fresh.set(row.trackId, row.vec);
    return fresh;
  }

  /** Cross-language pairs for the given vectors — the one findCrossLanguagePairs call site shared by both the background pass and the sync cache-only path. */
  function crossLanguagePairs(
    tracks: Track[],
    confidentGroups: Track[][],
    dismissed: Set<string>,
    vectors: Map<string, number[]>,
  ): SuspectPair[] {
    return findCrossLanguagePairs(tracks, { vectors, confidentGroups, dismissed });
  }

  /** Cross-language pass restricted to already-cached vectors (no embedding call) — the sync path applyLocalDelete needs, since ids only ever shrink. */
  function crossLanguageFromCache(tracks: Track[], confidentGroups: Track[][], dismissed: Set<string>): SuspectPair[] {
    if (!embed) return [];
    try {
      const { fresh } = freshVectors(tracks, embed);
      return crossLanguagePairs(tracks, confidentGroups, dismissed, fresh);
    } catch (err) {
      console.warn("cross-language lookup failed, skipping cross-language suspects:", err);
      return [];
    }
  }

  /**
   * Fire-and-forget background cross-language pass for a just-built snapshot: embeds
   * any stale/missing vectors, computes cross-language pairs, and — only if `gen`
   * (the generation at build time) is still current — swaps the merged suspects into
   * the cache and clears crossLanguagePending. Never rejects: any failure degrades to
   * "lexical suspects only" (ADR-5/§10.1), logged via console.warn.
   */
  async function runBackgroundCrossLanguage(
    capability: CrossLanguageEmbedding,
    tracks: Track[],
    confidentGroups: Track[][],
    lexical: SuspectPair[],
    gen: number,
  ): Promise<void> {
    try {
      const dismissed = dismissedSet();
      const vectors = await vectorsFor(tracks, capability);
      const crossLanguage = crossLanguagePairs(tracks, confidentGroups, dismissed, vectors);
      if (generation !== gen || !cache) return; // superseded by a newer build/delete/invalidate — discard
      cache = { ...cache, suspects: mergeSuspects(lexical, crossLanguage), crossLanguagePending: false };
    } catch (err) {
      console.warn("cross-language background pass failed, using lexical suspects only:", err);
      if (generation !== gen || !cache) return;
      cache = { ...cache, crossLanguagePending: false };
    }
  }

  async function build(now: string): Promise<LibrarySnapshot> {
    const tracks = await gateway.fetchSavedTracks();
    const confidentGroups = findConfidentDuplicates(tracks);
    const dismissed = dismissedSet();
    const lexical = findSuspectPairs(tracks, { dismissed, confidentGroups });

    const snapshot: LibrarySnapshot = {
      tracks,
      cleanup: buildCleanup(tracks, confidentGroups),
      suspects: lexical,
      crossLanguagePending: Boolean(embed),
      fetchedAt: now,
    };
    cache = snapshot;
    const gen = ++generation;

    if (embed) {
      backgroundPass = runBackgroundCrossLanguage(embed, tracks, confidentGroups, lexical, gen);
    }
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
        crossLanguagePending: false,
      };
      generation++; // supersede any background pass still in flight from a prior build
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
      generation++; // any in-flight background pass now targets a gone snapshot
    },

    settleCrossLanguage() {
      return backgroundPass ?? Promise.resolve();
    },
  };
}

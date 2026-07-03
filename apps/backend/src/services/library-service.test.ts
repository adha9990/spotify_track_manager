import { describe, expect, it, vi } from "vitest";
import { canonical } from "../domain/canonical";
import { makeTrack } from "../domain/fixtures";
import type { CachedEmbedding, EmbeddingCache } from "../ports/embedding-cache";
import type { EmbeddingGateway } from "../ports/embedding-gateway";
import type { DismissalStore } from "../ports/dismissal-store";
import type { SpotifyGateway } from "../ports/spotify-gateway";
import { createLibraryService } from "./library-service";

// The dependency inversion pays off here: a fake SpotifyGateway lets the service be
// tested with zero network, proving the port seam is real.
function fakeGateway(over: Partial<SpotifyGateway> = {}): SpotifyGateway {
  return {
    getProfile: async () => ({ user: null, product: null }),
    fetchSavedTracks: async () => [],
    removeSavedTracks: async () => {},
    addSavedTracks: async () => {},
    searchTracks: async () => [],
    playTrack: async () => {},
    ...over,
  };
}

// In-memory DismissalStore fake — no sqlite — mirroring the real adapter's
// idempotent-add contract closely enough for service-level tests.
function fakeDismissalStore(initial: string[] = []): DismissalStore {
  const dismissed = [...initial];
  return {
    add(pairKey: string) {
      if (!dismissed.includes(pairKey)) dismissed.push(pairKey);
    },
    list() {
      return [...dismissed];
    },
  };
}

// A suspected-duplicate pair per domain/suspects.ts: same primary artist, a
// version-suffix title match, not a confident (exact name+artist) duplicate.
const lemon = () => makeTrack({ id: "s1", name: "Lemon", artists: ["米津玄師"], isPlayable: true, popularity: 80 });
const lemonLive = () =>
  makeTrack({ id: "s2", name: "Lemon - Live", artists: ["米津玄師"], isPlayable: false, popularity: 60 });
const suspectPairKey = "s1|s2";

// A confident duplicate per domain/detect.ts: identical canonical name + artist.
// It must be resolved by buildCleanup, never surfaced as a suspect pair.
const confidentA = () => makeTrack({ id: "c1", name: "演員", artists: ["薛之謙"], isPlayable: true, popularity: 72 });
const confidentB = () => makeTrack({ id: "c2", name: "演員", artists: ["薛之謙"], isPlayable: false, popularity: 40 });

describe("createLibraryService", () => {
  it("builds the snapshot once and serves it from cache", async () => {
    let calls = 0;
    const svc = createLibraryService(
      fakeGateway({
        fetchSavedTracks: async () => {
          calls++;
          return [makeTrack({ id: "a" })];
        },
      }),
      fakeDismissalStore(),
    );
    const first = await svc.getLibrary("2026-01-01T00:00:00Z");
    const second = await svc.getLibrary("2026-01-02T00:00:00Z");
    expect(first.tracks).toHaveLength(1);
    expect(second).toBe(first); // cached: same object, second now ignored
    expect(calls).toBe(1);
  });

  it("shares one fetch across concurrent first calls, and force rebuilds", async () => {
    let calls = 0;
    const svc = createLibraryService(
      fakeGateway({
        fetchSavedTracks: async () => {
          calls++;
          return [makeTrack({ id: "a" })];
        },
      }),
      fakeDismissalStore(),
    );
    const [a, b] = await Promise.all([svc.getLibrary("t"), svc.getLibrary("t")]);
    expect(a).toBe(b);
    expect(calls).toBe(1); // in-flight shared

    await svc.getLibrary("t", true);
    expect(calls).toBe(2); // force refetched
  });

  it("applyLocalDelete drops tracks from the cache without refetching", async () => {
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [makeTrack({ id: "a" }), makeTrack({ id: "b" })] }),
      fakeDismissalStore(),
    );
    await svc.getLibrary("t");
    svc.applyLocalDelete(["a"]);
    const snap = await svc.getLibrary("t");
    expect(snap.tracks.map((t) => t.id)).toEqual(["b"]);
  });

  it("snapshot includes a suspects array (placeholder, empty at this stage)", async () => {
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [makeTrack({ id: "a" })] }),
      fakeDismissalStore(),
    );
    const snap = await svc.getLibrary("t");
    expect(Array.isArray(snap.suspects)).toBe(true);
    expect(snap.suspects).toEqual([]);
  });
});

// T5: createLibraryService now takes a DismissalStore as its second argument and
// computes real suspects (findSuspectPairs) instead of the [] placeholder.
describe("createLibraryService — suspects wired to real computation (T5)", () => {
  it("computes suspects from the fetched tracks via findSuspectPairs", async () => {
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive()] }),
      fakeDismissalStore(),
    );
    const snap = await svc.getLibrary("t");
    expect(snap.suspects).toHaveLength(1);
    expect(snap.suspects[0]!.pairKey).toBe(suspectPairKey);
  });

  it("does not surface a confident duplicate as a suspect — it is resolved by cleanup instead", async () => {
    const svc = createLibraryService(
      fakeGateway({
        fetchSavedTracks: async () => [confidentA(), confidentB(), lemon(), lemonLive()],
      }),
      fakeDismissalStore(),
    );
    const snap = await svc.getLibrary("t");
    expect(snap.cleanup).toHaveLength(1);
    expect(snap.cleanup[0]!.keep.id).toBe("c1");
    expect(snap.cleanup[0]!.removals.map((r) => r.track.id)).toEqual(["c2"]);
    expect(snap.suspects).toHaveLength(1);
    expect(snap.suspects[0]!.pairKey).toBe(suspectPairKey);
  });

  it("seeds the dismissed set from dismissals.list() so a pre-existing dismissal is respected on first build", async () => {
    const withoutDismissal = await createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive()] }),
      fakeDismissalStore(),
    ).getLibrary("t");
    expect(withoutDismissal.suspects).toHaveLength(1); // baseline: the pair is a suspect absent any dismissal

    const withDismissal = await createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive()] }),
      fakeDismissalStore([suspectPairKey]),
    ).getLibrary("t");
    expect(withDismissal.suspects).toEqual([]);
  });

  it("applyLocalDelete recomputes suspects — a deleted track's suspected pair disappears", async () => {
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive()] }),
      fakeDismissalStore(),
    );
    const before = await svc.getLibrary("t");
    expect(before.suspects).toHaveLength(1); // baseline: present before the delete

    svc.applyLocalDelete(["s2"]);
    const after = await svc.getLibrary("t");
    expect(after.suspects).toEqual([]);
  });

  it("dismiss(pairKey, ts) records the dismissal and recomputes suspects from the cache without refetching", async () => {
    let calls = 0;
    const dismissals = fakeDismissalStore();
    const svc = createLibraryService(
      fakeGateway({
        fetchSavedTracks: async () => {
          calls++;
          return [lemon(), lemonLive()];
        },
      }),
      dismissals,
    );
    const before = await svc.getLibrary("t");
    expect(before.suspects).toHaveLength(1);
    expect(calls).toBe(1);

    svc.dismiss(suspectPairKey, "2026-01-01T00:00:00Z");

    expect(dismissals.list()).toEqual([suspectPairKey]);
    expect(calls).toBe(1); // dismiss must not trigger a refetch

    const after = await svc.getLibrary("t"); // cache is warm; no force
    expect(after.suspects).toEqual([]);
    expect(calls).toBe(1); // still no refetch triggered by the follow-up getLibrary
  });

  it("dismiss(pairKey, ts) before any getLibrary call just records — it does not throw", async () => {
    const dismissals = fakeDismissalStore();
    const svc = createLibraryService(fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive()] }), dismissals);

    expect(() => svc.dismiss(suspectPairKey, "2026-01-01T00:00:00Z")).not.toThrow();
    expect(dismissals.list()).toEqual([suspectPairKey]);
  });

  // D: dismiss() must filter the cached suspects in place, not recompute-and-drop
  // everything — a snapshot with more than one suspect pair should lose only the
  // dismissed pair, and dismiss must never trigger a Spotify refetch.
  it("dismiss(pairKey, ts) on a multi-pair snapshot removes only the dismissed pair, leaves the rest, and never refetches (D1)", async () => {
    let calls = 0;
    const other1 = () =>
      makeTrack({ id: "o1", name: "夜空中最亮的星 陪我長大", artists: ["逃跑計劃"], isPlayable: true, popularity: 70 });
    const other2 = () =>
      makeTrack({ id: "o2", name: "夜空中最亮的星 陪伴我長大", artists: ["逃跑計劃"], isPlayable: true, popularity: 40 });
    const otherPairKey = [other1().id, other2().id].sort().join("|");

    const dismissals = fakeDismissalStore();
    const svc = createLibraryService(
      fakeGateway({
        fetchSavedTracks: async () => {
          calls++;
          return [lemon(), lemonLive(), other1(), other2()];
        },
      }),
      dismissals,
    );

    const before = await svc.getLibrary("t");
    expect(before.suspects.map((p) => p.pairKey).sort()).toEqual([otherPairKey, suspectPairKey].sort());
    const untouchedPairBefore = before.suspects.find((p) => p.pairKey === otherPairKey);

    svc.dismiss(suspectPairKey, "2026-01-01T00:00:00Z");
    expect(calls).toBe(1); // dismiss itself must not refetch

    const after = await svc.getLibrary("t");
    expect(after.suspects.map((p) => p.pairKey)).toEqual([otherPairKey]);
    expect(after.suspects[0]).toEqual(untouchedPairBefore); // the surviving pair is unchanged
    expect(calls).toBe(1); // the follow-up getLibrary must still serve from cache
  });
});

// T5 (cross-language): createLibraryService gains an OPTIONAL third argument,
// `embed?: { cache: EmbeddingCache; gateway: EmbeddingGateway }`. When present the
// service also runs findCrossLanguagePairs and merges the results into
// snapshot.suspects (deduped by pairKey). Omitted, behavior is unchanged (asserted
// above, untouched).

/** In-memory EmbeddingCache fake — a Map keyed by trackId, mirroring the real adapter's get/put contract. */
function fakeEmbeddingCache(seed: { trackId: string; vec: number[]; nameHash: string; model: string }[] = []): EmbeddingCache {
  const store = new Map<string, CachedEmbedding>();
  for (const row of seed) store.set(row.trackId, { vec: row.vec, nameHash: row.nameHash, model: row.model });
  return {
    get(ids: string[]) {
      const out = new Map<string, CachedEmbedding>();
      for (const id of ids) {
        const hit = store.get(id);
        if (hit) out.set(id, hit);
      }
      return out;
    },
    put(rows) {
      for (const row of rows) store.set(row.trackId, { vec: row.vec, nameHash: row.nameHash, model: row.model });
    },
  };
}

/** Fake EmbeddingGateway: maps title -> a caller-supplied vector, defaulting to a zero vector, and counts embedded texts. */
function fakeEmbeddingGateway(
  vectorByTitle: Record<string, number[]>,
  opts: { modelId?: string; onEmbed?: (texts: string[]) => void; impl?: (texts: string[]) => Promise<number[][]> } = {},
): EmbeddingGateway & { calls: number } {
  const gw = {
    modelId: opts.modelId ?? "fake-model",
    calls: 0,
    async embed(texts: string[]) {
      gw.calls += texts.length;
      opts.onEmbed?.(texts);
      if (opts.impl) return opts.impl(texts);
      return texts.map((t) => vectorByTitle[t] ?? [0, 0]);
    },
  };
  return gw;
}

/**
 * Fake EmbeddingGateway whose `embed` call never resolves on its own — the caller
 * (test) resolves it manually via `.resolve()` once ready, using the titles
 * captured at call time. Lets a test observe the state WHILE the background
 * cross-language pass is still in flight (BG1), which a same-tick-resolving fake
 * cannot do deterministically.
 */
function deferredEmbeddingGateway(
  vectorByTitle: Record<string, number[]>,
  opts: { modelId?: string } = {},
): EmbeddingGateway & { calls: number; resolve: () => void } {
  let release: ((vecs: number[][]) => void) | null = null;
  let capturedTexts: string[] = [];
  const gw = {
    modelId: opts.modelId ?? "fake-model",
    calls: 0,
    async embed(texts: string[]) {
      gw.calls += texts.length;
      capturedTexts = texts;
      return new Promise<number[][]>((resolve) => {
        release = resolve;
      });
    },
    resolve() {
      release?.(capturedTexts.map((t) => vectorByTitle[t] ?? [0, 0]));
    },
  };
  return gw;
}

// A cross-language pair that findSuspectPairs cannot catch: different primary
// artists and non-overlapping titles, so the artist-bucketed lexical layer never
// pairs them. Durations are within the 5000ms hint window.
const balloon = () =>
  makeTrack({ id: "z1", name: "告白氣球", artists: ["周杰倫"], durationMs: 200_000, isPlayable: true, popularity: 70 });
const bubble = () =>
  makeTrack({ id: "z2", name: "Bubble", artists: ["Jay Chou"], durationMs: 201_000, isPlayable: false, popularity: 20 });
const crossLangPairKey = "z1|z2";

describe("createLibraryService — cross-language suspects (T5, BACKGROUND contract)", () => {
  it("CL1: surfaces a cross-language pair that findSuspectPairs misses, once settled", async () => {
    // Arrange: both titles map to the same vector -> cosine 1, well above threshold.
    const cache = fakeEmbeddingCache();
    const gateway = fakeEmbeddingGateway({ 告白氣球: [1, 0], Bubble: [1, 0] });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [balloon(), bubble()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act: first snapshot kicks off the background pass; wait for it, then re-read the cache.
    await svc.getLibrary("t");
    await svc.settleCrossLanguage();
    const snap = await svc.getLibrary("t");

    // Assert: the cross-language pass surfaced the pair with the "跨語言相似" hint, and pending has cleared.
    const pair = snap.suspects.find((p) => p.pairKey === crossLangPairKey);
    expect(pair).toBeDefined();
    expect(pair!.hints).toContain("跨語言相似");
    expect(snap.crossLanguagePending).toBe(false);

    // Assert: without embed at all (2-arg construction), the same library yields no such pair and is
    // never pending — proving the cross-language layer, not the lexical one, is what surfaced it.
    const plainSvc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [balloon(), bubble()] }),
      fakeDismissalStore(),
    );
    const plainSnap = await plainSvc.getLibrary("t");
    expect(plainSnap.suspects).toEqual([]);
    expect(plainSnap.crossLanguagePending).toBe(false);
  });

  it("CL2: embeds only tracks missing from the cache (incremental), counted across settled background passes", async () => {
    // Arrange
    const cache = fakeEmbeddingCache();
    const gateway = fakeEmbeddingGateway({ 告白氣球: [1, 0], Bubble: [1, 0] });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [balloon(), bubble()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act: first build's background pass embeds both tracks (cache starts empty).
    await svc.getLibrary("t");
    await svc.settleCrossLanguage();
    expect(gateway.calls).toBe(2);

    // Act: a forced rebuild's own background pass, against the SAME now-warm cache, should re-embed nothing.
    await svc.getLibrary("t", true);
    await svc.settleCrossLanguage();

    // Assert
    expect(gateway.calls).toBe(2); // unchanged — no re-embedding of already-cached, fresh vectors
  });

  it("CL3/BG4: degrades gracefully when the embedding gateway throws — pending clears, lexical suspects survive", async () => {
    // Arrange: gateway.embed always rejects; library also has a normal lexical suspect pair.
    const cache = fakeEmbeddingCache();
    const gateway = fakeEmbeddingGateway(
      {},
      {
        impl: async () => {
          throw new Error("model unavailable");
        },
      },
    );
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act: getLibrary resolves immediately (no throw/500) with lexical suspects, pending true.
    const first = await svc.getLibrary("t");
    expect(first.suspects).toHaveLength(1);
    expect(first.suspects[0]!.pairKey).toBe(suspectPairKey);

    // Act: the background pass fails; settling must not throw and must clear pending.
    await expect(svc.settleCrossLanguage()).resolves.toBeUndefined();
    const settled = await svc.getLibrary("t");

    // Assert: no cross-language pairs, lexical suspects intact, pending cleared.
    expect(settled.crossLanguagePending).toBe(false);
    expect(settled.suspects).toHaveLength(1);
    expect(settled.suspects[0]!.pairKey).toBe(suspectPairKey);
  });

  it("CL4: dedupes by pairKey across lexical and cross-language passes, once settled", async () => {
    // Arrange: lemon()/lemonLive() would be surfaced by BOTH findSuspectPairs (version-suffix,
    // same artist) and the cross-language pass (same vector, close duration, same artist).
    const cache = fakeEmbeddingCache();
    const gateway = fakeEmbeddingGateway({ Lemon: [1, 0], "Lemon - Live": [1, 0] });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act
    await svc.getLibrary("t");
    await svc.settleCrossLanguage();
    const snap = await svc.getLibrary("t");

    // Assert: exactly one row for the pair, not a duplicate from each pass.
    const matches = snap.suspects.filter((p) => p.pairKey === suspectPairKey);
    expect(matches).toHaveLength(1);
  });

  it("CL5: applyLocalDelete recomputes cross-language from cache without re-embedding, and is never pending", async () => {
    // Arrange: a warm cache with the cross-language pair, plus an unrelated third track.
    const unrelated = () => makeTrack({ id: "u1", name: "Unrelated Song", artists: ["Someone"] });
    const cache = fakeEmbeddingCache();
    const gateway = fakeEmbeddingGateway({ 告白氣球: [1, 0], Bubble: [1, 0], "Unrelated Song": [0, 1] });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [balloon(), bubble(), unrelated()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );
    await svc.getLibrary("t");
    await svc.settleCrossLanguage(); // let the build's background pass finish before measuring the delete's cost
    const callsAfterBuild = gateway.calls;

    // Act: delete the unrelated track only.
    svc.applyLocalDelete(["u1"]);
    const after = await svc.getLibrary("t");

    // Assert: the cross-language pair survives, delete never re-embeds, and applyLocalDelete is synchronous (never pending).
    expect(after.suspects.some((p) => p.pairKey === crossLangPairKey)).toBe(true);
    expect(after.crossLanguagePending).toBe(false);
    expect(gateway.calls).toBe(callsAfterBuild);
  });

  it("BG5 (CL5b): deleting one member of a cross-language pair removes that pair with no dangling entry", async () => {
    // Arrange: build and settle so the cross-language pair is present in the cache.
    const cache = fakeEmbeddingCache();
    const gateway = fakeEmbeddingGateway({ 告白氣球: [1, 0], Bubble: [1, 0] });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [balloon(), bubble()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );
    await svc.getLibrary("t");
    await svc.settleCrossLanguage();
    const settled = await svc.getLibrary("t");
    expect(settled.suspects.some((p) => p.pairKey === crossLangPairKey)).toBe(true); // baseline

    // Act: delete one member of the pair.
    expect(() => svc.applyLocalDelete(["z1"])).not.toThrow();
    const after = await svc.getLibrary("t");

    // Assert: no dangling pair referencing the deleted track, no crash, never pending.
    expect(after.suspects.some((p) => p.pairKey === crossLangPairKey)).toBe(false);
    expect(after.crossLanguagePending).toBe(false);
  });

  it("CL6: a renamed track (cached nameHash != canonical(current name)) is re-embedded, once settled", async () => {
    // Arrange: pre-seed the cache for "z1" with a stale nameHash (as if the track used to be named
    // "old name"), but the track now has a different name — the service must detect the mismatch
    // via canonical(track.name) vs the cached nameHash and re-embed.
    const cache = fakeEmbeddingCache([
      { trackId: "z1", vec: [0, 1], nameHash: canonical("old name"), model: "fake-model" },
    ]);
    const renamed = () =>
      makeTrack({ id: "z1", name: "new name", artists: ["周杰倫"], durationMs: 200_000, isPlayable: true, popularity: 70 });
    const other = () =>
      makeTrack({ id: "z2", name: "Bubble", artists: ["Jay Chou"], durationMs: 201_000, isPlayable: false, popularity: 20 });
    const gateway = fakeEmbeddingGateway({ "new name": [1, 0], Bubble: [1, 0] });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [renamed(), other()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act
    await svc.getLibrary("t");
    await svc.settleCrossLanguage();

    // Assert: "z1" was re-embedded (its stale-model cache entry was not trusted) once the background pass settled.
    expect(gateway.calls).toBeGreaterThan(0);
  });

  it("BG6 (CL6b): a model-id change alone (fresh nameHash, stale model) invalidates the cached vector and re-embeds", async () => {
    // Arrange: cache entry has the CORRECT nameHash for the current name but a stale model id —
    // isolating the model-mismatch branch of freshVectors from the rename branch CL6 covers.
    const cache = fakeEmbeddingCache([
      { trackId: "z1", vec: [1, 0], nameHash: canonical(balloon().name), model: "old-model" },
    ]);
    const gateway = fakeEmbeddingGateway({ 告白氣球: [1, 0], Bubble: [1, 0] }, { modelId: "fake-model" });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [balloon(), bubble()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act
    await svc.getLibrary("t");
    await svc.settleCrossLanguage();

    // Assert: z1's stale-model vector was not trusted — the background pass re-embedded it.
    expect(gateway.calls).toBeGreaterThan(0);
  });

  it("BG1: first snapshot is lexical-only + pending while embedding runs; settling merges in the cross-language pair", async () => {
    // Arrange: gateway.embed never resolves until the test releases it.
    const cache = fakeEmbeddingCache();
    const gateway = deferredEmbeddingGateway({ 告白氣球: [1, 0], Bubble: [1, 0] });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive(), balloon(), bubble()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act: the first snapshot must resolve without waiting on the still-pending embed call.
    const first = await svc.getLibrary("t");

    // Assert: pending, lexical pair present, cross-language pair NOT yet present.
    expect(first.crossLanguagePending).toBe(true);
    expect(first.suspects.some((p) => p.pairKey === suspectPairKey)).toBe(true);
    expect(first.suspects.some((p) => p.pairKey === crossLangPairKey)).toBe(false);

    // Act: release the deferred embed call and let the background pass settle.
    gateway.resolve();
    await svc.settleCrossLanguage();
    const settled = await svc.getLibrary("t");

    // Assert: pending cleared, cross-language pair merged in, lexical pair still present.
    expect(settled.crossLanguagePending).toBe(false);
    expect(settled.suspects.some((p) => p.pairKey === crossLangPairKey)).toBe(true);
    expect(settled.suspects.some((p) => p.pairKey === suspectPairKey)).toBe(true);
  });

  it("BG2: no embed capability → never pending, suspects are lexical only, settleCrossLanguage resolves immediately", async () => {
    // Arrange: 2-arg construction (no embed argument at all).
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive()] }),
      fakeDismissalStore(),
    );

    // Act
    const snap = await svc.getLibrary("t");

    // Assert: never pending, lexical suspects only, and settling (nothing to settle) resolves right away.
    expect(snap.crossLanguagePending).toBe(false);
    expect(snap.suspects).toHaveLength(1);
    expect(snap.suspects[0]!.pairKey).toBe(suspectPairKey);
    await expect(svc.settleCrossLanguage()).resolves.toBeUndefined();
  });

  it("BG3 (F2): gateway.embed resolves with a shorter array than the input batch — degrades without corruption or throw", async () => {
    // Arrange: embed always returns [] regardless of how many texts it's given — a malformed
    // adapter response the service must never trust index-for-index.
    const cache = fakeEmbeddingCache();
    const putSpy = vi.spyOn(cache, "put");
    const gateway = fakeEmbeddingGateway({}, { impl: async () => [] });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive(), balloon(), bubble()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act: neither the initial call nor settling may throw.
    await expect(svc.getLibrary("t")).resolves.toBeDefined();
    await expect(svc.settleCrossLanguage()).resolves.toBeUndefined();
    const snap = await svc.getLibrary("t");

    // Assert: pending cleared, no cross-language pair (nothing usable came back), lexical suspects intact.
    expect(snap.crossLanguagePending).toBe(false);
    expect(snap.suspects.some((p) => p.pairKey === crossLangPairKey)).toBe(false);
    expect(snap.suspects.some((p) => p.pairKey === suspectPairKey)).toBe(true);

    // Assert (F2 strengthening): the malformed (length-mismatched) response must never be persisted —
    // no cache.put call at all, and a cache lookup for the stale ids (s1,s2,z1,z2, all missing pre-test)
    // comes back empty, proving no undefined/garbled vector slipped into the cache.
    expect(putSpy).not.toHaveBeenCalled();
    expect(cache.get(["s1", "s2", "z1", "z2"]).size).toBe(0);
  });
});

// REGRESSION: DISMISS-vs-BACKGROUND lost-update — a user dismissal that lands while
// the background cross-language pass is still in flight must survive the pass's
// swap-in. Today runBackgroundCrossLanguage merges its build-time-captured `lexical`
// array (frozen before the dismiss happened) back into the cache, resurrecting a pair
// the user just told the app to forget. This test is expected to FAIL until the
// service re-reads live dismissals (or the live cached suspects) at swap time instead
// of trusting the stale `lexical` closure.
describe("createLibraryService — dismiss-vs-background lost update (regression)", () => {
  it("a pair dismissed while the background cross-language pass is in flight stays dismissed once the pass settles", async () => {
    // Arrange: a lexical suspect pair (s1|s2) plus cross-language capability whose embed
    // call we control manually, so we can dismiss WHILE the background pass is pending.
    const cache = fakeEmbeddingCache();
    const gateway = deferredEmbeddingGateway({});
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [lemon(), lemonLive()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act (step 1): first snapshot is lexical-only and the background pass is still pending.
    const snap = await svc.getLibrary("t");
    expect(snap.suspects.some((p) => p.pairKey === suspectPairKey)).toBe(true);
    expect(snap.crossLanguagePending).toBe(true);

    // Act (step 2): the user dismisses the pair BEFORE the background pass resolves.
    svc.dismiss(suspectPairKey, "2026-01-01T00:00:00Z");

    // Act (step 3): now let the background pass settle.
    gateway.resolve();
    await svc.settleCrossLanguage();

    // Assert (step 4): the dismissal must stick — the background swap must not resurrect it.
    const after = await svc.getLibrary("t");
    expect(after.suspects.some((p) => p.pairKey === suspectPairKey)).toBe(false);
  });
});

// REGRESSION-GUARD (pin, not a bug): a background cross-language pass that resolves
// AFTER it has been superseded (by a delete / force-refresh / newer build bumping the
// generation counter) must discard its result entirely rather than writing a stale
// merge over the newer cache state.
describe("createLibraryService — generation guard discards a stale background write", () => {
  it("a background pass superseded by applyLocalDelete before it resolves never reintroduces a pair for the deleted track", async () => {
    // Arrange: a cross-language pair (z1|z2) via a deferred embed we control manually.
    const cache = fakeEmbeddingCache();
    const gateway = deferredEmbeddingGateway({ 告白氣球: [1, 0], Bubble: [1, 0] });
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [balloon(), bubble()] }),
      fakeDismissalStore(),
      { cache, gateway },
    );

    // Act: kick off the background pass (deferred, unresolved).
    await svc.getLibrary("t");

    // Act: supersede it before the embed resolves — delete one member of the pair,
    // which bumps the generation counter.
    svc.applyLocalDelete(["z1"]);

    // Act: only now let the stale background pass resolve.
    gateway.resolve();
    await svc.settleCrossLanguage();
    const after = await svc.getLibrary("t");

    // Assert: the stale result was discarded — no pair referencing the deleted track,
    // and the cache reflects the delete's own (synchronous) recomputation, never pending.
    expect(after.suspects.some((p) => p.pairKey === crossLangPairKey)).toBe(false);
    expect(after.tracks.some((t) => t.id === "z1")).toBe(false);
    expect(after.crossLanguagePending).toBe(false);
  });
});

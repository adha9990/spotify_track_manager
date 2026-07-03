import { describe, expect, it } from "vitest";
import { makeTrack } from "../domain/fixtures";
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
});

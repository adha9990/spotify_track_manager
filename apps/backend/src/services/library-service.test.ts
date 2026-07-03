import { describe, expect, it } from "vitest";
import { makeTrack } from "../domain/fixtures";
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
    );
    await svc.getLibrary("t");
    svc.applyLocalDelete(["a"]);
    const snap = await svc.getLibrary("t");
    expect(snap.tracks.map((t) => t.id)).toEqual(["b"]);
  });

  it("snapshot includes a suspects array (placeholder, empty at this stage)", async () => {
    const svc = createLibraryService(
      fakeGateway({ fetchSavedTracks: async () => [makeTrack({ id: "a" })] }),
    );
    const snap = await svc.getLibrary("t");
    expect(Array.isArray(snap.suspects)).toBe(true);
    expect(snap.suspects).toEqual([]);
  });
});

import type { Track } from "@stm/shared";
import { expect, it, vi } from "vitest";
import { makeTrack } from "../domain/fixtures";
import { createLibraryService } from "./library-service";

const now = "2026-11-18T00:00:00Z";

it("shares the initial fetch, applies local deletes and refreshes on demand", async () => {
  const saved = makeTrack({ id: "saved" });
  const fetchSavedTracks = vi.fn().mockResolvedValueOnce([saved]).mockResolvedValueOnce([]);
  const library = createLibraryService({ fetchSavedTracks });
  const first = library.getLibrary(now);
  expect(library.getLibrary(now)).toBe(first);
  expect(await first).toEqual({ tracks: [saved], fetchedAt: now });
  library.applyLocalDelete([saved.id]);
  expect(await library.getLibrary(now)).toEqual({ tracks: [], fetchedAt: now });
  expect(fetchSavedTracks).toHaveBeenCalledTimes(1);
  await library.getLibrary(now, true);
  expect(fetchSavedTracks).toHaveBeenCalledTimes(2);
});

it("does not cache a library fetch superseded by a successful mutation", async () => {
  const restored = makeTrack({ id: "restored" });
  let finishOld = (_tracks: Track[]) => {};
  const held = new Promise<Track[]>((resolve) => { finishOld = resolve; });
  const fetchSavedTracks = vi.fn().mockReturnValueOnce(held).mockResolvedValueOnce([restored]);
  const library = createLibraryService({ fetchSavedTracks });

  const old = library.getLibrary(now);
  library.invalidateLibrary();
  const fresh = library.getLibrary(now);
  finishOld([]);

  expect(await old).toEqual(await fresh);
  expect(await library.getLibrary(now)).toEqual({ tracks: [restored], fetchedAt: now });
  expect(fetchSavedTracks).toHaveBeenCalledTimes(2);
});

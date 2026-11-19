// @vitest-environment node
import "fake-indexeddb/auto";
import type { Track } from "@stm/shared";
import { createStore, get, keys } from "idb-keyval";
import { expect, it } from "vitest";
import { prepareSongIndex } from "./song-vector-index";
import type { TrackVector } from "./similar-tracks";

const track: Track = {
  id: "fixture", name: "寶貝", artists: ["張懸"], isrc: null, durationMs: 180_000,
  isPlayable: true, popularity: 0, album: "", albumId: "", addedAt: null, releaseDate: null,
};

it("persists one vector per Spotify track and reuses it until the indexed fields change", async () => {
  const source = [{ track, position: 1 }, { track, position: 2 }];
  const store = createStore("stm-song-vectors", "tracks");
  const first = await prepareSongIndex(source);
  const persisted = await get<{ vector: TrackVector }>(track.id, store);
  expect(first.coverage).toEqual({ indexed: 1, reused: 0, audio: 0 });
  expect(first.songs[0]?.durationsMs).toEqual([180_000, 180_000]);
  expect(persisted?.vector.titleVector).toBeInstanceOf(Uint32Array);
  expect(await keys(store)).toEqual([track.id]);

  const reload = await prepareSongIndex(source);
  expect(reload.coverage.reused).toBe(1);
  expect(reload.songs[0]?.vector).toEqual(first.songs[0]?.vector);

  const changed = await prepareSongIndex([{ track: { ...track, name: "另一個標題" } }]);
  expect(changed.coverage.reused).toBe(0);
  expect((await get<{ vector: TrackVector }>(track.id, store))?.vector).toEqual(changed.songs[0]?.vector);
});

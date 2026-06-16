import { describe, expect, it } from "vitest";
import { collect, fetchSavedTracks, type Pager } from "./library";
import type { RawSavedItem } from "./normalize";

const item = (id: string | null): RawSavedItem => ({
  added_at: "2020-01-01T00:00:00Z",
  track: id === null ? null : { id, name: "Song", artists: [{ name: "A" }] },
});

const page = (items: RawSavedItem[], next: boolean) => ({
  items,
  next: next ? "https://api.spotify.com/v1/me/tracks?offset=50" : null,
});

/** Fake pager that serves a fixed sequence of pages regardless of the path. */
function fakePager(pages: ReturnType<typeof page>[]): Pager {
  let i = 0;
  return async () => pages[i++] ?? { items: [], next: null };
}

describe("collect / fetchSavedTracks", () => {
  it("walks every page in order", async () => {
    const pager = fakePager([
      page([item("1"), item("2")], true),
      page([item("3")], false),
    ]);
    const tracks = await fetchSavedTracks(pager);
    expect(tracks.map((t) => t.id)).toEqual(["1", "2", "3"]);
  });

  it("skips items whose track is null", async () => {
    const pager = fakePager([page([item("1"), item(null)], false)]);
    const tracks = await fetchSavedTracks(pager);
    expect(tracks.map((t) => t.id)).toEqual(["1"]);
  });

  it("skips tracks without an id", async () => {
    const raw: RawSavedItem = { added_at: "x", track: { id: null, name: "Local", artists: [] } };
    const pager = fakePager([{ items: [item("1"), raw], next: null }]);
    const tracks = await fetchSavedTracks(pager);
    expect(tracks.map((t) => t.id)).toEqual(["1"]);
  });

  it("stops gracefully on a page missing its items key", async () => {
    const pager: Pager = async () => ({ next: null });
    expect(await fetchSavedTracks(pager)).toEqual([]);
  });

  it("reduces the absolute `next` URL to a relative path", async () => {
    const seen: string[] = [];
    const pager: Pager = async (path) => {
      seen.push(path);
      return seen.length === 1
        ? page([item("1")], true)
        : page([item("2")], false);
    };
    await collect("/me/tracks?limit=50&market=from_token", pager);
    expect(seen[1]).toBe("/me/tracks?offset=50");
  });
});

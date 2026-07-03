import { describe, expect, it } from "vitest";
import { collect, fetchSavedTracks, searchTracks, type Pager } from "./library";
import type { apiJson } from "./api";
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

  it("de-duplicates repeated track ids across pages, keeping the first occurrence", async () => {
    // Spotify's /me/tracks paging can hand back the same id twice (library changing
    // mid-walk, or an outright API quirk). Liked Songs are a set keyed by track id,
    // and the whole duplicate/suspect pipeline assumes ids are unique — a repeated id
    // otherwise leaks past findConfidentDuplicates into findSuspectPairs and crashes.
    const pager = fakePager([
      page([item("1"), item("2")], true),
      page([item("2"), item("3")], false),
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

/** Raw /search track item with sensible defaults; override per test. */
const rawResult = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Song ${id}`,
  artists: [{ name: "A" }],
  album: { name: "Al" },
  duration_ms: 210_000,
  is_playable: true,
  ...over,
});

/** Fake apiJson serving a fixed /search payload, recording requested paths. */
const fakeFetcher = (items: unknown[], seen: string[] = []) =>
  (async (path: string) => {
    seen.push(path);
    return { tracks: { items } };
  }) as unknown as typeof apiJson;

describe("searchTracks", () => {
  it("filters out unplayable results", async () => {
    const results = await searchTracks(
      "q",
      fakeFetcher([rawResult("ok"), rawResult("dead", { is_playable: false })]),
    );
    expect(results.map((r) => r.id)).toEqual(["ok"]);
  });

  it("treats a missing is_playable flag as playable", async () => {
    const results = await searchTracks(
      "q",
      fakeFetcher([rawResult("noflag", { is_playable: undefined })]),
    );
    expect(results.map((r) => r.id)).toEqual(["noflag"]);
  });

  it("caps results at 10 after filtering", async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      rawResult(`t${i}`, { is_playable: i % 4 !== 0 }), // t0,t4,... 5 首不可播放
    );
    const results = await searchTracks("q", fakeFetcher(items));
    expect(results).toHaveLength(10);
    expect(results.every((r) => !["t0", "t4", "t8", "t12", "t16"].includes(r.id))).toBe(true);
  });

  it("maps durationMs and defaults it to 0 when missing", async () => {
    const results = await searchTracks(
      "q",
      fakeFetcher([rawResult("a", { duration_ms: 187_000 }), rawResult("b", { duration_ms: undefined })]),
    );
    expect(results.map((r) => r.durationMs)).toEqual([187_000, 0]);
  });

  it("over-fetches 20 from the user's market so filtering can't starve the list", async () => {
    const seen: string[] = [];
    await searchTracks("周杰倫 晴天", fakeFetcher([], seen));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("limit=20");
    expect(seen[0]).toContain("market=from_token");
  });
});

import { describe, expect, it, vi } from "vitest";
import { collect, fetchPlaylistEntries, fetchPlaylists, fetchSavedTracks, mutateSaved, searchTracks, type Pager } from "./library";
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
    // Liked Songs are a set even if a library update shifts items between pages.
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

const fakeFetcher = (items: unknown[], seen: string[] = []) => async (path: string) => {
  seen.push(path);
  return { tracks: { items } };
};

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

  it("includes the ISRC and primary artist identity for replacement checks", async () => {
    const results = await searchTracks("isrc:TWABC2000001", fakeFetcher([rawResult("ok", {
      artists: [{ id: "lead", name: "Lead" }, { id: "guest", name: "Guest" }],
      external_ids: { isrc: "TWABC2000001" },
    })]));
    expect(results[0]).toMatchObject({ primaryArtistId: "lead", artists: ["Lead", "Guest"], isrc: "TWABC2000001" });
  });

  it("caps the page size at 10 and tries another page after filtering", async () => {
    const seen: string[] = [];
    const results = await searchTracks("周杰倫 晴天", async (path) => {
      seen.push(path);
      return seen.length === 1
        ? { tracks: { items: [rawResult("dead", { is_playable: false })], next: "next" } }
        : { tracks: { items: [rawResult("ok")] } };
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("limit=10");
    expect(seen[1]).toContain("offset=10");
    expect(results.map((track) => track.id)).toEqual(["ok"]);
  });
});

describe("playlist paging", () => {
  it("preserves repeated positions and handles both item wrappers across pages", async () => {
    const next = "https://api.spotify.com/v1/playlists/list123/items?offset=3";
    const pager = vi.fn<Pager>()
      .mockResolvedValueOnce({
        offset: 0,
        items: [
          { item: { id: "same", name: "Song", type: "track" } },
          null,
          { item: { id: "episode", type: "episode" } },
        ],
        next,
      })
      .mockResolvedValueOnce({ offset: 3, items: [item("same")], next: null });
    const contents = await fetchPlaylistEntries("list123", pager);
    expect(pager.mock.calls.map(([path]) => path)).toEqual([
      "/playlists/list123/items?limit=50",
      "/playlists/list123/items?offset=3",
    ]);
    expect(contents.entries.map(({ position, track }) => [position, track.id])).toEqual([[1, "same"], [4, "same"]]);
    expect(contents.skipped).toBe(2);
  });

  it("lists private, legacy and count-free playlist summaries across pages", async () => {
    const lists = await fetchPlaylists(async (endpoint) => endpoint.includes("offset=")
      ? { items: [{ id: "followed", name: "Followed" }] }
      : {
        next: "https://api.spotify.com/v1/me/playlists?offset=2",
        items: [
          { id: "current", name: "Current", items: { total: 0 } },
          { id: "legacy", name: "Legacy", tracks: { total: 6 } },
        ],
      });
    expect(lists.map(({ id, itemCount }) => [id, itemCount])).toEqual([
      ["current", 0], ["legacy", 6], ["followed", null],
    ]);
  });
});

describe("saved track changes", () => {
  it("uses Spotify track URIs with the current endpoint's 40-item limit", async () => {
    const request = vi.fn(async (_path: string, _init?: RequestInit) => new Response());
    await mutateSaved(request, "DELETE", Array.from({ length: 41 }, (_, index) => `t${index}`));
    expect(request.mock.calls.map(([endpoint, init]) => {
      const url = new URL(endpoint, "https://api.spotify.com");
      return [url.pathname, init?.method, url.searchParams.get("uris")?.split(",").length];
    })).toEqual([["/me/library", "DELETE", 40], ["/me/library", "DELETE", 1]]);
    expect(request.mock.calls[1]?.[0]).toContain("spotify%3Atrack%3At40");
  });
});

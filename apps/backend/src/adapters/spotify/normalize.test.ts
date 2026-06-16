import { describe, expect, it } from "vitest";
import { trackFromItem, type RawSavedItem, type RawTrack } from "./normalize";

// Build a raw saved-tracks item the way the Spotify API returns it. Mirrors the
// Python `make_saved_item` fixture: is_playable omitted models "no market sent".
function rawItem(
  over: Partial<RawTrack> & { id?: string | null } = {},
  addedAt: string | null = "2020-01-01T00:00:00Z",
): RawSavedItem {
  const { id = "id1", name = "Song", artists = [{ name: "Artist A" }], ...rest } = over;
  return { added_at: addedAt, track: { id, name, artists, ...rest } };
}

describe("trackFromItem", () => {
  it("extracts the basic fields", () => {
    const t = trackFromItem(rawItem({ id: "x1", name: "Hello", artists: [{ name: "A" }] }))!;
    expect(t.id).toBe("x1");
    expect(t.name).toBe("Hello");
    expect(t.artists[0]).toBe("A");
  });

  it("keeps all artists in order", () => {
    const t = trackFromItem(rawItem({ artists: [{ name: "A" }, { name: "B" }, { name: "C" }] }))!;
    expect(t.artists).toEqual(["A", "B", "C"]);
  });

  it("defaults isPlayable to true when the field is missing", () => {
    const t = trackFromItem(rawItem({}))!;
    expect(t.isPlayable).toBe(true);
  });

  it("respects an explicit isPlayable=false", () => {
    const t = trackFromItem(rawItem({ is_playable: false }))!;
    expect(t.isPlayable).toBe(false);
  });

  it("extracts the ISRC", () => {
    const t = trackFromItem(rawItem({ external_ids: { isrc: "GBXYZ0000001" } }))!;
    expect(t.isrc).toBe("GBXYZ0000001");
  });

  it("sets isrc to null when missing", () => {
    expect(trackFromItem(rawItem({}))!.isrc).toBeNull();
  });

  it("defaults popularity to 0 when missing", () => {
    expect(trackFromItem(rawItem({}))!.popularity).toBe(0);
  });

  it("extracts addedAt from the wrapper", () => {
    const t = trackFromItem(rawItem({}, "2021-06-05T12:00:00Z"))!;
    expect(t.addedAt).toBe("2021-06-05T12:00:00Z");
  });

  it("yields an empty artist list when there are no artists", () => {
    expect(trackFromItem(rawItem({ artists: [] }))!.artists).toEqual([]);
  });

  it("returns null for a null track (e.g. a removed local file)", () => {
    expect(trackFromItem({ added_at: "x", track: null })).toBeNull();
  });

  it("returns null for a track without an id", () => {
    expect(trackFromItem(rawItem({ id: null }))).toBeNull();
  });

  it("pulls album name, id and release date", () => {
    const t = trackFromItem(
      rawItem({ album: { id: "alb1", name: "Greatest Hits", release_date: "1999-01-01" } }),
    )!;
    expect(t.album).toBe("Greatest Hits");
    expect(t.albumId).toBe("alb1");
    expect(t.releaseDate).toBe("1999-01-01");
  });
});

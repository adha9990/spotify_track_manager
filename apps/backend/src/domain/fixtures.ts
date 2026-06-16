import type { Track } from "@stm/shared";

// Test-only helper. Not reachable from the bundle entry (src/bin/server.ts), so it is
// never shipped — it just spares every test file from spelling out all fields.

/** Build a Track with sensible defaults; override only what a test cares about. */
export function makeTrack(over: Partial<Track> & { id: string }): Track {
  return {
    name: "Song",
    artists: ["A"],
    isrc: null,
    popularity: 50,
    isPlayable: true,
    addedAt: null,
    album: "Album",
    albumId: "alb",
    releaseDate: null,
    durationMs: 200_000,
    ...over,
  };
}

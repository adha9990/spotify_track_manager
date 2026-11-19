import { prepareSongIndex, type IndexCoverage } from "./song-vector-index";
import { compareSongs, groupSimilarPairs, type IndexedSong, type SimilarGroup, type SimilarPair, type SongEntry } from "./similar-tracks";

export type SimilarityCommand =
  | { kind: "index"; entries: SongEntry[] }
  | { kind: "query"; threshold: number };

export type SimilarityResponse =
  | { kind: "indexed"; coverage: IndexCoverage }
  | { kind: "results"; threshold: number; groups: SimilarGroup[] }
  | { kind: "error"; stage: "index" | "query" };

let songs: IndexedSong[] = [];
let matches: { threshold: number; pairs: SimilarPair[] } | undefined;

function respond(message: SimilarityResponse) {
  self.postMessage(message);
}

self.addEventListener("message", async ({ data }: MessageEvent<SimilarityCommand>) => {
  try {
    if (data.kind === "index") {
      const result = await prepareSongIndex(data.entries);
      songs = result.songs;
      matches = undefined;
      respond({ kind: "indexed", coverage: result.coverage });
    } else {
      if (!matches || data.threshold < matches.threshold) {
        matches = { threshold: data.threshold, pairs: compareSongs(songs, data.threshold) };
      }
      respond({ kind: "results", threshold: data.threshold, groups: groupSimilarPairs(matches.pairs, data.threshold) });
    }
  } catch {
    respond({ kind: "error", stage: data.kind });
  }
});

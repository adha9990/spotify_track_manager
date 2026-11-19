import type { Track } from "@stm/shared";
import { describe, expect, it } from "vitest";
import { compareSongs, createTrackVector, groupSimilarPairs, lookupCachedVectors, type CachedRecording, type IndexedSong } from "./similar-tracks";

function song(id: string, name: string, changes: Partial<Track> = {}): IndexedSong {
  const track: Track = {
    id, name, artists: ["張懸"], isrc: null, durationMs: 180_000, isPlayable: true,
    popularity: 0, album: "", albumId: "", addedAt: null, releaseDate: null, ...changes,
  };
  return { id, durationsMs: [track.durationMs], vector: createTrackVector(track) };
}

describe("similar songs for the whole source", () => {
  it("matches normalized ISRCs and scores normalized titles and editions", () => {
    const seed = song("seed", "寶貝", { isrc: "TW-ABC-20-00001" });
    const isrc = song("isrc", "Another title", { isrc: "twabc2000001", durationMs: 187_000 });
    const title = song("title", "宝贝", { artists: ["张悬"] });
    const version = song("version", "寶貝（現場版）", { durationMs: 185_001 });
    const durationOnly = song("other", "另一首歌");
    const pairs = compareSongs([seed, durationOnly, version, title, isrc]);
    expect(pairs.filter(({ left }) => left === "seed").map(({ right, similarity }) => [right, similarity]))
      .toEqual([["isrc", 100], ["title", 96], ["version", 85.6]]);
    expect(groupSimilarPairs(pairs, 90)[0]?.ids).toEqual(["seed", "isrc", "title"]);
    expect(groupSimilarPairs(pairs, 85.6)[0]?.ids).toContain("version");
  });

  it("returns a single match for all occurrences of a repeated Spotify track", () => {
    const track = { ...song("same", "歌曲"), durationsMs: [180_000, 180_000, 180_000] };
    const groups = groupSimilarPairs(compareSongs([track, song("other", "另一首歌")]), 100);
    expect(groups).toEqual([{ ids: ["same"], pairs: [
      { left: "same", right: "same", similarity: 100, audioSimilarity: null, hints: ["同一 Spotify 曲目", "時長相同"] },
    ] }]);
  });

  it("gives editions sharing an ISRC full similarity regardless of duration", () => {
    const isrc = "TWABC2000001";
    const short = song("short", "レイン", { isrc, durationMs: 255_000 });
    const long = song("long", "レイン", { isrc, durationMs: 256_000 });
    const unknown = song("unknown", "レイン", { isrc, durationMs: 0 });
    const differentIsrc = song("different", "レイン", { isrc: "TWABC2000002", durationMs: 256_000 });

    const pair = compareSongs([short, long])[0];
    expect(pair).toMatchObject({ similarity: 100, hints: ["ISRC 相同", "時長相差 1 秒"] });
    expect(compareSongs([short, unknown])[0]?.similarity).toBe(100);
    expect(compareSongs([short, differentIsrc])[0]?.similarity).toBe(95.6);
  });

  it("uses the album, artist credits and actual durations to score matching releases", () => {
    const source = song("source", "山海", { artists: ["風行者"], primaryArtistId: "artist", album: "首張專輯" });
    const alternate = song("alternate", "山海", {
      artists: ["风行者"], primaryArtistId: "reissueArtist", album: "首张专辑", durationMs: 179_000,
    });
    const anthology = song("anthology", "山海", {
      artists: ["風行者"], primaryArtistId: "artist", album: "精選輯", durationMs: 179_000,
    });
    const unrelated = song("unrelated", "深夜漫步", { artists: ["風行者"], primaryArtistId: "artist", album: "首張專輯" });
    expect(compareSongs([source, alternate])[0]).toMatchObject({
      similarity: 97.5, hints: ["繁簡藝名與發行資料相符", "專輯名稱相同", "時長相差 1 秒"],
    });
    expect(compareSongs([source, anthology])[0]?.similarity).toBe(95.5);
    expect(compareSongs([source, unrelated])).toEqual([]);
  });

  it("uses the sparse title vector for spelling variants and keeps meaningful subtitles", () => {
    const seed = song("seed", "Long song title");
    const close = song("close", "Long song tital");
    const subtitle = song("subtitle", "Long song title (Forever)");
    const pairs = compareSongs([seed, close, subtitle]);
    expect(pairs.map(({ left, right }) => [left, right])).toEqual([["seed", "close"]]);
    expect(pairs[0]?.hints).toContain("同藝人、歌名相近");
  });

  it("matches independent cached audio vectors and does not compare a recording with the same cache entry", () => {
    const seed = song("seed", "Original");
    const copy = song("copy", "Original");
    const similar = song("audio", "Other language title", { artists: ["不同藝人"] });
    const recordings: CachedRecording[] = [
      { title: "Original", artist: "張懸", isrcs: [], durationMs: 180_000, vector: new Float32Array([1, 0]) },
      { title: "Other language title", artist: "不同藝人", isrcs: [], durationMs: 180_000, vector: new Float32Array([0.98, Math.sqrt(1 - 0.98 ** 2)]) },
    ];
    const lookup = lookupCachedVectors(recordings);
    const pairs = compareSongs([seed, copy, similar].map((entry) => ({ ...entry, audio: lookup(entry.vector) })));
    expect(pairs.find(({ left, right }) => left === "seed" && right === "audio")).toMatchObject({ audioSimilarity: 98, similarity: 88.2 });
    expect(pairs.find(({ left, right }) => left === "seed" && right === "copy")).toMatchObject({ audioSimilarity: null, similarity: 96 });
  });

  it("uses the same formula for absent, invalid and different ISRCs", () => {
    const isrc = "TWABC2000001";
    const first = song("first", "レイン", { isrc });
    const second = (code: string | null) => song("second", "レイン", { isrc: code });
    const audio = (vector: number[]): CachedRecording => ({
      title: "レイン", artist: "張懸", isrcs: [], durationMs: 180_000, vector: new Float32Array(vector),
    });
    const left = { ...first, audio: audio([1, 0]) };
    const rightAudio = audio([0.8, 0.6]);
    const scores = [null, "unknown", "TWABC2000002"].map((code) => {
      const right = second(code);
      return [
        compareSongs([left, { ...right, audio: rightAudio }])[0]?.similarity,
        compareSongs([first, right])[0]?.similarity,
      ];
    });
    expect(scores).toEqual([[81.6, 96], [81.6, 96], [81.6, 96]]);
    expect(compareSongs([left, { ...second(isrc), audio: rightAudio }], 100)[0])
      .toMatchObject({ similarity: 100, audioSimilarity: null, hints: ["ISRC 相同", "時長相同"] });
  });

  it("matches distinct recordings with a shared ISRC by the nearest unambiguous duration", () => {
    const isrc = "TWABC2000001";
    const local: CachedRecording = {
      title: "レイン", artist: "張懸", isrcs: [isrc], durationMs: 255_000, vector: new Float32Array([1, 0]),
    };
    const other = { ...local, durationMs: 256_000, vector: new Float32Array([0.8, 0.6]) };
    const lookup = lookupCachedVectors([other, local]);
    const short = song("short", "レイン", { isrc, durationMs: 255_000 });
    const long = song("long", "レイン", { isrc, durationMs: 256_000 });
    expect(lookup(short.vector)).toBe(local);
    expect(lookup(long.vector)).toBe(other);
    expect(lookup(song("tie", "レイン", { isrc, durationMs: 255_500 }).vector)).toBeUndefined();
  });
});

import { createStore, getMany, setMany } from "idb-keyval";
import { readCachedRecordings } from "./discogs-cache";
import { compareSongPair, createTrackVector, lookupCachedVectors, type IndexedSong, type SimilarPair, type SongEntry, type TrackVector, type TrackVectorSource } from "./similar-tracks";

interface SavedVector {
  signature: string;
  vector: TrackVector;
}

export interface IndexCoverage {
  indexed: number;
  reused: number;
  audio: number;
}

const version = 3;
const signatureOf = (track: TrackVectorSource) =>
  JSON.stringify([version, track.name, track.artists[0], track.primaryArtistId, track.album, track.isrc, track.durationMs]);

export async function prepareSongIndex(source: SongEntry<TrackVectorSource>[]): Promise<{ songs: IndexedSong[]; coverage: IndexCoverage }> {
  const unique = new Map<string, { track: TrackVectorSource; durationsMs: number[] }>();
  for (const { track } of source) {
    const indexed = unique.get(track.id);
    if (indexed) indexed.durationsMs.push(track.durationMs);
    else unique.set(track.id, { track, durationsMs: [track.durationMs] });
  }
  const entries = [...unique.values()];
  const store = createStore("stm-song-vectors", "tracks");
  const [saved, audio] = await Promise.all([
    getMany<SavedVector>(entries.map(({ track }) => track.id), store),
    readCachedRecordings(),
  ]);
  const lookup = lookupCachedVectors(audio);
  const writes: [string, SavedVector][] = [];
  const songs = entries.map<IndexedSong>(({ track, durationsMs }, i) => {
    const signature = signatureOf(track);
    const prior = saved[i];
    const vector = prior?.signature === signature && prior.vector?.titleVector instanceof Uint32Array
      ? prior.vector : createTrackVector(track);
    if (vector !== prior?.vector) writes.push([track.id, { signature, vector }]);
    return { id: track.id, durationsMs, vector, audio: lookup(vector) };
  });
  if (writes.length > 0) await setMany(writes, store);
  return {
    songs,
    coverage: {
      indexed: songs.length,
      reused: songs.length - writes.length,
      audio: songs.filter((song) => song.audio).length,
    },
  };
}

export async function scoreTrackCandidates(origin: TrackVectorSource, candidates: TrackVectorSource[]) {
  const { songs: [source, ...versions] } = await prepareSongIndex([origin, ...candidates].map((track) => ({ track })));
  const pairs = new Map<string, SimilarPair>();
  if (!source) return pairs;
  for (const candidate of versions) {
    const pair = compareSongPair(source, candidate);
    if (pair) pairs.set(candidate.id, pair);
  }
  return pairs;
}

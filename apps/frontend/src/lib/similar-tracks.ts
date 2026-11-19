import type { Track } from "@stm/shared";
import {
  closeTrackDuration, durationToleranceMs, matchingReleaseMetadata, normalizeIsrc, normalizeTrackText,
  sameAlbumTitle, samePrimaryArtist, stripReleaseAnnotation, stripVersion, trackMatchMetadata,
  type TrackMatchMetadata, type TrackMatchSource,
} from "./track-metadata";

export type TrackVectorSource = Pick<Track, "id"> & TrackMatchSource;

export interface SongEntry<Source extends TrackVectorSource = Track> {
  track: Source;
  position?: number;
}

export interface CachedRecording {
  title: string | null;
  artist: string | null;
  isrcs: string[];
  durationMs: number;
  vector: Float32Array;
}

export interface TrackVector extends TrackMatchMetadata {
  baseTitle: string;
  titleVector: Uint32Array;
}

export interface IndexedSong {
  id: string;
  durationsMs: number[];
  vector: TrackVector;
  audio?: CachedRecording;
}

export interface SimilarPair {
  left: string;
  right: string;
  similarity: number;
  audioSimilarity: number | null;
  hints: string[];
}

export interface SimilarGroup {
  ids: string[];
  pairs: SimilarPair[];
}

const diceThreshold = 0.85;
const audioWeight = 0.9;
const albumBonus = 2;

export function createTrackVector(track: TrackVectorSource): TrackVector {
  const metadata = trackMatchMetadata(track);
  const { title } = metadata;
  // The sparse title vector stores nonzero bigram coordinates with multiplicity.
  const titleVector = new Uint32Array(Math.max(0, title.length - 1));
  for (let i = 0; i < titleVector.length; i++) {
    titleVector[i] = title.charCodeAt(i) * 65_536 + title.charCodeAt(i + 1);
  }
  return {
    ...metadata,
    baseTitle: stripVersion(normalizeTrackText(stripReleaseAnnotation(track.name))),
    titleVector: titleVector.sort(),
  };
}

function dice(a: Uint32Array, b: Uint32Array) {
  const total = a.length + b.length;
  if (total === 0 || 2 * Math.min(a.length, b.length) < total * diceThreshold) return 0;
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < a.length && j < b.length) {
    const left = a[i]!;
    const right = b[j]!;
    if (left === right) shared++;
    if (left <= right) i++;
    if (right <= left) j++;
  }
  return 2 * shared / total;
}

function durationHint(a: number, b: number) {
  if (a <= 0 || b <= 0) return null;
  const difference = Math.abs(a - b);
  return difference === 0 ? "時長相同" : `時長相差 ${difference / 1000} 秒`;
}

function titleArtistKey(title: string, artist: string) {
  return title && artist ? `title:${title}\0${artist}` : "";
}

function closestRecording(recordings: CachedRecording[], durationMs: number) {
  if (durationMs <= 0) return;
  let distance = Infinity;
  let closest: CachedRecording | undefined;
  for (const recording of recordings) {
    const difference = Math.abs(durationMs - recording.durationMs);
    if (difference > durationToleranceMs) continue;
    if (difference < distance) {
      distance = difference;
      closest = recording;
    } else if (difference === distance) {
      closest = undefined;
    }
  }
  return closest;
}

export function lookupCachedVectors(recordings: CachedRecording[]) {
  const byKey = new Map<string, CachedRecording[]>();
  for (const recording of recordings) {
    const titleArtist = titleArtistKey(normalizeTrackText(recording.title ?? ""), normalizeTrackText(recording.artist ?? ""));
    const codes = recording.isrcs.map(normalizeIsrc).filter(Boolean);
    const keys = new Set([titleArtist, ...codes.map((code) => "isrc:" + code)].filter(Boolean));
    for (const key of keys) {
      const group = byKey.get(key);
      if (group) group.push(recording);
      else byKey.set(key, [recording]);
    }
  }
  return ({ title, artist, durationMs, isrc }: TrackVector) => {
    const exact = isrc ? byKey.get("isrc:" + isrc) ?? [] : [];
    const sameCode = closestRecording(exact, durationMs);
    if (sameCode) return sameCode;
    const names = byKey.get(titleArtistKey(title, artist)) ?? [];
    const matches = names.filter((recording) => {
      const codes = recording.isrcs.map(normalizeIsrc).filter(Boolean);
      return closeTrackDuration(durationMs, recording.durationMs) && (!isrc || codes.length === 0 || codes.includes(isrc));
    });
    return matches.length === 1 ? matches[0] : undefined;
  };
}

function cosine(a: Float32Array, b: Float32Array) {
  // The cached Discogs Multi vectors are L2-normalized after pooling.
  let value = 0;
  for (let i = 0; i < a.length; i++) value += a[i]! * b[i]!;
  return Math.max(0, Math.min(1, value));
}

export function compareSongPair(a: IndexedSong, b: IndexedSong, threshold = 0): SimilarPair | undefined {
  const left = a.vector;
  const right = b.vector;
  const sameTrack = a.id === b.id;
  const sameIsrc = left.isrc !== "" && left.isrc === right.isrc;
  const sameArtist = samePrimaryArtist(left, right);
  const sameTitle = left.title !== "" && left.title === right.title;
  // A cached copy cannot be the reference recording for both sides.
  const leftAudio = a.audio;
  const rightAudio = b.audio;
  const hasAudioPair = leftAudio && rightAudio && leftAudio !== rightAudio;
  if (!sameTrack && !sameIsrc && !sameArtist && !sameTitle && !hasAudioPair) return;

  const leftMs = sameTrack ? Math.min(...a.durationsMs) : left.durationMs;
  const rightMs = sameTrack ? Math.max(...a.durationsMs) : right.durationMs;
  if (sameIsrc) {
    if (threshold > 100) return;
    const hints = sameTrack ? ["同一 Spotify 曲目", "ISRC 相同"] : ["ISRC 相同"];
    const timing = durationHint(leftMs, rightMs);
    if (timing) hints.push(timing);
    return { left: a.id, right: b.id, similarity: 100, audioSimilarity: null, hints };
  }

  const sameRelease = !sameArtist && matchingReleaseMetadata(left, right);
  let metadata = 0;
  let matchHint = "";
  if (sameTrack) {
    metadata = 100;
    matchHint = "同一 Spotify 曲目";
  } else if ((sameArtist || sameRelease) && left.title && right.title) {
    if (sameTitle) {
      metadata = 96;
      matchHint = sameRelease ? "繁簡藝名與發行資料相符" : "歌名與主要藝人相同";
    } else if (left.baseTitle && left.baseTitle === right.baseTitle) {
      metadata = 88;
      matchHint = "同名版本";
    } else {
      const similarity = dice(left.titleVector, right.titleVector);
      if (similarity >= diceThreshold) {
        metadata = similarity * 90;
        matchHint = "同藝人、歌名相近";
      }
    }
  } else if (sameTitle && left.artist && right.artist && closeTrackDuration(left.durationMs, right.durationMs)) {
    metadata = 68;
    matchHint = "同名、藝人不同";
  }

  const albumMatches = !sameTrack && metadata > 0 && sameAlbumTitle(left, right);
  if (albumMatches) metadata += albumBonus;

  const knownDurations = leftMs > 0 && rightMs > 0;
  const durationRatio = knownDurations ? Math.min(leftMs, rightMs) / Math.max(leftMs, rightMs) : 1;
  const ceiling = sameTrack && knownDurations && leftMs === rightMs ? 100 : 99.9;
  const weight = hasAudioPair ? audioWeight : 0;
  const audio = hasAudioPair ? 100 * cosine(leftAudio.vector, rightAudio.vector) : null;
  const combined = weight * (audio ?? 0) + (1 - weight) * metadata;
  const similarity = Math.min(ceiling, Math.round(combined * durationRatio * 10) / 10);
  if (similarity < threshold) return;

  const hints = matchHint ? [matchHint] : [];
  if (albumMatches) hints.push("專輯名稱相同");
  const timing = durationHint(leftMs, rightMs);
  if (timing) hints.push(timing);
  return {
    left: a.id,
    right: b.id,
    similarity,
    audioSimilarity: audio === null ? null : Math.round(audio * 10) / 10,
    hints,
  };
}

export function compareSongs(songs: IndexedSong[], threshold = 0): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  const minimum = Math.max(0.1, threshold);
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i]!;
    if (song.durationsMs.length > 1) {
      const repeated = compareSongPair(song, song, minimum);
      if (repeated) pairs.push(repeated);
    }
    for (let j = i + 1; j < songs.length; j++) {
      const match = compareSongPair(song, songs[j]!, minimum);
      if (match) pairs.push(match);
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity);
}

export function groupSimilarPairs(pairs: SimilarPair[], threshold: number): SimilarGroup[] {
  const parent = new Map<string, string>();
  function root(id: string) {
    let node = id;
    while (parent.has(node)) node = parent.get(node)!;
    if (node !== id) parent.set(id, node);
    return node;
  }

  const visible = pairs.filter((pair) => pair.similarity >= threshold);
  for (const { left, right } of visible) {
    const a = root(left);
    const b = root(right);
    if (a !== b) parent.set(b, a);
  }

  const groups = new Map<string, { ids: Set<string>; pairs: SimilarPair[] }>();
  for (const pair of visible) {
    const key = root(pair.left);
    let group = groups.get(key);
    if (!group) {
      group = { ids: new Set(), pairs: [] };
      groups.set(key, group);
    }
    group.ids.add(pair.left);
    group.ids.add(pair.right);
    group.pairs.push(pair);
  }
  return [...groups.values()].map(({ ids, pairs }) => ({ ids: [...ids], pairs }));
}

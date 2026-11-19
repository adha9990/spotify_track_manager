import type { Track } from "@stm/shared";
import { matchSong, replacementIdentity } from "./replacements";

export interface SavedAlternative {
  track: Track;
  versions: Track[];
  match: "isrc" | "artist" | "title";
}

function indexTrack(index: Map<string, Track[]>, key: string, track: Track) {
  if (!key) return;
  const versions = index.get(key);
  if (versions) versions.push(track);
  else index.set(key, [track]);
}

export function findUnplayableTracks(tracks: Track[]) {
  const unresolved: Track[] = [];
  const savedAlternatives: SavedAlternative[] = [];
  const unavailable = tracks.filter(({ isPlayable }) => !isPlayable);
  if (unavailable.length === 0) return { unresolved, savedAlternatives };

  const byIsrc = new Map<string, Track[]>();
  const byBaseTitle = new Map<string, Track[]>();
  const byTitle = new Map<string, Track[]>();
  for (const track of tracks) {
    if (!track.isPlayable) continue;
    const keys = replacementIdentity(track);
    indexTrack(byIsrc, keys.isrc, track);
    indexTrack(byBaseTitle, keys.base, track);
    indexTrack(byTitle, keys.title, track);
  }

  for (const track of unavailable) {
    const keys = replacementIdentity(track);
    const sameIsrc = byIsrc.get(keys.isrc);
    const sameArtist = byBaseTitle.get(keys.base)?.filter((version) => matchSong(keys, replacementIdentity(version)) !== null);
    const sameTitle = byTitle.get(keys.title);
    if (sameIsrc) savedAlternatives.push({ track, versions: sameIsrc, match: "isrc" });
    else if (sameArtist?.length) savedAlternatives.push({ track, versions: sameArtist, match: "artist" });
    else if (sameTitle) savedAlternatives.push({ track, versions: sameTitle, match: "title" });
    else unresolved.push(track);
  }
  return { unresolved, savedAlternatives };
}

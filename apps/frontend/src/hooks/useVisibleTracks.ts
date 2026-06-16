import type { Track } from "@stm/shared";
import fuzzysort from "fuzzysort";
import { useMemo } from "react";
import { useUi, type SortDir, type SortKey } from "../store/ui";

type Prepared = ReturnType<typeof fuzzysort.prepare>;

// A "prepared" track caches the joined artist string and fuzzysort's pre-indexed
// targets so search over 1700+ rows stays instant on every keystroke.
export interface PreparedTrack {
  track: Track;
  artist: string;
  _name: Prepared;
  _artist: Prepared;
  _album: Prepared;
}

const KEYS: (keyof PreparedTrack)[] = ["_name", "_artist", "_album"];

export function prepareTracks(tracks: Track[]): PreparedTrack[] {
  return tracks.map((track) => {
    const artist = track.artists.join(", ");
    return {
      track,
      artist,
      _name: fuzzysort.prepare(track.name),
      _artist: fuzzysort.prepare(artist),
      _album: fuzzysort.prepare(track.album),
    };
  });
}

const collator = new Intl.Collator(["zh-Hant", "en"], { numeric: true, sensitivity: "base" });

function compare(a: Track, b: Track, key: SortKey): number {
  switch (key) {
    case "name":
      return collator.compare(a.name, b.name);
    case "artist":
      return collator.compare(a.artists[0] ?? "", b.artists[0] ?? "");
    case "popularity":
      return a.popularity - b.popularity;
    case "added":
      return (a.addedAt ?? "").localeCompare(b.addedAt ?? "");
  }
}

function sortTracks(tracks: Track[], key: SortKey, dir: SortDir): Track[] {
  const sign = dir === "asc" ? 1 : -1;
  // id is the final tie-break, so equal rows keep a deterministic order.
  return [...tracks].sort((a, b) => compare(a, b, key) * sign || a.id.localeCompare(b.id));
}

/** Apply the current search + sort to a prepared track list. */
export function useVisibleTracks(prepared: PreparedTrack[]): Track[] {
  const search = useUi((s) => s.search);
  const sortKey = useUi((s) => s.sortKey);
  const sortDir = useUi((s) => s.sortDir);

  return useMemo(() => {
    const query = search.trim();
    if (!query) return sortTracks(prepared.map((p) => p.track), sortKey, sortDir);
    // Search ranks by the best-matching of name / artist / album; results keep score order.
    return fuzzysort.go(query, prepared, { keys: KEYS, limit: 1000 }).map((r) => r.obj.track);
  }, [prepared, search, sortKey, sortDir]);
}

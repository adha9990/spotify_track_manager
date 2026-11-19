import type { SearchResult, Track } from "@stm/shared";
import { matchingReleaseMetadata, normalizeIsrc, normalizeTrackText, samePrimaryArtist, stripReleaseAnnotation, trackMatchMetadata } from "./track-metadata";

export function replacementQueries(track: SearchResult): string[] {
  const queries = new Set<string>();
  const isrc = normalizeIsrc(track.isrc);
  if (isrc) queries.add(`isrc:${isrc}`);
  const title = stripReleaseAnnotation(track.name);
  const artist = track.artists[0]?.trim() ?? "";
  if (!title || (!artist && !track.primaryArtistId)) return [...queries];

  const quote = (value: string) => `"${value.replace(/["\\]/g, " ").trim()}"`;
  const query = (title: string, artist: string) => `track:${quote(title)}${artist ? ` artist:${quote(artist)}` : ""}`;
  const literal = query(title, artist);
  queries.add(literal);
  const simplified = query(normalizeTrackText(title), normalizeTrackText(artist));
  if (simplified !== literal.toLowerCase()) queries.add(simplified);
  return [...queries];
}

export function replacementIdentity(track: SearchResult) {
  return {
    ...trackMatchMetadata(track),
    base: normalizeTrackText(stripReleaseAnnotation(track.name)),
  };
}

const priority = { isrc: 0, title: 1, release: 2, version: 3 };
export type ReplacementMatch = keyof typeof priority;

export function matchSong(original: ReturnType<typeof replacementIdentity>, candidate: ReturnType<typeof replacementIdentity>): ReplacementMatch | null {
  if (original.isrc && original.isrc === candidate.isrc) return "isrc";
  if (!samePrimaryArtist(original, candidate)) return matchingReleaseMetadata(original, candidate) ? "release" : null;
  if (original.title && original.title === candidate.title) return "title";
  return original.base && original.base === candidate.base ? "version" : null;
}

export function matchingReplacements(original: Track, saved: Track[], catalog: SearchResult[]) {
  const source = replacementIdentity(original);
  const savedIds = new Set(saved.map(({ id }) => id));
  const candidates = new Map<string, SearchResult>();
  for (const track of [...catalog, ...saved.filter(({ isPlayable }) => isPlayable)]) candidates.set(track.id, track);
  candidates.delete(original.id);

  return [...candidates.values()].flatMap((track) => {
    const match = matchSong(source, replacementIdentity(track));
    return match ? [{ track, match, saved: savedIds.has(track.id) }] : [];
  }).sort((a, b) => priority[a.match] - priority[b.match]
    || Number(b.saved) - Number(a.saved)
    || Math.abs(a.track.durationMs - original.durationMs) - Math.abs(b.track.durationMs - original.durationMs));
}

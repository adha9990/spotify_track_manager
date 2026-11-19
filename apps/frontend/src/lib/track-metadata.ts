import type { Track } from "@stm/shared";
import { Converter } from "opencc-js/t2cn";

const toSimplified = Converter({ from: "t", to: "cn" });
const versionMarker = /\b(?:live|remaster|remastered|acoustic|demo|version|mix|edit|remix|instrumental|karaoke|feat)\b|现场|伴奏|纯音乐|版/;
const releaseAnnotation = /^(?:(?:\d{4} )?remaster(?:ed)?(?: \d{4})?(?: version)?|revisit(?: version)?|live(?: version| (?:at|in|from) .+)?|acoustic(?: version)?|radio edit|[現现][場场]版|重[製制]版)$/iu;
const soundtrackAnnotation = /(?:影[視视][劇剧]|[電电][視视][劇剧]|[電电]影).*(?:插曲|主[題题]曲|片[頭头尾]曲)/u;

const cleanText = (text: string) => text.toLowerCase().trim().replace(/\s+/g, " ");
export const normalizeTrackText = (text: string) => cleanText(toSimplified(text.normalize("NFKC")));

export type TrackMatchSource = Pick<Track, "name" | "artists" | "primaryArtistId" | "album" | "isrc" | "durationMs">;

export function trackMatchMetadata(track: TrackMatchSource) {
  const artistCredit = cleanText((track.artists[0] ?? "").normalize("NFKC"));
  return {
    title: normalizeTrackText(track.name),
    artist: normalizeTrackText(artistCredit),
    artistCredit,
    artistId: track.primaryArtistId ?? undefined,
    album: normalizeTrackText(track.album),
    durationMs: track.durationMs,
    isrc: normalizeIsrc(track.isrc),
  };
}

export type TrackMatchMetadata = ReturnType<typeof trackMatchMetadata>;
export const durationToleranceMs = 5_000;

export function closeTrackDuration(a: number, b: number) {
  return a > 0 && b > 0 && Math.abs(a - b) <= durationToleranceMs;
}

export function sameAlbumTitle(left: { album: string }, right: { album: string }) {
  return left.album !== "" && left.album === right.album;
}

export function matchingReleaseMetadata(left: TrackMatchMetadata, right: TrackMatchMetadata) {
  return left.title !== "" && left.title === right.title
    && left.artist !== "" && left.artist === right.artist && left.artistCredit !== right.artistCredit
    && sameAlbumTitle(left, right) && closeTrackDuration(left.durationMs, right.durationMs);
}

export function stripVersion(title: string, isVersion = (suffix: string) => versionMarker.test(suffix)) {
  for (const pattern of [/\(([^()]*)\)\s*$/, /\s-\s*([^-]+)$/]) {
    const suffix = title.match(pattern);
    if (suffix?.[1] && isVersion(suffix[1])) return title.slice(0, suffix.index).trim();
  }
  return title;
}

export function stripReleaseAnnotation(name: string) {
  const title = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  return stripVersion(title, (suffix) => releaseAnnotation.test(suffix) || soundtrackAnnotation.test(suffix));
}

export function samePrimaryArtist(
  left: { artist: string; artistId?: string },
  right: { artist: string; artistId?: string },
) {
  if (left.artistId && right.artistId) return left.artistId === right.artistId;
  return left.artist !== "" && left.artist === right.artist;
}

export function normalizeIsrc(text: string | null) {
  const value = (text ?? "").toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(value) ? value : "";
}

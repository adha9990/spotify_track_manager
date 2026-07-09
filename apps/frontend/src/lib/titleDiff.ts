/**
 * Splits two related titles into a common prefix, a common suffix, and the
 * two differing middle segments — used to highlight what changed between a
 * suspected-duplicate pair's titles (e.g. "勇氣" vs "勇氣 (Live版)").
 *
 * The suffix search is bounded to the portion of each string left over
 * after the prefix, so a short string fully contained in a longer one
 * (e.g. "xx" vs "xxx") can't have prefix+suffix overlap and double-count
 * characters.
 */
export function diffParts(
  a: string,
  b: string,
): { commonPrefix: string; commonSuffix: string; aMiddle: string; bMiddle: string } {
  const maxOverlap = Math.min(a.length, b.length);

  let prefixLen = 0;
  while (prefixLen < maxOverlap && a[prefixLen] === b[prefixLen]) {
    prefixLen++;
  }

  const remainingForSuffix = maxOverlap - prefixLen;
  let suffixLen = 0;
  while (
    suffixLen < remainingForSuffix &&
    a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const commonPrefix = a.slice(0, prefixLen);
  const commonSuffix = suffixLen === 0 ? "" : a.slice(a.length - suffixLen);
  const aMiddle = a.slice(prefixLen, a.length - suffixLen);
  const bMiddle = b.slice(prefixLen, b.length - suffixLen);

  return { commonPrefix, commonSuffix, aMiddle, bMiddle };
}

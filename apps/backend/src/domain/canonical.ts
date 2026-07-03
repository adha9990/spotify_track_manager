import { Converter } from "opencc-js/t2cn";

// canonical() builds a comparison key only — never rendered. It folds Traditional
// and Simplified Chinese spellings of the same title/artist onto one key so
// detect/cleanup treat them as duplicates.

// Module-level singleton: Converter() does ~2ms of dictionary setup, so build it once.
const toSimplified = Converter({ from: "t", to: "cn" });

const WHITESPACE = /\s+/g;

export function canonical(text: string): string {
  return toSimplified(text.normalize("NFKC")).toLowerCase().trim().replace(WHITESPACE, " ");
}

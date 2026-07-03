import { Converter } from "opencc-js/t2cn";

// canonical() builds a comparison key only — never rendered. It folds Traditional
// and Simplified Chinese spellings of the same title/artist onto one key so
// detect/cleanup treat them as duplicates.
//
// Known limitation: OpenCC's t2cn conversion also rewrites non-Chinese CJK text
// (e.g. Japanese kanji) that happens to share a Traditional-Chinese codepoint,
// and a handful of its mappings are many-to-one (e.g. 裏/里 both fold to 里) —
// so two distinct titles/artists can rarely collide onto the same canonical key.
// Accepted as a residual risk; the cleanup UI's per-group human review is the
// backstop.

// Module-level singleton: Converter() does ~2ms of dictionary setup, so build it once.
const toSimplified = Converter({ from: "t", to: "cn" });

const WHITESPACE = /\s+/g;

export function canonical(text: string): string {
  return toSimplified(text.normalize("NFKC")).toLowerCase().trim().replace(WHITESPACE, " ");
}

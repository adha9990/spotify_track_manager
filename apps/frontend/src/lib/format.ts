// Display formatters for the data cells. Kept pure and locale-aware (zh-Hant).

/** ms → m:ss. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** ISO timestamp → YYYY-MM-DD, or em dash. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

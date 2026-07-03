// The dismissed-pairs seam. When a user marks a suspected duplicate pair as
// "not a duplicate", that preference is persisted here so future scans don't
// keep resurfacing it; the concrete sqlite implementation lives in adapters/db.

export interface DismissalStore {
  /** Record that `pairKey` was dismissed at `ts`. Idempotent — dismissing twice is a no-op. */
  add(pairKey: string, ts: string): void;
  /** All dismissed pair keys. */
  list(): string[];
}

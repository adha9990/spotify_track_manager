import type { HistoryBatch } from "@stm/shared";

// The undo op-log seam. The HTTP layer records mutations and reverses batches
// through this interface; the concrete sqlite implementation lives in adapters/db.

export interface UndoReversal {
  action: "add" | "delete";
  trackIds: string[];
}

export interface HistoryStore {
  /** Record a completed mutation. `batchId`/`ts` are supplied by the caller. */
  record(action: "add" | "delete", trackIds: string[], batchId: string, ts: string): void;
  /** All batches, newest first. */
  list(): HistoryBatch[];
  /** Mark a batch undone and return what to reverse; null if unknown or already undone. */
  beginUndo(batchId: string): UndoReversal | null;
  /** Revert the undone flag — used to roll back if the Spotify reversal fails. */
  cancelUndo(batchId: string): void;
}

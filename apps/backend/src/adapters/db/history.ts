import Database from "better-sqlite3";
import type { HistoryBatch } from "@stm/shared";
import type { HistoryStore } from "../../ports/history-store";

// A durable op-log so every library mutation can be undone. Each user action is one
// "batch" (a delete or an add of N track ids). Undo reverses the batch: a delete is
// undone by re-adding the ids, an add by removing them. The op-log only records what
// happened — the caller performs the actual Spotify reversal and reports success.

interface BatchRow {
  batch_id: string;
  action: "add" | "delete";
  ts: string;
  track_ids: string;
  undone: number;
}

const toBatch = (r: BatchRow): HistoryBatch => ({
  batchId: r.batch_id,
  action: r.action,
  ts: r.ts,
  count: (JSON.parse(r.track_ids) as string[]).length,
  undone: r.undone === 1,
});

export class History implements HistoryStore {
  private db: Database.Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS batches (
        batch_id  TEXT PRIMARY KEY,
        action    TEXT NOT NULL CHECK (action IN ('add','delete')),
        ts        TEXT NOT NULL,
        track_ids TEXT NOT NULL,
        undone    INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  /** Record a completed mutation. `batchId`/`ts` are supplied by the caller (Node's clock). */
  record(action: "add" | "delete", trackIds: string[], batchId: string, ts: string): void {
    this.db
      .prepare("INSERT INTO batches (batch_id, action, ts, track_ids, undone) VALUES (?, ?, ?, ?, 0)")
      .run(batchId, action, ts, JSON.stringify(trackIds));
  }

  /** All batches, newest first. */
  list(): HistoryBatch[] {
    const rows = this.db
      .prepare("SELECT batch_id, action, ts, track_ids, undone FROM batches ORDER BY ts DESC")
      .all() as BatchRow[];
    return rows.map(toBatch);
  }

  /**
   * Mark a batch undone and return what to reverse. Returns null if the batch is
   * unknown or already undone (so the caller makes no Spotify call). The reversal
   * itself (add↔delete) is performed by the caller.
   */
  beginUndo(batchId: string): { action: "add" | "delete"; trackIds: string[] } | null {
    const row = this.db
      .prepare("SELECT action, track_ids, undone FROM batches WHERE batch_id = ?")
      .get(batchId) as Pick<BatchRow, "action" | "track_ids" | "undone"> | undefined;
    if (!row || row.undone === 1) return null;
    this.db.prepare("UPDATE batches SET undone = 1 WHERE batch_id = ?").run(batchId);
    return { action: row.action, trackIds: JSON.parse(row.track_ids) as string[] };
  }

  /** Revert the undone flag — used to roll back if the Spotify reversal fails. */
  cancelUndo(batchId: string): void {
    this.db.prepare("UPDATE batches SET undone = 0 WHERE batch_id = ?").run(batchId);
  }

  close(): void {
    this.db.close();
  }
}

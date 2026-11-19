import Database from "better-sqlite3";
import { HistoryTrackSchema, type HistoryBatch, type HistoryTrack } from "@stm/shared";
import { z } from "zod";
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

const trackIdsSchema = z.array(HistoryTrackSchema.shape.id);

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
      CREATE TABLE IF NOT EXISTS history_track_details (
        track_id TEXT PRIMARY KEY,
        details  TEXT NOT NULL
      );
    `);
  }

  /** Record a completed mutation. `batchId`/`ts` are supplied by the caller (Node's clock). */
  record(action: "add" | "delete", trackIds: string[], batchId: string, ts: string, tracks: HistoryTrack[] = []): void {
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO batches (batch_id, action, ts, track_ids, undone) VALUES (?, ?, ?, ?, 0)")
        .run(batchId, action, ts, JSON.stringify(trackIds));
      this.insertDetails(tracks);
    })();
  }

  rememberTracks(tracks: HistoryTrack[]): void {
    this.db.transaction(() => this.insertDetails(tracks))();
  }

  private insertDetails(tracks: HistoryTrack[]) {
    const insert = this.db.prepare(`
      INSERT INTO history_track_details (track_id, details) VALUES (?, ?)
      ON CONFLICT (track_id) DO NOTHING
    `);
    for (const { id, name, artists, album } of tracks) {
      if (name) insert.run(id, JSON.stringify({ id, name, artists, album }));
    }
  }

  /** All batches, newest first. */
  list(): HistoryBatch[] {
    const details = this.db.prepare<[], { track_id: string; details: string }>(
      "SELECT track_id, details FROM history_track_details",
    ).all();
    const byId = new Map(details.map((row) => [row.track_id, HistoryTrackSchema.parse(JSON.parse(row.details))]));
    const rows = this.db
      .prepare<[], BatchRow>("SELECT batch_id, action, ts, track_ids, undone FROM batches ORDER BY ts DESC")
      .all();
    return rows.map((row) => {
      const ids = trackIdsSchema.parse(JSON.parse(row.track_ids));
      return {
        batchId: row.batch_id,
        action: row.action,
        ts: row.ts,
        count: ids.length,
        undone: row.undone === 1,
        tracks: ids.map((id) => byId.get(id) ?? { id, name: null, artists: [], album: "" }),
      };
    });
  }

  /**
   * Mark a batch undone and return what to reverse. Returns null if the batch is
   * unknown or already undone (so the caller makes no Spotify call). The reversal
   * itself (add↔delete) is performed by the caller.
   */
  beginUndo(batchId: string): { action: "add" | "delete"; trackIds: string[] } | null {
    const row = this.db
      .prepare<[string], Pick<BatchRow, "action" | "track_ids" | "undone">>(
        "SELECT action, track_ids, undone FROM batches WHERE batch_id = ?",
      ).get(batchId);
    if (!row || row.undone === 1) return null;
    const trackIds = trackIdsSchema.parse(JSON.parse(row.track_ids));
    this.db.prepare("UPDATE batches SET undone = 1 WHERE batch_id = ?").run(batchId);
    return { action: row.action, trackIds };
  }

  /** Revert the undone flag — used to roll back if the Spotify reversal fails. */
  cancelUndo(batchId: string): void {
    this.db.prepare("UPDATE batches SET undone = 0 WHERE batch_id = ?").run(batchId);
  }

  close(): void {
    this.db.close();
  }
}

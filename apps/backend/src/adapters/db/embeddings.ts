import Database from "better-sqlite3";
import type { CachedEmbedding, EmbeddingCache } from "../../ports/embedding-cache";

// Durable cache of computed title embeddings, keyed by track id — pure storage, no
// freshness logic (the service compares name_hash/model to decide staleness). Vectors
// are stored as Float32 BLOBs to keep the DB compact; the row shape mirrors the port's
// CachedEmbedding plus the model/hash fields needed for invalidation.

interface EmbeddingRow {
  track_id: string;
  name_hash: string;
  model: string;
  vec: Buffer;
}

export class Embeddings implements EmbeddingCache {
  private db: Database.Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS title_embeddings (
        track_id  TEXT PRIMARY KEY,
        name_hash TEXT NOT NULL,
        model     TEXT NOT NULL,
        dim       INTEGER NOT NULL,
        vec       BLOB NOT NULL,
        ts        TEXT
      );
    `);
  }

  /** Upsert embeddings for a batch of tracks. Empty input is a no-op. */
  put(rows: { trackId: string; vec: number[]; nameHash: string; model: string }[]): void {
    if (rows.length === 0) return;

    const upsert = this.db.prepare(`
      INSERT INTO title_embeddings (track_id, name_hash, model, dim, vec, ts)
      VALUES (@trackId, @nameHash, @model, @dim, @vec, @ts)
      ON CONFLICT(track_id) DO UPDATE SET
        name_hash = excluded.name_hash,
        model     = excluded.model,
        dim       = excluded.dim,
        vec       = excluded.vec,
        ts        = excluded.ts
    `);

    const putBatch = this.db.transaction((batch: typeof rows) => {
      for (const row of batch) {
        upsert.run({
          trackId: row.trackId,
          nameHash: row.nameHash,
          model: row.model,
          dim: row.vec.length,
          vec: Buffer.from(new Float32Array(row.vec).buffer),
          ts: new Date().toISOString(),
        });
      }
    });
    putBatch(rows);
  }

  /** Fetch cached embeddings for the given track ids. Missing ids are simply absent from the map. */
  get(ids: string[]): Map<string, CachedEmbedding> {
    const result = new Map<string, CachedEmbedding>();
    if (ids.length === 0) return result;

    const select = this.db.prepare(
      "SELECT track_id, name_hash, model, vec FROM title_embeddings WHERE track_id = ?",
    );
    for (const id of ids) {
      const row = select.get(id) as EmbeddingRow | undefined;
      if (!row) continue;
      result.set(id, {
        vec: Array.from(
          new Float32Array(row.vec.buffer, row.vec.byteOffset, row.vec.byteLength / 4),
        ),
        nameHash: row.name_hash,
        model: row.model,
      });
    }
    return result;
  }

  close(): void {
    this.db.close();
  }
}

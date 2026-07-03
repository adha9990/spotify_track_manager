import Database from "better-sqlite3";
import type { DismissalStore } from "../../ports/dismissal-store";

// Persists the user's "not a duplicate" verdicts on suspected pairs. Distinct from the
// History op-log: this is a durable preference list, not an undoable action — once a
// pair is dismissed here, later scans should stop surfacing it as a candidate.

interface DismissalRow {
  pair_key: string;
  ts: string;
}

export class Dismissals implements DismissalStore {
  private db: Database.Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dismissed_pairs (
        pair_key TEXT PRIMARY KEY,
        ts       TEXT NOT NULL
      );
    `);
  }

  /** Record that `pairKey` was dismissed at `ts`. Idempotent — dismissing twice is a no-op. */
  add(pairKey: string, ts: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO dismissed_pairs (pair_key, ts) VALUES (?, ?)")
      .run(pairKey, ts);
  }

  /** All dismissed pair keys. */
  list(): string[] {
    const rows = this.db.prepare("SELECT pair_key, ts FROM dismissed_pairs").all() as DismissalRow[];
    return rows.map((r) => r.pair_key);
  }

  close(): void {
    this.db.close();
  }
}

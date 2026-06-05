"""SQLite 操作歷史:記錄每筆對收藏的 add/delete,支援查詢與標記復原。

一個使用者動作 = 一個 batch_id(一鍵刪 N 首算一批);復原以 batch 為單位反向。
純資料層,不碰 Spotify;反向操作由 server 持 client 執行。
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

_SCHEMA = """
CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    track_id TEXT NOT NULL,
    name TEXT,
    artist TEXT,
    undone INTEGER NOT NULL DEFAULT 0
)
"""


class History:
    def __init__(self, path: str = ":memory:"):
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute(_SCHEMA)
        self._conn.commit()

    def record(self, action: str, tracks: list[dict], batch_id: str | None = None) -> str:
        """記錄一批同類動作;tracks 為 [{id, name, artist}]。回傳 batch_id。"""
        batch_id = batch_id or uuid.uuid4().hex
        ts = datetime.now(timezone.utc).isoformat()
        self._conn.executemany(
            "INSERT INTO operations(batch_id, ts, action, track_id, name, artist)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            [
                (batch_id, ts, action, t["id"], t.get("name", ""), t.get("artist", ""))
                for t in tracks
            ],
        )
        self._conn.commit()
        return batch_id

    def list_batches(self) -> list[dict]:
        """每個 batch 一列摘要(新到舊):batch_id, action, ts, n, undone。"""
        rows = self._conn.execute(
            "SELECT batch_id, action, MIN(ts) AS ts, COUNT(*) AS n, MAX(undone) AS undone"
            " FROM operations GROUP BY batch_id ORDER BY MIN(id) DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def batch_tracks(self, batch_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT action, track_id, name, artist FROM operations WHERE batch_id = ?"
            " ORDER BY id",
            (batch_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def mark_undone(self, batch_id: str) -> None:
        self._conn.execute(
            "UPDATE operations SET undone = 1 WHERE batch_id = ?", (batch_id,)
        )
        self._conn.commit()

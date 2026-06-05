"""SQLite 操作歷史測試(全程記憶體 DB)。"""

from stm.history import History


def _tracks(*ids):
    return [{"id": i, "name": f"name-{i}", "artist": "A"} for i in ids]


def test_record_then_read_batch_tracks():
    h = History(":memory:")
    bid = h.record("delete", _tracks("a", "b"))
    rows = h.batch_tracks(bid)
    assert {r["track_id"] for r in rows} == {"a", "b"}
    assert all(r["action"] == "delete" for r in rows)
    assert {r["name"] for r in rows} == {"name-a", "name-b"}


def test_each_record_is_a_distinct_batch():
    h = History(":memory:")
    b1 = h.record("delete", _tracks("a"))
    b2 = h.record("add", _tracks("b"))
    assert b1 != b2
    assert [r["track_id"] for r in h.batch_tracks(b1)] == ["a"]
    assert [r["track_id"] for r in h.batch_tracks(b2)] == ["b"]


def test_list_batches_summarizes_newest_first():
    h = History(":memory:")
    h.record("delete", _tracks("a", "b"))
    h.record("add", _tracks("c"))
    batches = h.list_batches()
    assert len(batches) == 2
    # 新到舊:add 在前
    assert batches[0]["action"] == "add"
    assert batches[0]["n"] == 1
    assert batches[1]["action"] == "delete"
    assert batches[1]["n"] == 2
    assert all(b["undone"] == 0 for b in batches)


def test_mark_undone_flips_flag():
    h = History(":memory:")
    bid = h.record("delete", _tracks("a"))
    h.mark_undone(bid)
    assert h.list_batches()[0]["undone"] == 1


def test_persists_to_file(tmp_path):
    db = tmp_path / "h.db"
    h1 = History(str(db))
    bid = h1.record("delete", _tracks("a"))
    # 另開一個連線讀同一檔
    h2 = History(str(db))
    assert [r["track_id"] for r in h2.batch_tracks(bid)] == ["a"]

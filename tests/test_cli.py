"""CLI 端對端測試(以假 client 取代真網路與授權)。"""

import pytest
from typer.testing import CliRunner

from stm import cli
from .conftest import make_saved_item

runner = CliRunner()


class FakeClient:
    """回傳固定一頁歌曲、並記錄刪除呼叫的假 client。"""

    def __init__(self, items):
        self._page = {"items": items, "next": None}
        self.removed = []

    def saved_tracks_page(self):
        return self._page

    def playlist_page(self, playlist_id):
        return self._page

    def next_page(self, page):
        return None

    def remove_saved_tracks(self, ids):
        self.removed.append(list(ids))


@pytest.fixture
def fake_client(monkeypatch):
    # 兩首同名同歌手(可信重複)+ 一首失效;ISRC 各自獨立以反映真實資料
    items = [
        make_saved_item(track_id="dup1", name="Song", artists=("A",), popularity=10, isrc="US0000000001"),
        make_saved_item(track_id="dup2", name="Song", artists=("A",), popularity=90, isrc="US0000000001"),
        make_saved_item(track_id="dead", name="Gone", artists=("B",), is_playable=False, isrc="US0000000002"),
    ]
    client = FakeClient(items)
    monkeypatch.setattr(cli, "_load_client", lambda: client)
    return client


def test_scan_writes_single_markdown_report(fake_client, tmp_path):
    report = tmp_path / "report.md"
    result = runner.invoke(cli.app, ["scan", "--output", str(report)])
    assert result.exit_code == 0, result.output
    # 整理成一份 Markdown,各類別為 ## 分節
    content = report.read_text(encoding="utf-8")
    assert "## 所有歌曲" in content
    assert "## 可信重複(同名同歌手 / 同 ISRC)" in content
    assert "## 已失效歌曲" in content


def test_scan_does_not_delete(fake_client, tmp_path):
    runner.invoke(cli.app, ["scan", "--output", str(tmp_path / "report.md")])
    assert fake_client.removed == []


def test_dedupe_dry_run_does_not_delete(fake_client):
    result = runner.invoke(cli.app, ["dedupe"])
    assert result.exit_code == 0, result.output
    assert fake_client.removed == []
    assert "dry-run" in result.output.lower() or "預覽" in result.output


def test_dedupe_apply_deletes_lower_popularity(fake_client):
    result = runner.invoke(cli.app, ["dedupe", "--apply", "--yes"])
    assert result.exit_code == 0, result.output
    # 保留 popularity=90 的 dup2,刪除 popularity=10 的 dup1
    assert fake_client.removed == [["dup1"]]


def test_dedupe_apply_without_confirmation_aborts(fake_client):
    # 不帶 --yes 且互動式回答 n → 不應刪除
    runner.invoke(cli.app, ["dedupe", "--apply"], input="n\n")
    assert fake_client.removed == []


def test_dedupe_message_reflects_keep_strategy(fake_client):
    result = runner.invoke(cli.app, ["dedupe", "--keep", "oldest"])
    assert "最早收藏" in result.output
    assert "人氣最高" not in result.output


def test_dedupe_apply_aborts_when_exceeding_max_deletions(fake_client):
    # 刪除數量超過上限 → 中止且不刪除任何東西
    result = runner.invoke(
        cli.app, ["dedupe", "--apply", "--yes", "--max-deletions", "0"]
    )
    assert result.exit_code != 0
    assert fake_client.removed == []


def test_dedupe_apply_two_independent_groups_both_resolved(monkeypatch):
    items = [
        make_saved_item(track_id="g1_low", name="Alpha", artists=("A",), popularity=10, isrc="ISRC1"),
        make_saved_item(track_id="g1_high", name="Alpha", artists=("A",), popularity=80, isrc="ISRC1"),
        make_saved_item(track_id="g2_low", name="Beta", artists=("B",), popularity=20, isrc="ISRC2"),
        make_saved_item(track_id="g2_high", name="Beta", artists=("B",), popularity=70, isrc="ISRC2"),
    ]
    client = FakeClient(items)
    monkeypatch.setattr(cli, "_load_client", lambda: client)

    runner.invoke(cli.app, ["dedupe", "--apply", "--yes"])

    deleted = {tid for batch in client.removed for tid in batch}
    assert deleted == {"g1_low", "g2_low"}

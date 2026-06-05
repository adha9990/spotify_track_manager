"""單一 Markdown 報表輸出測試。"""

from stm.models import Track
from stm import writers


def track(track_id="1", name="Hello, Goodbye", artist="The Beatles", popularity=75):
    return Track(
        id=track_id,
        name=name,
        artists=(artist,),
        isrc="GB1234567890",
        popularity=popularity,
        is_playable=True,
        added_at="2020-01-01T00:00:00Z",
    )


def test_report_has_top_title(tmp_path):
    path = tmp_path / "report.md"
    writers.write_report([("所有歌曲", [track()])], path, title="我的報表")
    assert "# 我的報表" in path.read_text(encoding="utf-8")


def test_report_includes_each_section_heading_and_count(tmp_path):
    path = tmp_path / "report.md"
    writers.write_report(
        [("可信重複", [track()]), ("已失效", [])],
        path,
    )
    content = path.read_text(encoding="utf-8")
    assert "## 可信重複" in content
    assert "## 已失效" in content
    assert "共 1 首歌曲" in content
    assert "共 0 首歌曲" in content


def test_report_renders_table_rows(tmp_path):
    path = tmp_path / "report.md"
    writers.write_report([("區段", [track(name="Yesterday", artist="Beatles")])], path)
    content = path.read_text(encoding="utf-8")
    assert "| 歌名 | 歌手 | 人氣 | ID |" in content
    assert "| --- | --- | --- | --- |" in content
    assert "Yesterday" in content
    assert "Beatles" in content


def test_report_escapes_pipe_in_track_name(tmp_path):
    path = tmp_path / "report.md"
    writers.write_report([("區段", [track(name="A | B")])], path)
    # 歌名中的 | 須跳脫,否則破壞 Markdown 表格欄位
    assert r"A \| B" in path.read_text(encoding="utf-8")


def test_report_empty_section_still_renders_heading(tmp_path):
    path = tmp_path / "report.md"
    writers.write_report([("空區段", [])], path)
    content = path.read_text(encoding="utf-8")
    assert "## 空區段" in content
    assert "共 0 首歌曲" in content


def test_report_creates_parent_directory(tmp_path):
    path = tmp_path / "nested" / "report.md"
    writers.write_report([("區段", [track()])], path)
    assert path.exists()

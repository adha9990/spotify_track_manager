"""單一 HTML(頁籤式)報表輸出測試。"""

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


def test_report_is_html_document(tmp_path):
    path = tmp_path / "report.html"
    writers.write_report([("所有歌曲", [track()])], path)
    content = path.read_text(encoding="utf-8").lower()
    assert "<!doctype html" in content
    assert "<html" in content


def test_report_has_title(tmp_path):
    path = tmp_path / "report.html"
    writers.write_report([("所有歌曲", [track()])], path, title="我的報表")
    assert "我的報表" in path.read_text(encoding="utf-8")


def test_report_has_tab_per_section_with_count(tmp_path):
    path = tmp_path / "report.html"
    writers.write_report([("可信重複", [track()]), ("已失效", [])], path)
    content = path.read_text(encoding="utf-8")
    # 每個分節是一個頁籤,並顯示數量
    assert "可信重複" in content
    assert "已失效" in content
    assert 'class="tab' in content
    assert "共 1 首歌曲" in content
    assert "共 0 首歌曲" in content


def test_report_renders_table_rows(tmp_path):
    path = tmp_path / "report.html"
    writers.write_report([("區段", [track(name="Yesterday", artist="Beatles")])], path)
    content = path.read_text(encoding="utf-8")
    assert "<table" in content
    assert "<th>歌名</th>" in content
    assert "Yesterday" in content
    assert "Beatles" in content


def test_report_escapes_html_in_track_name(tmp_path):
    path = tmp_path / "report.html"
    writers.write_report([("區段", [track(name="A & <b>")])], path)
    content = path.read_text(encoding="utf-8")
    # 特殊字元須跳脫,否則破壞 HTML 結構
    assert "A &amp; &lt;b&gt;" in content
    assert "<b>" not in content.replace("<body>", "")  # 不應出現未跳脫的 <b>


def test_report_empty_section_still_has_tab(tmp_path):
    path = tmp_path / "report.html"
    writers.write_report([("空區段", [])], path)
    content = path.read_text(encoding="utf-8")
    assert "空區段" in content
    assert "共 0 首歌曲" in content


def test_report_creates_parent_directory(tmp_path):
    path = tmp_path / "nested" / "report.html"
    writers.write_report([("區段", [track()])], path)
    assert path.exists()

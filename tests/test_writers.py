"""報表輸出格式測試。"""

import csv
import json

import pytest

from stm.models import Track
from stm import writers


def track(track_id="1", name="Hello, Goodbye", artist="The Beatles"):
    return Track(
        id=track_id,
        name=name,
        artists=(artist,),
        isrc="GB1234567890",
        popularity=75,
        is_playable=True,
        added_at="2020-01-01T00:00:00Z",
    )


def test_txt_includes_header_count_and_track(tmp_path):
    path = tmp_path / "out.txt"
    writers.write_tracks([track()], path, fmt="txt", header="重複歌曲")
    content = path.read_text(encoding="utf-8")
    assert "重複歌曲" in content
    assert "共 1 首" in content
    assert "Hello, Goodbye" in content
    assert "The Beatles" in content


def test_csv_has_header_and_data_row(tmp_path):
    path = tmp_path / "out.csv"
    writers.write_tracks([track(track_id="abc")], path, fmt="csv")
    rows = list(csv.DictReader(path.read_text(encoding="utf-8").splitlines()))
    assert rows[0]["id"] == "abc"
    assert rows[0]["name"] == "Hello, Goodbye"
    assert rows[0]["artist"] == "The Beatles"
    assert rows[0]["isrc"] == "GB1234567890"


def test_md_has_heading_count_and_table(tmp_path):
    path = tmp_path / "out.md"
    writers.write_tracks([track()], path, fmt="md", header="重複歌曲")
    content = path.read_text(encoding="utf-8")
    assert "# 重複歌曲" in content
    assert "共 1 首歌曲" in content
    assert "| 歌名 | 歌手 |" in content  # 表格標頭
    assert "| --- |" in content  # 分隔列
    assert "Hello, Goodbye" in content
    assert "The Beatles" in content


def test_md_escapes_pipe_in_track_name(tmp_path):
    path = tmp_path / "out.md"
    writers.write_tracks([track(name="A | B")], path, fmt="md", header="x")
    content = path.read_text(encoding="utf-8")
    # 歌名中的 | 須跳脫,否則會破壞 Markdown 表格欄位
    assert r"A \| B" in content


def test_md_empty_list_still_writes_heading(tmp_path):
    path = tmp_path / "out.md"
    writers.write_tracks([], path, fmt="md", header="空清單")
    content = path.read_text(encoding="utf-8")
    assert "# 空清單" in content
    assert "共 0 首歌曲" in content


def test_json_round_trips(tmp_path):
    path = tmp_path / "out.json"
    writers.write_tracks([track(track_id="abc")], path, fmt="json")
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data[0]["id"] == "abc"
    assert data[0]["name"] == "Hello, Goodbye"
    assert data[0]["popularity"] == 75


def test_unknown_format_raises(tmp_path):
    with pytest.raises(ValueError):
        writers.write_tracks([track()], tmp_path / "out.xml", fmt="xml")


def test_creates_parent_directory(tmp_path):
    path = tmp_path / "nested" / "dir" / "out.txt"
    writers.write_tracks([track()], path, fmt="txt", header="x")
    assert path.exists()

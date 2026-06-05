"""把歌曲清單整理成單一 Markdown 報表。

輸入是多個 (分節標題, 歌曲清單),輸出是一份含 `##` 分節與表格的 .md 檔。
"""

from __future__ import annotations

from pathlib import Path

from .models import Track

Section = tuple[str, list[Track]]


def _md_cell(text) -> str:
    # 跳脫 | 以免破壞 Markdown 表格欄位
    return str(text).replace("|", r"\|")


def _section_lines(title: str, tracks: list[Track]) -> list[str]:
    lines = [f"## {title}", "", f"共 {len(tracks)} 首歌曲", ""]
    lines.append("| 歌名 | 歌手 | 人氣 | ID |")
    lines.append("| --- | --- | --- | --- |")
    lines += [
        f"| {_md_cell(t.name)} | {_md_cell(t.primary_artist)} | {t.popularity} | {t.id} |"
        for t in tracks
    ]
    return lines


def write_report(sections: list[Section], path, title: str = "Spotify 收藏報表") -> None:
    """把多個分節整理成單一 Markdown 報表寫到 path。"""
    lines = [f"# {title}", ""]
    for section_title, tracks in sections:
        lines += _section_lines(section_title, tracks)
        lines.append("")

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")

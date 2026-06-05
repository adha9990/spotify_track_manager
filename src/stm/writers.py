"""把歌曲清單輸出成 md / txt / csv / json 報表。"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from .models import Track

_FIELDS = ["id", "name", "artist", "isrc", "popularity", "is_playable", "added_at"]


def _row(track: Track) -> dict:
    return {
        "id": track.id,
        "name": track.name,
        "artist": track.primary_artist,
        "isrc": track.isrc,
        "popularity": track.popularity,
        "is_playable": track.is_playable,
        "added_at": track.added_at,
    }


def _write_txt(tracks: list[Track], path: Path, header: str) -> None:
    lines = [f"{header} (共 {len(tracks)} 首歌曲)"]
    lines += [
        f"  - {t.name} by {t.primary_artist} (ID: {t.id})" for t in tracks
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _md_cell(text: str) -> str:
    # 跳脫 | 以免破壞 Markdown 表格欄位
    return str(text).replace("|", r"\|")


def _write_md(tracks: list[Track], path: Path, header: str) -> None:
    lines = [f"# {header}", "", f"共 {len(tracks)} 首歌曲", ""]
    lines.append("| 歌名 | 歌手 | 人氣 | ID |")
    lines.append("| --- | --- | --- | --- |")
    lines += [
        f"| {_md_cell(t.name)} | {_md_cell(t.primary_artist)} | {t.popularity} | {t.id} |"
        for t in tracks
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_csv(tracks: list[Track], path: Path, _header: str) -> None:
    # header 文字不適用於 CSV 表格(欄位列即標頭),刻意忽略
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=_FIELDS)
        writer.writeheader()
        writer.writerows(_row(t) for t in tracks)


def _write_json(tracks: list[Track], path: Path, _header: str) -> None:
    # header 文字不適用於 JSON 陣列輸出,刻意忽略
    path.write_text(
        json.dumps([_row(t) for t in tracks], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


_WRITERS = {
    "md": _write_md,
    "txt": _write_txt,
    "csv": _write_csv,
    "json": _write_json,
}


def write_tracks(tracks: list[Track], path, fmt: str = "md", header: str = "") -> None:
    """將 tracks 寫到 path,fmt 可為 md / txt / csv / json。"""
    try:
        writer = _WRITERS[fmt]
    except KeyError:
        raise ValueError(f"未知的輸出格式 {fmt!r},可用:{', '.join(_WRITERS)}") from None

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    writer(tracks, path, header)

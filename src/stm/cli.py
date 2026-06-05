"""Typer CLI:scan(掃描出報表)與 dedupe(安全去重)。

orchestration 層——只負責把各層接起來、呈現結果、把關刪除確認;
真正的邏輯都在 detect / dedupe / fetch / writers 裡且已被單元測試。
"""

from __future__ import annotations

import logging
from enum import Enum
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from . import detect, fetch, writers
from .client import create_client
from .config import Settings
from .dedupe import execute_deletions, plan_deletions
from .models import Track

app = typer.Typer(help="掃描並清理 Spotify 收藏中的重複與失效歌曲", no_args_is_help=True)
console = Console()
log = logging.getLogger("stm")


class KeepStrategy(str, Enum):
    popularity = "popularity"
    oldest = "oldest"


_KEEP_DESCRIPTION = {
    KeepStrategy.popularity: "人氣最高者",
    KeepStrategy.oldest: "最早收藏者",
}


class OutputFormat(str, Enum):
    md = "md"
    txt = "txt"
    csv = "csv"
    json = "json"


def _load_client():
    """建立已授權的 client(獨立函式以便測試時注入假物件)。"""
    return create_client(Settings())


def _fetch_tracks(client, playlist: str | None) -> list[Track]:
    if playlist:
        return fetch.fetch_playlist_tracks(client, playlist)
    return fetch.fetch_saved_tracks(client)


def _flatten(groups: list[list[Track]]) -> list[Track]:
    return [track for group in groups for track in group]


# --- scan --------------------------------------------------------------------

_PlaylistOption = typer.Option(
    None, "--playlist", "-p", help="改為掃描指定 playlist(預設為「我的最愛」)"
)


@app.command()
def scan(
    playlist: str = _PlaylistOption,
    fmt: OutputFormat = typer.Option(OutputFormat.md, "--format", "-f", help="輸出格式"),
    output_dir: Path = typer.Option(
        Path("output"), "--output-dir", "-o", envvar="OUTPUT_DIR", help="報表輸出目錄"
    ),
):
    """掃描歌曲,輸出各類報表(不刪除任何東西)。"""
    client = _load_client()
    tracks = _fetch_tracks(client, playlist)
    console.print(f"共取得 [bold]{len(tracks)}[/] 首歌曲")

    confident = detect.find_confident_duplicates(tracks)
    name_only = detect.find_name_only_duplicates(tracks)
    fuzzy = detect.find_fuzzy_duplicates(tracks)
    unplayable = detect.find_unplayable(tracks)

    ext = fmt.value
    reports = [
        ("所有歌曲", tracks, f"all_tracks.{ext}"),
        ("可信重複(同名同歌手 / 同 ISRC)", _flatten(confident), f"duplicate_confident.{ext}"),
        ("同名不同歌手", _flatten(name_only), f"duplicate_name_only.{ext}"),
        ("疑似重複(模糊比對,僅供檢視)", _flatten(fuzzy), f"duplicate_fuzzy.{ext}"),
        ("已失效歌曲", unplayable, f"unplayable.{ext}"),
    ]

    table = Table(title="掃描結果")
    table.add_column("類別")
    table.add_column("數量", justify="right")
    for header, items, filename in reports:
        writers.write_tracks(items, output_dir / filename, fmt=ext, header=header)
        table.add_row(header, str(len(items)))
    console.print(table)
    console.print(f"報表已寫入 [bold]{output_dir}[/]")


# --- dedupe ------------------------------------------------------------------


@app.command()
def dedupe(
    playlist: str = _PlaylistOption,
    keep: KeepStrategy = typer.Option(
        KeepStrategy.popularity, "--keep", "-k", help="同組重複保留哪一首"
    ),
    apply: bool = typer.Option(
        False, "--apply", help="實際執行刪除(預設僅 dry-run 預覽)"
    ),
    yes: bool = typer.Option(False, "--yes", "-y", help="略過刪除前的互動確認"),
    max_deletions: int = typer.Option(
        100, "--max-deletions", help="安全上限:刪除數量超過此值即中止(避免偵測回歸造成大量誤刪)"
    ),
):
    """找出可信重複歌曲並去重(預設 dry-run,--apply 才刪除)。"""
    client = _load_client()
    tracks = _fetch_tracks(client, playlist)
    groups = detect.find_confident_duplicates(tracks)
    plan = plan_deletions(groups, keep=keep.value)

    if plan.is_empty:
        console.print("[green]沒有找到可信重複歌曲,無需處理。[/]")
        return

    _print_plan(plan)
    console.print(
        f"共 [bold]{len(plan.resolutions)}[/] 組重複,將刪除 "
        f"[bold red]{len(plan.delete_ids)}[/] 首、保留每組{_KEEP_DESCRIPTION[keep]}。"
    )

    if not apply:
        console.print("[yellow]dry-run 預覽模式,未刪除任何歌曲。加上 --apply 才會實際刪除。[/]")
        return

    if len(plan.delete_ids) > max_deletions:
        console.print(
            f"[red]將刪除 {len(plan.delete_ids)} 首,超過安全上限 {max_deletions},已中止。"
            f"確認無誤可加大 --max-deletions。[/]"
        )
        raise typer.Exit(1)

    if not yes and not typer.confirm(f"確定要刪除 {len(plan.delete_ids)} 首歌曲?"):
        console.print("已取消,未刪除任何歌曲。")
        return

    count = execute_deletions(client, plan)
    console.print(f"[green]已刪除 {count} 首重複歌曲。[/]")


def _print_plan(plan) -> None:
    table = Table(title="去重計畫(每組保留一首)")
    table.add_column("保留", style="green")
    table.add_column("人氣", justify="right")
    table.add_column("刪除", style="red")
    for res in plan.resolutions:
        removed = ", ".join(f"{t.name} ({t.popularity})" for t in res.remove)
        table.add_row(
            f"{res.keep.name} — {res.keep.primary_artist}",
            str(res.keep.popularity),
            removed,
        )
    console.print(table)


if __name__ == "__main__":
    app()

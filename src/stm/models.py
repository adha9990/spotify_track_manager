"""把 Spotify API 回傳的巢狀 dict 正規化成型別安全的值物件。

集中在這裡用 ``.get()`` 取欄位,避免散落各處的 ``track["..."]`` 在欄位缺失時 KeyError。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Track:
    """一首歌的不可變快照。"""

    id: str
    name: str
    artists: tuple[str, ...]
    isrc: str | None
    popularity: int
    is_playable: bool
    added_at: str | None
    album: str = ""
    album_id: str = ""
    release_date: str | None = None
    duration_ms: int = 0

    @property
    def primary_artist(self) -> str:
        """主要歌手(用於分組 / 去重),取第一位。"""
        return self.artists[0] if self.artists else ""

    @property
    def display_artists(self) -> str:
        """顯示用:所有合唱歌手,以逗號相連。"""
        return ", ".join(self.artists)

    @classmethod
    def from_item(cls, item: dict) -> Track:
        """從 saved-tracks / playlist 端點的 item 包裝({added_at, track})建立。"""
        track = item.get("track") or {}
        external_ids = track.get("external_ids") or {}
        album = track.get("album") or {}
        return cls(
            id=track.get("id"),
            name=track.get("name", ""),
            artists=tuple(a["name"] for a in track.get("artists", [])),
            isrc=external_ids.get("isrc"),
            popularity=track.get("popularity", 0),
            # 欄位缺失代表 API 未提供(未帶 market),視為可播放而非失效
            is_playable=track.get("is_playable", True),
            added_at=item.get("added_at"),
            album=album.get("name", ""),
            album_id=album.get("id", ""),
            release_date=album.get("release_date"),
            duration_ms=track.get("duration_ms", 0),
        )

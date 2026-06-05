"""Spotify API 整合:把 spotipy 收斂成本工具需要的最小介面。

把 spotipy 的呼叫集中在這個薄包裝,讓 fetch / dedupe 只依賴穩定的介面,
測試時可塞假物件取代真網路。
"""

from __future__ import annotations

import spotipy
from spotipy.oauth2 import SpotifyOAuth

from .config import Settings

# 帶 market 才會在回傳中包含 is_playable 欄位;from_token 代表使用者所在市場
_MARKET = "from_token"
_PAGE_SIZE = 50


class SpotifyClient:
    """fetch / dedupe 所依賴的最小 Spotify 介面。"""

    def __init__(self, sp: spotipy.Spotify):
        self._sp = sp

    def saved_tracks_page(self) -> dict:
        return self._sp.current_user_saved_tracks(limit=_PAGE_SIZE, market=_MARKET)

    def playlist_page(self, playlist_id: str) -> dict:
        return self._sp.playlist_items(
            playlist_id,
            limit=_PAGE_SIZE,
            market=_MARKET,
            additional_types=("track",),
        )

    def next_page(self, page: dict) -> dict | None:
        return self._sp.next(page)

    def remove_saved_tracks(self, ids: list[str]) -> None:
        self._sp.current_user_saved_tracks_delete(tracks=ids)

    def add_saved_tracks(self, ids: list[str]) -> None:
        self._sp.current_user_saved_tracks_add(tracks=ids)

    def search_tracks(self, query: str, limit: int = 8) -> list[dict]:
        """搜尋歌曲,回傳精簡結果 [{id, name, artist, album}]。"""
        res = self._sp.search(q=query, type="track", limit=limit)
        items = (res.get("tracks") or {}).get("items") or []
        return [
            {
                "id": t.get("id"),
                "name": t.get("name", ""),
                "artist": t["artists"][0]["name"] if t.get("artists") else "",
                "album": (t.get("album") or {}).get("name", ""),
            }
            for t in items
            if t.get("id")
        ]

    def start_playback(self, track_id: str) -> None:
        """在使用者的播放裝置上開始播放指定歌曲(需 Premium)。

        優先選 active 裝置;若無(例如 app 開著但閒置),退而選第一個可用裝置並
        明確指定 device_id 轉移播放;完全沒有可用裝置才報錯。
        """
        device_id = self._target_device()
        self._sp.start_playback(device_id=device_id, uris=[f"spotify:track:{track_id}"])

    def _target_device(self) -> str:
        devices = self._sp.devices().get("devices", [])
        if not devices:
            raise RuntimeError("NO_ACTIVE_DEVICE: 找不到可用的 Spotify 播放裝置")
        active = next((d for d in devices if d.get("is_active")), None)
        return (active or devices[0])["id"]


def create_client(settings: Settings) -> SpotifyClient:
    """依設定建立已授權的 SpotifyClient(惰性,import 本模組不會觸發授權)。"""
    auth_manager = SpotifyOAuth(
        client_id=settings.client_id,
        client_secret=settings.client_secret,
        redirect_uri=settings.redirect_uri,
        scope=settings.scope,
    )
    return SpotifyClient(spotipy.Spotify(auth_manager=auth_manager))

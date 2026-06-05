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


def create_client(settings: Settings) -> SpotifyClient:
    """依設定建立已授權的 SpotifyClient(惰性,import 本模組不會觸發授權)。"""
    auth_manager = SpotifyOAuth(
        client_id=settings.client_id,
        client_secret=settings.client_secret,
        redirect_uri=settings.redirect_uri,
        scope=settings.scope,
    )
    return SpotifyClient(spotipy.Spotify(auth_manager=auth_manager))

"""SpotifyClient 委派行為測試(以假 spotipy 物件驗證呼叫正確的方法與參數)。"""

import pytest

from stm.client import SpotifyClient


class FakeSpotipy:
    def __init__(self, devices=None):
        self.calls = []
        # 預設一台 active 裝置,讓非播放測試不受影響
        self._devices = devices if devices is not None else [{"id": "d0", "is_active": True}]

    def devices(self):
        return {"devices": self._devices}

    def current_user_saved_tracks(self, **kwargs):
        self.calls.append(("saved", kwargs))
        return {"items": [], "next": None}

    def playlist_items(self, playlist_id, **kwargs):
        self.calls.append(("playlist", playlist_id, kwargs))
        return {"items": [], "next": None}

    def next(self, page):
        self.calls.append(("next", page))
        return None

    def current_user_saved_tracks_delete(self, tracks):
        self.calls.append(("delete", tracks))

    def current_user_saved_tracks_add(self, tracks):
        self.calls.append(("add", tracks))

    def start_playback(self, **kwargs):
        self.calls.append(("play", kwargs))

    def search(self, q, type, limit):
        self.calls.append(("search", q, type, limit))
        return {"tracks": {"items": [
            {"id": "r1", "name": "Song", "artists": [{"name": "A"}], "album": {"name": "Alb"}},
        ]}}


def test_saved_tracks_page_requests_market_for_is_playable():
    sp = FakeSpotipy()
    SpotifyClient(sp).saved_tracks_page()
    name, kwargs = sp.calls[0][0], sp.calls[0][1]
    assert name == "saved"
    # 必須帶 market,is_playable 欄位才會回傳
    assert "market" in kwargs


def test_remove_saved_tracks_delegates_with_track_ids():
    sp = FakeSpotipy()
    SpotifyClient(sp).remove_saved_tracks(["a", "b"])
    assert ("delete", ["a", "b"]) in sp.calls


def test_next_page_delegates():
    sp = FakeSpotipy()
    SpotifyClient(sp).next_page({"next": "url"})
    assert sp.calls[0][0] == "next"


def test_search_tracks_returns_simplified_results():
    sp = FakeSpotipy()
    results = SpotifyClient(sp).search_tracks("Song A")
    assert results == [{"id": "r1", "name": "Song", "artist": "A", "album": "Alb"}]
    assert sp.calls[0][0] == "search"


def test_add_saved_tracks_delegates_with_ids():
    sp = FakeSpotipy()
    SpotifyClient(sp).add_saved_tracks(["a", "b"])
    assert ("add", ["a", "b"]) in sp.calls


def test_start_playback_targets_active_device():
    sp = FakeSpotipy(devices=[{"id": "idle", "is_active": False}, {"id": "live", "is_active": True}])
    SpotifyClient(sp).start_playback("abc")
    assert ("play", {"device_id": "live", "uris": ["spotify:track:abc"]}) in sp.calls


def test_start_playback_falls_back_to_first_available_device():
    # 開著但閒置的 app 不是 active,仍應被選中並轉移播放
    sp = FakeSpotipy(devices=[{"id": "idle", "is_active": False}])
    SpotifyClient(sp).start_playback("abc")
    assert ("play", {"device_id": "idle", "uris": ["spotify:track:abc"]}) in sp.calls


def test_start_playback_without_any_device_raises_no_active_device():
    sp = FakeSpotipy(devices=[])
    with pytest.raises(Exception) as excinfo:
        SpotifyClient(sp).start_playback("abc")
    assert "NO_ACTIVE_DEVICE" in str(excinfo.value)

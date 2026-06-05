"""SpotifyClient 委派行為測試(以假 spotipy 物件驗證呼叫正確的方法與參數)。"""

from stm.client import SpotifyClient


class FakeSpotipy:
    def __init__(self):
        self.calls = []

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

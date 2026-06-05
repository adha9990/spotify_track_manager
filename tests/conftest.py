"""共用測試 fixtures:模擬 Spotify API 的歌曲資料結構。"""

import pytest


def make_raw_track(
    track_id="id1",
    name="Song",
    artists=("Artist A",),
    popularity=50,
    isrc=None,
    is_playable=None,
    album="Some Album",
    album_id="alb1",
    release_date="2020-01-01",
    duration_ms=200000,
):
    """產生一個模擬 Spotify API 回傳的 track dict。

    is_playable=None 模擬「API 未帶 market 參數」的情況——此時欄位不存在。
    """
    track = {
        "id": track_id,
        "name": name,
        "artists": [{"name": a} for a in artists],
        "popularity": popularity,
        "album": {"name": album, "id": album_id, "release_date": release_date},
        "duration_ms": duration_ms,
    }
    if isrc is not None:
        track["external_ids"] = {"isrc": isrc}
    if is_playable is not None:
        track["is_playable"] = is_playable
    return track


def make_saved_item(added_at="2020-01-01T00:00:00Z", **track_kwargs):
    """產生 saved-tracks / playlist 端點回傳的 item 包裝(含 added_at)。"""
    return {"added_at": added_at, "track": make_raw_track(**track_kwargs)}


@pytest.fixture
def saved_item():
    return make_saved_item()

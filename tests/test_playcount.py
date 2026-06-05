"""播放次數(非官方 Pathfinder)解析、TOTP 與容錯測試。

網路層(取 token、打 pathfinder)不在此測;這裡測純邏輯:TOTP 數學、回應解析、
以及 fetch_track_data 的分組 / 合併 / 容錯(以注入的 album_fetcher 取代真網路)。
"""

import base64

from stm.models import Track
from stm import playcount


def track(track_id, album_id="alb"):
    return Track(
        id=track_id, name="N", artists=("A",), isrc=None, popularity=0,
        is_playable=True, added_at=None, album_id=album_id,
    )


# --- TOTP 數學(RFC 6238 測試向量) -----------------------------------------


def test_totp_matches_rfc6238_vector():
    # RFC 6238 SHA1 向量:secret "12345678901234567890",T=59s → 94287082 → 6 碼 287082
    secret_b32 = base64.b32encode(b"12345678901234567890").decode()
    assert playcount._totp_at(secret_b32, 59) == "287082"


def test_totp_secret_is_stable_nonempty_base32():
    cipher = [44, 55, 47, 42, 70, 40]
    s1 = playcount._totp_secret(cipher)
    s2 = playcount._totp_secret(cipher)
    assert s1 == s2 and s1  # 確定性、非空


def test_latest_secret_picks_highest_version():
    payload = {"59": [1, 2], "61": [9, 9], "60": [3, 3]}
    ver, cipher = playcount._latest_secret(payload)
    assert ver == 61
    assert cipher == [9, 9]


# --- album 回應解析(playcount + 本地化歌名/歌手/專輯) ----------------------


def _album_payload(tracks, album_name="專輯"):
    items = [
        {"track": {
            "uri": f"spotify:track:{tid}", "playcount": pc, "name": name,
            "artists": {"items": [{"profile": {"name": a}} for a in artists]},
        }}
        for tid, pc, name, artists in tracks
    ]
    return {"data": {"album": {"name": album_name, "tracks": {"items": items}}}}


def test_parse_album_extracts_playcount_and_localized_names():
    payload = _album_payload([("t1", "12345", "天下", ["張杰"])], album_name="專輯名")
    assert playcount._parse_album(payload) == {
        "t1": {"playcount": 12345, "name": "天下", "artists": ["張杰"], "album": "專輯名"},
    }


def test_parse_album_playcount_none_when_missing():
    payload = _album_payload([("t1", None, "N", ["A"])])
    assert playcount._parse_album(payload)["t1"]["playcount"] is None


def test_parse_album_handles_empty_payload():
    assert playcount._parse_album({}) == {}


# --- fetch_track_data 編排(注入 album_fetcher) -----------------------------


def test_fetch_track_data_groups_by_album_and_merges():
    tracks = [track("a", "alb1"), track("b", "alb1"), track("c", "alb2")]
    data = {
        "alb1": {"a": {"playcount": 10}, "b": {"playcount": 20}},
        "alb2": {"c": {"playcount": 30}},
    }
    result = playcount.fetch_track_data(tracks, album_fetcher=lambda aid: data[aid])
    assert result["a"]["playcount"] == 10 and result["c"]["playcount"] == 30


def test_fetch_track_data_is_fault_tolerant():
    tracks = [track("a", "ok"), track("b", "bad")]

    def fetcher(aid):
        if aid == "bad":
            raise RuntimeError("hash 失效")
        return {"a": {"playcount": 5}}

    assert playcount.fetch_track_data(tracks, album_fetcher=fetcher) == {"a": {"playcount": 5}}


def test_fetch_track_data_skips_tracks_without_album_id():
    tracks = [track("a", ""), track("b", "alb1")]
    seen = []
    playcount.fetch_track_data(tracks, album_fetcher=lambda aid: seen.append(aid) or {})
    assert seen == ["alb1"]


def test_fetch_track_data_without_sp_dc_returns_empty():
    assert playcount.fetch_track_data([track("a")], sp_dc=None) == {}

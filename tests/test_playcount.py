"""播放次數(非官方 Pathfinder)解析、TOTP 與容錯測試。

網路層(取 token、打 pathfinder)不在此測;這裡測純邏輯:TOTP 數學、回應解析、
以及 fetch_playcounts 的分組 / 合併 / 容錯(以注入的 album_fetcher 取代真網路)。
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
    s1 = playcount._totp_secret()
    s2 = playcount._totp_secret()
    assert s1 == s2 and s1  # 確定性、非空


# --- album 回應解析 ----------------------------------------------------------


def _album_payload(pairs):
    items = [
        {"track": {"uri": f"spotify:track:{tid}", "playcount": pc}} for tid, pc in pairs
    ]
    return {"data": {"album": {"tracks": {"items": items}}}}


def test_parse_album_extracts_playcounts():
    payload = _album_payload([("t1", "12345"), ("t2", 678)])
    assert playcount._parse_album(payload) == {"t1": 12345, "t2": 678}


def test_parse_album_skips_missing_or_bad_playcount():
    payload = {
        "data": {"album": {"tracks": {"items": [
            {"track": {"uri": "spotify:track:t1", "playcount": None}},
            {"track": {"uri": "spotify:track:t2"}},
            {"track": {"uri": "spotify:track:t3", "playcount": "999"}},
        ]}}}
    }
    assert playcount._parse_album(payload) == {"t3": 999}


def test_parse_album_handles_empty_payload():
    assert playcount._parse_album({}) == {}


# --- fetch_playcounts 編排(注入 album_fetcher) ------------------------------


def test_fetch_playcounts_groups_by_album_and_merges():
    tracks = [track("a", "alb1"), track("b", "alb1"), track("c", "alb2")]
    data = {"alb1": {"a": 10, "b": 20}, "alb2": {"c": 30}}
    result = playcount.fetch_playcounts(tracks, album_fetcher=lambda aid: data[aid])
    assert result == {"a": 10, "b": 20, "c": 30}


def test_fetch_playcounts_is_fault_tolerant():
    tracks = [track("a", "ok"), track("b", "bad")]

    def fetcher(aid):
        if aid == "bad":
            raise RuntimeError("hash 失效")
        return {"a": 5}

    assert playcount.fetch_playcounts(tracks, album_fetcher=fetcher) == {"a": 5}


def test_fetch_playcounts_skips_tracks_without_album_id():
    tracks = [track("a", ""), track("b", "alb1")]
    seen = []
    playcount.fetch_playcounts(tracks, album_fetcher=lambda aid: seen.append(aid) or {})
    assert seen == ["alb1"]


def test_fetch_playcounts_without_sp_dc_returns_empty():
    assert playcount.fetch_playcounts([track("a")], sp_dc=None) == {}

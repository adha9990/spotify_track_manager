"""非官方播放次數:走 Spotify 網頁播放器的內部 Pathfinder GraphQL API。

官方 Web API 不提供播放次數,此模組用 sp_dc cookie + TOTP 取得 web player token,
再按專輯批次查 playcount。**本質脆弱**:下面的 secret cipher 與 query hash 會被
Spotify 輪換,屆時整欄容錯留白,不影響其他功能。需更新時改下方常數即可。

來源:reverse-engineered 自 Spotify 網頁播放器(misiektoja/spotify_monitor、
entriphy/sp-playcount 等社群實作),2025 起 get token 需 TOTP。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import struct
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime

import requests

from .models import Track

# --- 可替換常數(Spotify 輪換時更新這裡) -----------------------------------
# TOTP secret cipher,版本 -> bytes;沿用社群目前可用的版本
_SECRET_CIPHER = {
    14: [62, 54, 109, 83, 107, 77, 41, 103, 45, 93, 114, 38, 41, 97, 64, 51, 95, 94, 95, 94],
}
_TOTP_VER = 14
# queryAlbumTracks 的 persisted-query hash
_ALBUM_QUERY_HASH = "3ea563e1d68f486d8df30f69de9dcedae74c77e684b889ba7408c589d30f7f2e"
_PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v1/query"
_TOKEN_URL = "https://open.spotify.com/api/token"
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
_ALBUM_LIMIT = 300
_MAX_WORKERS = 8


# --- TOTP(純函式,可用 RFC 6238 向量驗證) --------------------------------


def _totp_secret(version: int = _TOTP_VER) -> str:
    cipher = _SECRET_CIPHER[version]
    transformed = [e ^ ((t % 33) + 9) for t, e in enumerate(cipher)]
    joined = "".join(str(n) for n in transformed)
    hex_str = joined.encode().hex()
    return base64.b32encode(bytes.fromhex(hex_str)).decode().rstrip("=")


def _totp_at(secret_b32: str, for_time: float, interval: int = 30) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    counter = int(for_time) // interval
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


# --- 回應解析(純函式) ------------------------------------------------------


def _parse_album(payload: dict) -> dict[str, int]:
    album = (payload.get("data") or {}).get("album") or {}
    items = (album.get("tracks") or {}).get("items") or []
    result: dict[str, int] = {}
    for item in items:
        track = item.get("track") or {}
        uri = track.get("uri") or ""
        pc = track.get("playcount")
        if not uri or pc is None:
            continue
        try:
            result[uri.split(":")[-1]] = int(pc)
        except (TypeError, ValueError):
            continue
    return result


# --- 網路層(薄,實機驗證;失敗一律往上由容錯接住) -------------------------


def _server_time(session: requests.Session) -> float:
    res = session.get("https://open.spotify.com/", timeout=10)
    return parsedate_to_datetime(res.headers["Date"]).timestamp()


def _get_token(sp_dc: str) -> str:
    session = requests.Session()
    otp = _totp_at(_totp_secret(), _server_time(session))
    params = {
        "reason": "transport",
        "productType": "web-player",
        "totp": otp,
        "totpServer": otp,
        "totpVer": _TOTP_VER,
    }
    headers = {
        "User-Agent": _UA,
        "Accept": "application/json",
        "Referer": "https://open.spotify.com/",
        "App-Platform": "WebPlayer",
        "Cookie": f"sp_dc={sp_dc}",
    }
    res = session.get(_TOKEN_URL, params=params, headers=headers, timeout=10)
    res.raise_for_status()
    return res.json()["accessToken"]


def _fetch_album(token: str, album_id: str) -> dict[str, int]:
    params = {
        "operationName": "queryAlbumTracks",
        "variables": json.dumps(
            {"uri": f"spotify:album:{album_id}", "offset": 0, "limit": _ALBUM_LIMIT}
        ),
        "extensions": json.dumps(
            {"persistedQuery": {"version": 1, "sha256Hash": _ALBUM_QUERY_HASH}}
        ),
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "App-Platform": "WebPlayer",
        "User-Agent": _UA,
    }
    res = requests.get(_PATHFINDER_URL, params=params, headers=headers, timeout=10)
    res.raise_for_status()
    return _parse_album(res.json())


# --- 編排(分組 / 並行 / 容錯) ---------------------------------------------


def fetch_playcounts(tracks: list[Track], sp_dc: str | None = None, album_fetcher=None) -> dict[str, int]:
    """回傳 {track_id: playcount};抓不到的歌就不在 dict 裡(由呼叫端顯示為未知)。

    album_fetcher(album_id)->{track_id:int} 可注入(測試用);預設用真網路。
    任一專輯失敗都不影響其他;完全失敗則回傳空 dict。
    """
    if album_fetcher is None:
        if not sp_dc:
            return {}
        try:
            token = _get_token(sp_dc)
        except Exception:  # noqa: BLE001 — token 取得失敗即整體略過
            return {}
        album_fetcher = lambda aid: _fetch_album(token, aid)  # noqa: E731

    album_ids = sorted({t.album_id for t in tracks if t.album_id})

    def safe(album_id: str) -> dict[str, int]:
        try:
            return album_fetcher(album_id)
        except Exception:  # noqa: BLE001 — 單張失敗不影響其他
            return {}

    result: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        for partial in executor.map(safe, album_ids):
            result.update(partial)
    return result

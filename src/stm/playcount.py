"""用 cookie 走 Spotify 網頁播放器的內部 Pathfinder GraphQL API,取「跟 app 一致」的資料。

官方 Web API 不給播放次數,且部分歌手只給英文/羅馬正規名(如 張杰→Jason Zhang)。
此模組用 sp_dc cookie + TOTP 取得 web player token,按專輯批次查,一次拿到每首歌的
**播放次數 + 本地化(中文)歌名/歌手/專輯**(靠 Accept-Language)。**本質脆弱**:下方的
secret cipher 與 query hash 會被 Spotify 輪換(secret 已改成執行時自動抓最新),失效時
呼叫端降位用官方 API 資料,不影響其他功能。

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

# TOTP secret 每幾天就被 Spotify 輪換,故執行時從這個每小時自動更新的來源抓最新版本;
# 抓不到才退回下面的 fallback(也會過期,屆時靠上面的 URL 自動跟上)。
_SECRET_URL = "https://raw.githubusercontent.com/xyloflake/spot-secrets-go/main/secrets/secretDict.json"
_FALLBACK_VER = 61
_FALLBACK_CIPHER = [
    44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43, 69,
    49, 120, 118, 80, 64, 78,
]
# queryAlbumTracks 的 persisted-query hash
_ALBUM_QUERY_HASH = "3ea563e1d68f486d8df30f69de9dcedae74c77e684b889ba7408c589d30f7f2e"
_PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v1/query"
_TOKEN_URL = "https://open.spotify.com/api/token"
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
_ALBUM_LIMIT = 300
_MAX_WORKERS = 8


# --- TOTP(純函式,可用 RFC 6238 向量驗證) --------------------------------


def _totp_secret(cipher: list[int]) -> str:
    transformed = [e ^ ((t % 33) + 9) for t, e in enumerate(cipher)]
    joined = "".join(str(n) for n in transformed)
    hex_str = joined.encode().hex()
    return base64.b32encode(bytes.fromhex(hex_str)).decode().rstrip("=")


def _latest_secret(payload: dict) -> tuple[int, list[int]]:
    """從 {version: cipher} 取最高版本。"""
    ver = max(int(k) for k in payload)
    return ver, payload[str(ver)]


def _load_secret() -> tuple[int, list[int]]:
    """抓最新 TOTP secret(版本, cipher);失敗則退回內建 fallback。"""
    try:
        res = requests.get(_SECRET_URL, timeout=10)
        res.raise_for_status()
        return _latest_secret(res.json())
    except Exception:  # noqa: BLE001 — 抓不到就用 fallback
        return _FALLBACK_VER, _FALLBACK_CIPHER


def _totp_at(secret_b32: str, for_time: float, interval: int = 30) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    counter = int(for_time) // interval
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


# --- 回應解析(純函式) ------------------------------------------------------


def _as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_album(payload: dict) -> dict[str, dict]:
    """從 queryAlbumTracks 回應抽出每首歌的 playcount + 本地化歌名/歌手/專輯。

    回傳 {track_id: {"playcount": int|None, "name": str, "artists": [str], "album": str}}。
    """
    album = (payload.get("data") or {}).get("album") or {}
    album_name = album.get("name")
    items = (album.get("tracks") or {}).get("items") or []
    result: dict[str, dict] = {}
    for item in items:
        track = item.get("track") or {}
        uri = track.get("uri") or ""
        if not uri:
            continue
        artists = [
            a["profile"]["name"]
            for a in (track.get("artists") or {}).get("items", [])
            if (a.get("profile") or {}).get("name")
        ]
        result[uri.split(":")[-1]] = {
            "playcount": _as_int(track.get("playcount")),
            "name": track.get("name"),
            "artists": artists,
            "album": album_name,
        }
    return result


# --- 網路層(薄,實機驗證;失敗一律往上由容錯接住) -------------------------


def _server_time(session: requests.Session) -> float:
    res = session.get("https://open.spotify.com/", timeout=10)
    return parsedate_to_datetime(res.headers["Date"]).timestamp()


def _get_token(sp_dc: str) -> str:
    session = requests.Session()
    ver, cipher = _load_secret()
    otp = _totp_at(_totp_secret(cipher), _server_time(session))
    params = {
        "reason": "transport",
        "productType": "web-player",
        "totp": otp,
        "totpServer": otp,
        "totpVer": ver,
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


def _fetch_album(token: str, album_id: str, locale: str = "zh-TW") -> dict[str, dict]:
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
        "Accept-Language": locale,  # 取本地化(中文)歌名 / 歌手,與 app 一致
    }
    res = requests.get(_PATHFINDER_URL, params=params, headers=headers, timeout=10)
    res.raise_for_status()
    return _parse_album(res.json())


# --- 編排(分組 / 並行 / 容錯) ---------------------------------------------


def fetch_track_data(
    tracks: list[Track], sp_dc: str | None = None, locale: str = "zh-TW", album_fetcher=None
) -> dict[str, dict]:
    """用 cookie/Pathfinder 一次取每首歌的 playcount + 本地化歌名/歌手/專輯。

    回傳 {track_id: {"playcount", "name", "artists", "album"}};抓不到的歌不在 dict 裡。
    cookie/token 失效或單張失敗都容錯(回空或略過該張),呼叫端再降位用官方 API 資料。
    album_fetcher(album_id)->{track_id: {...}} 可注入(測試用)。
    """
    if album_fetcher is None:
        if not sp_dc:
            return {}
        try:
            token = _get_token(sp_dc)
        except Exception:  # noqa: BLE001 — token 取得失敗即整體略過
            return {}
        album_fetcher = lambda aid: _fetch_album(token, aid, locale)  # noqa: E731

    album_ids = sorted({t.album_id for t in tracks if t.album_id})

    def safe(album_id: str) -> dict[str, dict]:
        try:
            return album_fetcher(album_id)
        except Exception:  # noqa: BLE001 — 單張失敗不影響其他
            return {}

    result: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        for partial in executor.map(safe, album_ids):
            result.update(partial)
    return result

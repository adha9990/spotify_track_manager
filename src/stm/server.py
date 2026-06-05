"""本機互動式網頁伺服器:承載已授權 client,讓頁面按鈕真的能播放/刪除。

僅綁 127.0.0.1;所有 /api/* 端點需帶啟動時產生的 session token(擋本機 CSRF)。
"""

from __future__ import annotations

import dataclasses
import secrets
import webbrowser

from flask import Flask, jsonify, request

from . import detect, fetch, playcount, webpage
from .client import create_client
from .config import Settings
from .dedupe import plan_deletions
from .history import History
from .models import Track


def _friendly_play_error(exc: Exception) -> str:
    msg = str(exc)
    lowered = msg.lower()
    if "no_active_device" in lowered or "no active device" in lowered:
        return "請先在 Spotify 開啟播放裝置(手機 / 桌面 app)"
    if "premium" in lowered:
        return "此操作需要 Spotify Premium"
    return msg


def create_app(
    client,
    page_html: str,
    token: str,
    history: History | None = None,
    tracks_by_id: dict[str, dict] | None = None,
) -> Flask:
    """建立 Flask app;client 持有 Spotify 操作,page_html 為已產好的頁面。

    history 記錄每筆 add/delete 以供復原;tracks_by_id 用來補記錄裡的歌名/歌手。
    """
    history = history or History()
    tracks_by_id = tracks_by_id or {}
    app = Flask(__name__)

    def _authed() -> bool:
        return request.headers.get("X-Token") == token

    def _record(action: str, ids: list[str]) -> None:
        history.record(action, [{"id": i, **tracks_by_id.get(i, {})} for i in ids])

    @app.get("/")
    def index():
        return page_html

    @app.get("/health")
    def health():
        # 給前端心跳輪詢用,純存活檢查,不需 token
        return jsonify(ok=True)

    @app.post("/api/play")
    def play():
        if not _authed():
            return jsonify(error="invalid token"), 403
        track_id = (request.get_json(silent=True) or {}).get("track_id")
        if not track_id:
            return jsonify(error="missing track_id"), 400
        try:
            client.start_playback(track_id)
        except Exception as exc:  # noqa: BLE001 — 對外回傳友善訊息,不外洩堆疊
            return jsonify(error=_friendly_play_error(exc)), 409
        return jsonify(ok=True)

    @app.post("/api/delete")
    def delete():
        if not _authed():
            return jsonify(error="invalid token"), 403
        ids = (request.get_json(silent=True) or {}).get("track_ids") or []
        if not ids:
            return jsonify(error="missing track_ids"), 400
        try:
            client.remove_saved_tracks(ids)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 502
        _record("delete", ids)
        return jsonify(ok=True, deleted=len(ids))

    @app.post("/api/add")
    def add():
        if not _authed():
            return jsonify(error="invalid token"), 403
        ids = (request.get_json(silent=True) or {}).get("track_ids") or []
        if not ids:
            return jsonify(error="missing track_ids"), 400
        try:
            client.add_saved_tracks(ids)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 502
        _record("add", ids)
        return jsonify(ok=True, added=len(ids))

    @app.post("/api/search")
    def search():
        if not _authed():
            return jsonify(error="invalid token"), 403
        query = (request.get_json(silent=True) or {}).get("query", "").strip()
        if not query:
            return jsonify(error="missing query"), 400
        try:
            results = client.search_tracks(query)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 502
        return jsonify(results=results)

    @app.get("/api/history")
    def history_list():
        if not _authed():
            return jsonify(error="invalid token"), 403
        return jsonify(batches=history.list_batches())

    @app.post("/api/undo")
    def undo():
        if not _authed():
            return jsonify(error="invalid token"), 403
        batch_id = (request.get_json(silent=True) or {}).get("batch_id")
        if not batch_id:
            return jsonify(error="missing batch_id"), 400
        rows = history.batch_tracks(batch_id)
        # 反向:刪除→重新加入;加入→移除
        re_add = [r["track_id"] for r in rows if r["action"] == "delete"]
        re_remove = [r["track_id"] for r in rows if r["action"] == "add"]
        try:
            if re_add:
                client.add_saved_tracks(re_add)
            if re_remove:
                client.remove_saved_tracks(re_remove)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 502
        history.mark_undone(batch_id)
        return jsonify(ok=True, restored=len(rows))

    return app


def _fetch_tracks(client, playlist: str | None) -> list[Track]:
    if playlist:
        return fetch.fetch_playlist_tracks(client, playlist)
    return fetch.fetch_saved_tracks(client)


def _localize(track: Track, data: dict | None) -> Track:
    """用 Pathfinder 取得的本地化(中文)歌名/歌手/專輯覆寫;抓不到則保留官方。"""
    if not data:
        return track
    return dataclasses.replace(
        track,
        name=data.get("name") or track.name,
        artists=tuple(data.get("artists")) or track.artists,
        album=data.get("album") or track.album,
    )


def build_sections(tracks: list[Track]) -> list[webpage.Section]:
    """組出頁面分節;可信重複改由頂端「一鍵過濾」處理,故不再是 tab。"""
    def flatten(groups):
        return [t for group in groups for t in group]

    return [
        ("所有歌曲", tracks, None),
        ("同名不同歌手", flatten(detect.find_name_only_duplicates(tracks)), None),
        ("疑似重複(模糊比對,僅供檢視)", flatten(detect.find_fuzzy_duplicates(tracks)), None),
        ("已失效歌曲", detect.find_unplayable(tracks), None, True),  # 可找平替
    ]


def build_cleanup(tracks: list[Track]) -> list[dict]:
    """一鍵過濾清單:可信重複每組保留一首(優先可播放、再人氣最高),刪其餘。

    逐首標原因——失效版被刪且保留的是可播放版時標「已失效有替身」,其餘標「重複」。
    回傳 [{id, name, artist, reason}]。
    """
    items: list[dict] = []
    for group in detect.find_confident_duplicates(tracks):
        resolution = plan_deletions([group], keep="popularity").resolutions[0]
        keep = resolution.keep
        for t in resolution.remove:
            reason = (
                "已失效,且已有可播放的同名同歌手版本"
                if not t.is_playable and keep.is_playable
                else "重複(已保留同組人氣最高者)"
            )
            items.append(
                {"id": t.id, "name": t.name, "artist": t.display_artists, "reason": reason}
            )
    return items


def serve(
    playlist: str | None = None,
    port: int = 8765,
    open_browser: bool = True,
) -> None:
    """抓歌、建頁、啟動本機伺服器並開瀏覽器。"""
    settings = Settings()
    client = create_client(settings)
    tracks = _fetch_tracks(client, playlist)
    if settings.sp_dc:
        print("正在透過 cookie 取播放次數 + 本地化名稱(可能需數十秒;失敗則降位用官方資料)…")
    data = playcount.fetch_track_data(tracks, sp_dc=settings.sp_dc, locale=settings.locale)
    tracks = [_localize(t, data.get(t.id)) for t in tracks]  # 中文名覆寫,抓不到保留官方

    sections = build_sections(tracks)
    cleanup = build_cleanup(tracks)
    counts = {tid: d["playcount"] for tid, d in data.items() if d.get("playcount") is not None}
    token = secrets.token_urlsafe(16)
    page = webpage.render(sections, token, playcounts=counts, cleanup=cleanup)

    history = History("stm_history.db")
    tracks_by_id = {t.id: {"name": t.name, "artist": t.display_artists} for t in tracks}
    app = create_app(client, page, token, history=history, tracks_by_id=tracks_by_id)
    url = f"http://127.0.0.1:{port}"
    print(f"互動報表已啟動:{url}(按 Ctrl+C 結束)")
    if open_browser:
        webbrowser.open(url)
    app.run(host="127.0.0.1", port=port)

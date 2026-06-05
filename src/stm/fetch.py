"""抓取歌曲:走完 Spotify 分頁,把每個 item 正規化成 Track。"""

from __future__ import annotations

from .models import Track


def fetch_saved_tracks(client) -> list[Track]:
    """抓取使用者「我的最愛」(Liked Songs)全部歌曲。"""
    return _collect(client, client.saved_tracks_page())


def fetch_playlist_tracks(client, playlist_id: str) -> list[Track]:
    """抓取指定 playlist 的全部歌曲。"""
    return _collect(client, client.playlist_page(playlist_id))


def _collect(client, page) -> list[Track]:
    tracks: list[Track] = []
    while page:
        for item in page.get("items") or []:
            # playlist 中被下架的本機檔案會回傳 track=None,需略過
            if not item.get("track"):
                continue
            track = Track.from_item(item)
            # 缺 id 的歌曲(本機檔 / 異常資料)不可流入下游偵測與刪除
            if track.id:
                tracks.append(track)
        page = client.next_page(page) if page.get("next") else None
    return tracks

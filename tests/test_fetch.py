"""抓取與分頁邏輯測試(以假 client 取代真網路)。"""

from stm import fetch

from .conftest import make_saved_item


class FakePagedClient:
    """模擬 SpotifyClient 的分頁行為。"""

    def __init__(self, pages):
        self._pages = pages
        self._first = pages[0] if pages else {"items": [], "next": None}

    def saved_tracks_page(self):
        return self._first

    def playlist_page(self, playlist_id):
        return self._first

    def next_page(self, page):
        # 以身分(is)而非相等(==)定位,避免兩頁內容相同時 list.index 誤判
        for i, candidate in enumerate(self._pages):
            if candidate is page:
                return self._pages[i + 1]
        raise AssertionError("next_page 收到未知的 page 物件")


def make_page(items, has_next):
    return {"items": items, "next": "url" if has_next else None}


def test_fetch_saved_tracks_walks_all_pages():
    page2 = make_page([make_saved_item(track_id="3")], has_next=False)
    page1 = make_page(
        [make_saved_item(track_id="1"), make_saved_item(track_id="2")], has_next=True
    )
    client = FakePagedClient([page1, page2])

    tracks = fetch.fetch_saved_tracks(client)

    assert [t.id for t in tracks] == ["1", "2", "3"]


def test_fetch_skips_items_with_null_track():
    page = make_page(
        [make_saved_item(track_id="1"), {"added_at": "x", "track": None}],
        has_next=False,
    )
    client = FakePagedClient([page])

    tracks = fetch.fetch_saved_tracks(client)

    assert [t.id for t in tracks] == ["1"]


def test_fetch_skips_tracks_without_id():
    # 本機上傳檔 / 異常資料可能缺 id,不可流入下游(會污染 union-find 與刪除)
    page = make_page(
        [make_saved_item(track_id="1"), make_saved_item(track_id=None)],
        has_next=False,
    )
    client = FakePagedClient([page])

    tracks = fetch.fetch_saved_tracks(client)

    assert [t.id for t in tracks] == ["1"]


def test_fetch_handles_page_missing_items_key():
    # API 異常回應可能缺 items;應優雅停止而非 KeyError
    client = FakePagedClient([{"next": None}])

    tracks = fetch.fetch_saved_tracks(client)

    assert tracks == []


def test_fetch_playlist_tracks():
    page = make_page([make_saved_item(track_id="p1")], has_next=False)
    client = FakePagedClient([page])

    tracks = fetch.fetch_playlist_tracks(client, "playlist123")

    assert [t.id for t in tracks] == ["p1"]

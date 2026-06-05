"""Flask 路由測試(test client + 假 Spotify client,不碰真網路)。"""

import pytest

from stm.history import History
from stm.models import Track
from stm.server import build_cleanup, build_sections, create_app


def _t(track_id, name, artist, popularity=50, is_playable=True):
    return Track(
        id=track_id, name=name, artists=(artist,), isrc=None, popularity=popularity,
        is_playable=is_playable, added_at=None,
    )


class FakeClient:
    def __init__(self, play_error=None):
        self.removed = []
        self.added = []
        self.played = []
        self._play_error = play_error

    def remove_saved_tracks(self, ids):
        self.removed.append(list(ids))

    def add_saved_tracks(self, ids):
        self.added.append(list(ids))

    def search_tracks(self, query, limit=8):
        self.searched = query
        return [{"id": "r1", "name": "Song", "artist": "A", "album": "Alb"}]

    def start_playback(self, track_id):
        if self._play_error:
            raise self._play_error
        self.played.append(track_id)


def _app(client=None, token="tok"):
    return create_app(client or FakeClient(), "<html>page</html>", token)


@pytest.fixture
def client_pair():
    fake = FakeClient()
    app = create_app(fake, "<html>page</html>", "tok")
    return app.test_client(), fake


def _post(test_client, path, body, token="tok"):
    headers = {"X-Token": token} if token is not None else {}
    return test_client.post(path, json=body, headers=headers)


def test_index_serves_page():
    tc = _app().test_client()
    res = tc.get("/")
    assert res.status_code == 200
    assert b"page" in res.data


def test_health_needs_no_token():
    tc = _app().test_client()
    res = tc.get("/health")
    assert res.status_code == 200
    assert res.get_json()["ok"] is True


def test_delete_calls_remove_with_ids(client_pair):
    tc, fake = client_pair
    res = _post(tc, "/api/delete", {"track_ids": ["a", "b"]})
    assert res.status_code == 200
    assert fake.removed == [["a", "b"]]


def test_delete_without_token_is_403(client_pair):
    tc, fake = client_pair
    res = _post(tc, "/api/delete", {"track_ids": ["a"]}, token=None)
    assert res.status_code == 403
    assert fake.removed == []


def test_delete_wrong_token_is_403(client_pair):
    tc, fake = client_pair
    res = _post(tc, "/api/delete", {"track_ids": ["a"]}, token="nope")
    assert res.status_code == 403
    assert fake.removed == []


def test_delete_missing_ids_is_400(client_pair):
    tc, fake = client_pair
    res = _post(tc, "/api/delete", {"track_ids": []})
    assert res.status_code == 400
    assert fake.removed == []


def test_play_calls_start_playback(client_pair):
    tc, fake = client_pair
    res = _post(tc, "/api/play", {"track_id": "xyz"})
    assert res.status_code == 200
    assert fake.played == ["xyz"]


def test_play_without_token_is_403(client_pair):
    tc, fake = client_pair
    res = _post(tc, "/api/play", {"track_id": "xyz"}, token=None)
    assert res.status_code == 403
    assert fake.played == []


def test_play_missing_track_id_is_400(client_pair):
    tc, fake = client_pair
    res = _post(tc, "/api/play", {})
    assert res.status_code == 400


def test_delete_records_to_history():
    fake = FakeClient()
    hist = History(":memory:")
    app = create_app(
        fake, "<html>page</html>", "tok", history=hist,
        tracks_by_id={"a": {"name": "N", "artist": "X"}},
    )
    _post(app.test_client(), "/api/delete", {"track_ids": ["a"]})
    batches = hist.list_batches()
    assert len(batches) == 1
    assert batches[0]["action"] == "delete" and batches[0]["n"] == 1


def test_add_endpoint_adds_and_records():
    fake = FakeClient()
    hist = History(":memory:")
    tc = create_app(fake, "<html>page</html>", "tok", history=hist).test_client()
    res = _post(tc, "/api/add", {"track_ids": ["x"]})
    assert res.status_code == 200
    assert fake.added == [["x"]]
    assert hist.list_batches()[0]["action"] == "add"


def test_history_endpoint_returns_batches():
    hist = History(":memory:")
    hist.record("delete", [{"id": "a", "name": "N", "artist": "X"}])
    tc = create_app(FakeClient(), "<html>page</html>", "tok", history=hist).test_client()
    res = tc.get("/api/history", headers={"X-Token": "tok"})
    assert res.status_code == 200
    assert res.get_json()["batches"][0]["action"] == "delete"


def test_history_needs_token():
    tc = create_app(FakeClient(), "<html>page</html>", "tok").test_client()
    assert tc.get("/api/history").status_code == 403


def test_undo_delete_re_adds_tracks():
    fake = FakeClient()
    hist = History(":memory:")
    bid = hist.record("delete", [{"id": "a", "name": "N", "artist": "X"}])
    tc = create_app(fake, "<html>page</html>", "tok", history=hist).test_client()
    res = _post(tc, "/api/undo", {"batch_id": bid})
    assert res.status_code == 200
    assert fake.added == [["a"]]  # 復原刪除 = 重新加入
    assert hist.list_batches()[0]["undone"] == 1


def test_undo_add_removes_tracks():
    fake = FakeClient()
    hist = History(":memory:")
    bid = hist.record("add", [{"id": "a", "name": "N", "artist": "X"}])
    tc = create_app(fake, "<html>page</html>", "tok", history=hist).test_client()
    _post(tc, "/api/undo", {"batch_id": bid})
    assert fake.removed == [["a"]]  # 復原加入 = 移除
    assert hist.list_batches()[0]["undone"] == 1


def test_search_endpoint_returns_results():
    fake = FakeClient()
    tc = create_app(fake, "<html>page</html>", "tok").test_client()
    res = _post(tc, "/api/search", {"query": "Song A"})
    assert res.status_code == 200
    assert res.get_json()["results"][0]["id"] == "r1"
    assert fake.searched == "Song A"


def test_search_needs_token_and_query():
    tc = create_app(FakeClient(), "<html>page</html>", "tok").test_client()
    assert _post(tc, "/api/search", {"query": "x"}, token=None).status_code == 403
    assert _post(tc, "/api/search", {"query": ""}).status_code == 400


def test_build_sections_has_no_confident_tab():
    titles = [s[0] for s in build_sections([_t("a", "Song", "A")])]
    assert not any("可信重複" in t for t in titles)
    assert any("已失效" in t for t in titles)


def test_build_cleanup_merges_dups_and_dead_twins():
    tracks = [
        _t("keep", "Song", "A", popularity=90),
        _t("dup", "Song", "A", popularity=10),          # 可信重複 → dup 可刪
        _t("dead", "Gone", "B", is_playable=False),
        _t("live", "Gone", "B"),                         # dead 有可播放替身 → dead 可刪
        _t("lonely", "Solo", "C", is_playable=False),    # 失效無替身 → 不列入
    ]
    items = build_cleanup(tracks)
    by_id = {i["id"]: i for i in items}
    assert set(by_id) == {"dup", "dead"}
    assert "重複" in by_id["dup"]["reason"]
    assert "失效" in by_id["dead"]["reason"]


def test_play_no_active_device_returns_message():
    fake = FakeClient(play_error=Exception("NO_ACTIVE_DEVICE: ..."))
    tc = create_app(fake, "<html>page</html>", "tok").test_client()
    res = _post(tc, "/api/play", {"track_id": "x"})
    assert res.status_code == 409
    body = res.get_json()
    assert "裝置" in body["error"]

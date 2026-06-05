"""Track 模型正規化測試。"""

from stm.models import Track

from .conftest import make_saved_item


def test_from_item_extracts_basic_fields():
    track = Track.from_item(make_saved_item(track_id="x1", name="Hello", artists=("A",)))
    assert track.id == "x1"
    assert track.name == "Hello"
    assert track.primary_artist == "A"


def test_from_item_keeps_all_artists():
    track = Track.from_item(make_saved_item(artists=("A", "B", "C")))
    assert track.artists == ("A", "B", "C")
    assert track.primary_artist == "A"


def test_is_playable_defaults_true_when_field_missing():
    # 修 bug:API 未帶 market 時不回傳 is_playable,不該因此崩潰或誤判為失效
    track = Track.from_item(make_saved_item(is_playable=None))
    assert track.is_playable is True


def test_is_playable_respects_explicit_false():
    track = Track.from_item(make_saved_item(is_playable=False))
    assert track.is_playable is False


def test_extracts_isrc():
    track = Track.from_item(make_saved_item(isrc="GBXYZ0000001"))
    assert track.isrc == "GBXYZ0000001"


def test_isrc_is_none_when_missing():
    track = Track.from_item(make_saved_item(isrc=None))
    assert track.isrc is None


def test_popularity_defaults_zero_when_missing():
    item = make_saved_item()
    del item["track"]["popularity"]
    track = Track.from_item(item)
    assert track.popularity == 0


def test_extracts_added_at():
    track = Track.from_item(make_saved_item(added_at="2021-06-05T12:00:00Z"))
    assert track.added_at == "2021-06-05T12:00:00Z"


def test_primary_artist_empty_when_no_artists():
    item = make_saved_item()
    item["track"]["artists"] = []
    track = Track.from_item(item)
    assert track.primary_artist == ""

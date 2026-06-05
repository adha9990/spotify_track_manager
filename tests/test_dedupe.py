"""去重保留策略、刪除計畫與批次執行測試。"""

import pytest

from stm.models import Track
from stm import dedupe


def track(track_id, popularity=50, added_at="2020-01-01T00:00:00Z", is_playable=True):
    return Track(
        id=track_id,
        name="Song",
        artists=("A",),
        isrc=None,
        popularity=popularity,
        is_playable=is_playable,
        added_at=added_at,
    )


def test_keep_prefers_playable_over_dead_even_if_lower_popularity():
    group = [
        track("dead", popularity=90, is_playable=False),  # 人氣高但失效
        track("live", popularity=10, is_playable=True),
    ]
    plan = dedupe.plan_deletions([group], keep="popularity")
    assert plan.resolutions[0].keep.id == "live"  # 保留可播放,即使人氣較低
    assert [t.id for t in plan.resolutions[0].remove] == ["dead"]


# --- 保留策略:popularity ----------------------------------------------------


def test_keep_popularity_keeps_highest():
    group = [track("low", popularity=10), track("high", popularity=90)]
    plan = dedupe.plan_deletions([group], keep="popularity")
    assert plan.resolutions[0].keep.id == "high"
    assert [t.id for t in plan.resolutions[0].remove] == ["low"]


def test_keep_popularity_tie_breaks_on_oldest():
    group = [
        track("newer", popularity=50, added_at="2022-01-01T00:00:00Z"),
        track("older", popularity=50, added_at="2020-01-01T00:00:00Z"),
    ]
    plan = dedupe.plan_deletions([group], keep="popularity")
    assert plan.resolutions[0].keep.id == "older"


# --- 保留策略:oldest --------------------------------------------------------


def test_keep_oldest_keeps_earliest_added():
    group = [
        track("new", added_at="2022-01-01T00:00:00Z"),
        track("old", added_at="2019-01-01T00:00:00Z"),
    ]
    plan = dedupe.plan_deletions([group], keep="oldest")
    assert plan.resolutions[0].keep.id == "old"


def test_keep_oldest_with_missing_added_at_keeps_dated_one():
    # added_at=None 經 sentinel 排到最後(視為最新),應保留有日期的那首
    group = [
        track("no_date", added_at=None),
        track("dated", added_at="2020-01-01T00:00:00Z"),
    ]
    plan = dedupe.plan_deletions([group], keep="oldest")
    assert plan.resolutions[0].keep.id == "dated"


def test_keep_popularity_tie_with_both_added_at_none_is_deterministic():
    # 同人氣且兩者 added_at 皆 None → 落到 id 字典序,結果必須確定
    group = [
        track("b", popularity=50, added_at=None),
        track("a", popularity=50, added_at=None),
    ]
    plan = dedupe.plan_deletions([group], keep="popularity")
    assert plan.resolutions[0].keep.id == "a"
    assert [t.id for t in plan.resolutions[0].remove] == ["b"]


def test_unknown_keep_strategy_raises():
    with pytest.raises(ValueError):
        dedupe.plan_deletions([[track("a"), track("b")]], keep="bogus")


# --- 刪除計畫整體 ------------------------------------------------------------


def test_plan_removes_all_but_one_per_group():
    group = [track("a", popularity=10), track("b", popularity=20), track("c", popularity=30)]
    plan = dedupe.plan_deletions([group], keep="popularity")
    assert plan.resolutions[0].keep.id == "c"
    assert {t.id for t in plan.resolutions[0].remove} == {"a", "b"}


def test_delete_ids_flattens_across_groups():
    g1 = [track("a", popularity=10), track("keep1", popularity=99)]
    g2 = [track("b", popularity=10), track("keep2", popularity=99)]
    plan = dedupe.plan_deletions([g1, g2], keep="popularity")
    assert set(plan.delete_ids) == {"a", "b"}


def test_empty_groups_give_empty_plan():
    plan = dedupe.plan_deletions([], keep="popularity")
    assert plan.delete_ids == []
    assert plan.is_empty


# --- 批次執行 ----------------------------------------------------------------


class FakeClient:
    def __init__(self):
        self.calls = []

    def remove_saved_tracks(self, ids):
        self.calls.append(list(ids))


def test_execute_batches_in_chunks_of_50():
    ids = [f"t{i}" for i in range(120)]
    group = [track(i) for i in ids]
    # 人為製造一個「保留 1、刪除 119」的計畫不合理,改直接測 chunk 行為
    plan = dedupe.DeletionPlan(
        resolutions=[dedupe.GroupResolution(keep=group[0], remove=group[1:])]
    )
    client = FakeClient()
    dedupe.execute_deletions(client, plan, batch_size=50)
    assert [len(c) for c in client.calls] == [50, 50, 19]


def test_execute_empty_plan_makes_no_calls():
    client = FakeClient()
    dedupe.execute_deletions(client, dedupe.DeletionPlan(resolutions=[]))
    assert client.calls == []

"""把「可信重複群組」轉成刪除計畫,並批次執行刪除。

刪除計畫(``plan_deletions``)是純邏輯,可完整單元測試與 dry-run 預覽;
實際刪除(``execute_deletions``)才碰 Spotify API。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Protocol

from .models import Track

# added_at 缺失時排到最後(視為最新),才不會被誤選為「最早收藏」
_MAX_SENTINEL = "￿"


@dataclass(frozen=True)
class GroupResolution:
    """單一重複群組的決議:保留 keep,刪除 remove。"""

    keep: Track
    remove: list[Track]


@dataclass(frozen=True)
class DeletionPlan:
    """整份刪除計畫,涵蓋多個重複群組。"""

    resolutions: list[GroupResolution]

    @property
    def delete_ids(self) -> list[str]:
        return [t.id for r in self.resolutions for t in r.remove]

    @property
    def is_empty(self) -> bool:
        return not self.delete_ids


def _popularity_key(track: Track):
    # 取 min:人氣高者優先;同人氣時最早收藏優先;再以 id 確保確定性
    return (-track.popularity, track.added_at or _MAX_SENTINEL, track.id)


def _oldest_key(track: Track):
    return (track.added_at or _MAX_SENTINEL, track.id)


_KEEP_STRATEGIES = {
    "popularity": _popularity_key,
    "oldest": _oldest_key,
}


def plan_deletions(groups: Iterable[list[Track]], keep: str = "popularity") -> DeletionPlan:
    """為每個重複群組挑出要保留的一首,其餘列入刪除。

    keep="popularity":保留人氣最高(同分保留最早收藏)。
    keep="oldest":保留最早收藏。
    """
    try:
        key_fn = _KEEP_STRATEGIES[keep]
    except KeyError:
        raise ValueError(
            f"未知的保留策略 {keep!r},可用:{', '.join(_KEEP_STRATEGIES)}"
        ) from None

    resolutions = []
    for group in groups:
        kept = min(group, key=key_fn)
        remove = [t for t in group if t.id != kept.id]
        resolutions.append(GroupResolution(keep=kept, remove=remove))
    return DeletionPlan(resolutions=resolutions)


class SupportsRemove(Protocol):
    def remove_saved_tracks(self, ids: list[str]) -> None: ...


def _chunked(items: list[str], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def execute_deletions(
    client: SupportsRemove, plan: DeletionPlan, batch_size: int = 50
) -> int:
    """依計畫批次刪除歌曲,回傳實際刪除的數量。"""
    ids = plan.delete_ids
    for chunk in _chunked(ids, batch_size):
        client.remove_saved_tracks(chunk)
    return len(ids)

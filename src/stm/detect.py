"""重複與失效歌曲偵測——純函式,不碰網路,可單元測試。

偵測分三種信心等級:

* **confident**(exact 名稱+歌手 或 ISRC 相同):同一首歌,可進入自動刪除計畫。
* **name-only**(同名不同歌手):多半是巧合同名,僅供人工檢視。
* **fuzzy**(名稱相近,例如 remaster 版):僅報告,不自動刪除。
"""

from __future__ import annotations

import re
from collections import defaultdict

from rapidfuzz import fuzz

from .models import Track

_WHITESPACE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """正規化字串以利比對:轉小寫、去頭尾空白、合併內部連續空白。"""
    return _WHITESPACE.sub(" ", text.strip().lower())


def _group_by(tracks, key_fn):
    """依 key_fn 分組,回傳成員數 > 1 的群組;key 為 None 的歌曲略過。"""
    buckets: dict = defaultdict(list)
    for t in tracks:
        key = key_fn(t)
        if key is not None:
            buckets[key].append(t)
    return [group for group in buckets.values() if len(group) > 1]


def _merge_groups(groups: list[list[Track]]) -> list[list[Track]]:
    """以 union-find 合併共享同一首歌(依 id)的群組,回傳連通分量。"""
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)

    by_id: dict[str, Track] = {}
    for group in groups:
        anchor = group[0].id
        for t in group:
            by_id[t.id] = t
            union(t.id, anchor)

    components: dict[str, list[Track]] = defaultdict(list)
    for track_id, track in by_id.items():
        components[find(track_id)].append(track)
    return [members for members in components.values() if len(members) > 1]


def find_exact_duplicates(tracks) -> list[list[Track]]:
    """同名且同主要歌手(正規化後)的群組。"""
    return _group_by(tracks, lambda t: (normalize(t.name), normalize(t.primary_artist)))


def find_isrc_duplicates(tracks) -> list[list[Track]]:
    """ISRC 相同(同一錄音)的群組。"""
    return _group_by(tracks, lambda t: t.isrc)


def find_confident_duplicates(tracks) -> list[list[Track]]:
    """可自動刪除的重複:exact 與 ISRC 兩種群組合併後的連通分量。"""
    return _merge_groups(find_exact_duplicates(tracks) + find_isrc_duplicates(tracks))


def find_name_only_duplicates(tracks) -> list[list[Track]]:
    """同名但出現一個以上不同歌手的群組(同名巧合,僅供檢視)。

    每個歌手只取一首代表,避免把已屬於 confident 重複的同歌手副本一併列出而誤導。
    """
    groups = _group_by(tracks, lambda t: normalize(t.name))
    result = []
    for group in groups:
        by_artist: dict[str, Track] = {}
        for track in group:
            by_artist.setdefault(normalize(track.primary_artist), track)
        if len(by_artist) > 1:
            result.append(list(by_artist.values()))
    return result


def find_fuzzy_duplicates(tracks, threshold: float = 88) -> list[list[Track]]:
    """名稱相近(同歌手)的群組,僅供檢視;不進入自動刪除。"""
    by_artist: dict[str, list[Track]] = defaultdict(list)
    for t in tracks:
        by_artist[normalize(t.primary_artist)].append(t)

    result: list[list[Track]] = []
    for bucket in by_artist.values():
        result.extend(_cluster_by_similarity(bucket, threshold))
    return result


def _cluster_by_similarity(tracks: list[Track], threshold: float) -> list[list[Track]]:
    """桶內以名稱相似度做 union-find 分群,回傳成員數 > 1 的群組。"""
    pairs: list[list[Track]] = []
    for i, a in enumerate(tracks):
        for b in tracks[i + 1 :]:
            # token_set_ratio 對「子集」標題寬容(故能抓到 remaster/live 等後綴),
            # 代價是短標題可能偏寬鬆;fuzzy 僅供報告不自動刪,可接受此噪音。
            if fuzz.token_set_ratio(normalize(a.name), normalize(b.name)) >= threshold:
                pairs.append([a, b])
    return _merge_groups(pairs)


def find_unplayable(tracks) -> list[Track]:
    """已失效(不可播放)的歌曲。"""
    return [t for t in tracks if not t.is_playable]

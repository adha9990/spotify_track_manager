"""重複/失效偵測純邏輯測試。"""

from stm.models import Track
from stm import detect


def track(track_id, name, artist="A", isrc=None, popularity=50, is_playable=True):
    return Track(
        id=track_id,
        name=name,
        artists=(artist,),
        isrc=isrc,
        popularity=popularity,
        is_playable=is_playable,
        added_at=None,
    )


# --- normalize ---------------------------------------------------------------


def test_normalize_lowercases_and_trims():
    assert detect.normalize("  Hello World  ") == "hello world"


def test_normalize_collapses_internal_whitespace():
    assert detect.normalize("Hello    World") == "hello world"


# --- exact (name + artist) duplicates ----------------------------------------


def test_exact_duplicates_groups_same_name_and_artist():
    tracks = [
        track("1", "Song", "A"),
        track("2", "Song", "A"),
        track("3", "Other", "A"),
    ]
    groups = detect.find_exact_duplicates(tracks)
    assert len(groups) == 1
    assert {t.id for t in groups[0]} == {"1", "2"}


def test_exact_duplicates_ignore_case_and_spacing():
    tracks = [track("1", "Song", "A"), track("2", "  song ", "a")]
    groups = detect.find_exact_duplicates(tracks)
    assert len(groups) == 1


def test_exact_duplicates_different_artist_not_grouped():
    tracks = [track("1", "Song", "A"), track("2", "Song", "B")]
    assert detect.find_exact_duplicates(tracks) == []


# --- ISRC duplicates ---------------------------------------------------------


def test_isrc_duplicates_grouped():
    tracks = [
        track("1", "X", isrc="US1111111111"),
        track("2", "Y", isrc="US1111111111"),
        track("3", "Z", isrc="US2222222222"),
    ]
    groups = detect.find_isrc_duplicates(tracks)
    assert len(groups) == 1
    assert {t.id for t in groups[0]} == {"1", "2"}


def test_isrc_none_is_ignored():
    tracks = [track("1", "X", isrc=None), track("2", "Y", isrc=None)]
    assert detect.find_isrc_duplicates(tracks) == []


# --- confident duplicates (exact OR isrc, merged) ----------------------------


def test_confident_duplicates_merge_overlapping_groups():
    # 1&2 同名同歌手;2&3 同 ISRC → 三首應併成一組(union-find)
    tracks = [
        track("1", "Song", "A", isrc="US1111111111"),
        track("2", "Song", "A", isrc="US9999999999"),
        track("3", "Diff", "B", isrc="US9999999999"),
    ]
    groups = detect.find_confident_duplicates(tracks)
    assert len(groups) == 1
    assert {t.id for t in groups[0]} == {"1", "2", "3"}


def test_confident_duplicates_separate_groups_stay_separate():
    tracks = [
        track("1", "Song", "A"),
        track("2", "Song", "A"),
        track("3", "Other", "B"),
        track("4", "Other", "B"),
    ]
    groups = detect.find_confident_duplicates(tracks)
    assert len(groups) == 2


def test_confident_duplicates_merge_long_chain():
    # 鏈式:1-2 同名同歌手、2-3 同 ISRC、3-4 同名同歌手 → 四首應併成一組
    tracks = [
        track("1", "Song", "A"),
        track("2", "Song", "A", isrc="US1111111111"),
        track("3", "Diff", "B", isrc="US1111111111"),
        track("4", "Diff", "B"),
    ]
    groups = detect.find_confident_duplicates(tracks)
    assert len(groups) == 1
    assert {t.id for t in groups[0]} == {"1", "2", "3", "4"}


# --- name-only (same title, different artist) — report only ------------------


def test_name_only_duplicates_same_title_different_artist():
    tracks = [track("1", "Hello", "A"), track("2", "Hello", "B")]
    groups = detect.find_name_only_duplicates(tracks)
    assert len(groups) == 1
    assert {t.id for t in groups[0]} == {"1", "2"}


def test_name_only_excludes_same_artist_only_groups():
    # 同名同歌手不算 name-only(那是 exact dup)
    tracks = [track("1", "Hello", "A"), track("2", "Hello", "A")]
    assert detect.find_name_only_duplicates(tracks) == []


def test_name_only_reports_one_representative_per_artist():
    # 同名群組混入 exact dup 時,每個歌手只取一首代表,不重複列出 A 的兩首
    tracks = [
        track("a1", "Hello", "A"),
        track("a2", "Hello", "A"),
        track("b1", "Hello", "B"),
    ]
    groups = detect.find_name_only_duplicates(tracks)
    assert len(groups) == 1
    artists = {t.primary_artist for t in groups[0]}
    assert artists == {"A", "B"}
    assert len(groups[0]) == 2  # 不含 A 的第二首


# --- fuzzy (report only) -----------------------------------------------------


def test_fuzzy_matches_remaster_variants():
    tracks = [
        track("1", "Bohemian Rhapsody", "Queen"),
        track("2", "Bohemian Rhapsody - Remastered 2011", "Queen"),
    ]
    groups = detect.find_fuzzy_duplicates(tracks, threshold=80)
    assert len(groups) == 1
    assert {t.id for t in groups[0]} == {"1", "2"}


def test_fuzzy_does_not_match_clearly_different_songs():
    tracks = [
        track("1", "Yesterday", "The Beatles"),
        track("2", "Thriller", "Michael Jackson"),
    ]
    assert detect.find_fuzzy_duplicates(tracks, threshold=80) == []


def test_fuzzy_default_threshold_baseline():
    # 釘住預設 threshold(88)的行為,作為 rapidfuzz 升級的回歸基線
    remaster = [
        track("1", "Imagine", "John Lennon"),
        track("2", "Imagine - Remastered 2010", "John Lennon"),
    ]
    assert detect.find_fuzzy_duplicates(remaster) != []  # 預設應命中 remaster 版

    distinct = [
        track("3", "Imagine", "John Lennon"),
        track("4", "Stand By Me", "John Lennon"),
    ]
    assert detect.find_fuzzy_duplicates(distinct) == []  # 同歌手不同歌不應誤判


def test_fuzzy_token_set_matches_subset_titles():
    # token_set_ratio 對「子集」標題給滿分,這正是它能抓到 remaster/live 後綴的原因
    tracks = [
        track("1", "Song", "A"),
        track("2", "Song - Remastered", "A"),
    ]
    assert detect.find_fuzzy_duplicates(tracks, threshold=100) != []


# --- unplayable --------------------------------------------------------------


def test_find_unplayable():
    tracks = [
        track("1", "A", is_playable=True),
        track("2", "B", is_playable=False),
    ]
    result = detect.find_unplayable(tracks)
    assert [t.id for t in result] == ["2"]

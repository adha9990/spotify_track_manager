"""互動式網頁(stm serve)HTML 產生測試。"""

from stm.models import Track
from stm import webpage


def track(track_id="t1", name="Song", artist="A", popularity=50):
    return Track(
        id=track_id,
        name=name,
        artists=(artist,),
        isrc=None,
        popularity=popularity,
        is_playable=True,
        added_at=None,
    )


def test_is_html_document_with_tabs():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok")
    low = html.lower()
    assert "<!doctype html" in low
    assert 'class="tab' in html


def test_each_row_has_play_and_delete_button():
    html = webpage.render([("所有歌曲", [track(track_id="abc")], None)], token="tok")
    assert 'class="play"' in html
    assert 'class="del"' in html
    assert "abc" in html  # 按鈕需引用該歌 id


def test_confident_section_has_bulk_delete_button_with_ids():
    bulk_ids = ["d1", "d2", "d3"]
    html = webpage.render(
        [("可信重複", [track(track_id="d1"), track(track_id="keep")], bulk_ids)],
        token="tok",
    )
    assert 'class="bulk"' in html
    assert "3" in html  # 顯示將刪除數量
    assert 'data-ids="d1,d2,d3"' in html


def test_section_without_bulk_ids_has_no_bulk_button():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok")
    assert 'class="bulk"' not in html


def test_bulk_button_inline_with_count_in_section_header():
    html = webpage.render([("可信重複", [track()], ["d1"])], token="tok")
    # count 與 bulk 同一列容器,按鈕靠右
    assert 'class="sechead"' in html
    head = html.split('class="sechead"', 1)[1]
    # 同一個 sechead 容器內同時含 count 與 bulk
    assert 'class="count"' in head.split("</div>", 1)[0]
    assert 'class="bulk"' in head.split("</div>", 1)[0]


def test_embeds_session_token():
    html = webpage.render([("所有歌曲", [track()], None)], token="secret-token")
    assert "secret-token" in html


def test_calls_api_endpoints():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok")
    assert "/api/play" in html
    assert "/api/delete" in html


def test_escapes_html_in_track_name():
    html = webpage.render([("區段", [track(name="A & <b>")], None)], token="tok")
    assert "A &amp; &lt;b&gt;" in html


def test_shows_album_year_duration_and_added_date():
    t = Track(
        id="1", name="N", artists=("A",), isrc=None, popularity=50, is_playable=True,
        added_at="2021-06-05T00:00:00Z", album="My Album",
        release_date="2019-03-10", duration_ms=215000,
    )
    html = webpage.render([("所有歌曲", [t], None)], token="tok")
    assert ">專輯</th>" in html
    assert ">時長</th>" in html
    assert ">收藏日</th>" in html
    assert "My Album" in html
    assert "2019" in html  # 發行年
    assert "3:35" in html  # 215000ms = 3:35
    assert "2021-06-05" in html  # 收藏日期


def test_shows_playcount_when_available():
    t = Track(
        id="x", name="N", artists=("A",), isrc=None, popularity=50, is_playable=True,
        added_at=None, album="Al", album_id="alb", release_date="2020", duration_ms=1000,
    )
    html = webpage.render([("所有歌曲", [t], None)], token="tok", playcounts={"x": 1234567})
    assert ">播放次數</th>" in html
    assert "1,234,567" in html


def test_shows_dash_when_playcount_unknown():
    html = webpage.render([("所有歌曲", [track(track_id="y")], None)], token="tok", playcounts={})
    assert "—" in html


def test_has_search_box():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok")
    assert 'id="search"' in html


def test_rows_carry_order_for_restore():
    html = webpage.render(
        [("所有歌曲", [track(track_id="a"), track(track_id="b")], None)], token="tok"
    )
    assert 'data-order="0"' in html
    assert 'data-order="1"' in html


def test_search_js_has_fuzzy_and_highlight():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok")
    assert "function fuzzy" in html  # fuzzy 比對
    assert "<mark>" in html  # 高亮標記


def test_headers_are_sortable():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok")
    assert 'class="sortable"' in html
    assert "function sortBy" in html
    # 時長/播放次數用 data-sort 原始值排序,而非顯示文字
    assert "data-sort=" in html


def test_unplayable_rows_open_replacements_on_click():
    html = webpage.render([("已失效", [track()], None, True)], token="tok")
    assert 'onclick="toggleReplacements(this, event)"' in html  # 點列展開
    assert "/api/search" in html
    assert "fa-chevron-down" in html  # 展開提示圖示
    assert "🔁" not in html  # 不再有找平替按鈕


def test_normal_rows_are_not_clickable_for_replacement():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok")
    assert "toggleReplacements(this" not in html  # 一般列不可點展開


def test_cleanup_button_and_modal_with_reasons():
    html = webpage.render(
        [("所有歌曲", [track()], None)], token="tok",
        cleanup=[{"id": "x", "name": "N", "artist": "A", "reason": "重複(已保留同組人氣最高者)"}],
    )
    assert 'onclick="openCleanup()"' in html
    assert 'id="cleanup-modal"' in html
    assert "#cleanup-modal[hidden]" in html  # 載入時 modal 須隱藏(hidden 要蓋過 display)
    assert "function openCleanup" in html
    assert "一鍵過濾 (1)" in html
    assert "重複(已保留同組人氣最高者)" in html  # 原因嵌入供 dialog 顯示


def test_cleanup_button_disabled_when_nothing_to_filter():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok", cleanup=[])
    assert "一鍵過濾 (0)" in html
    assert 'onclick="openCleanup()" disabled' in html


def test_has_history_panel_and_undo():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok")
    assert 'id="history"' in html
    assert "/api/history" in html
    assert "/api/undo" in html
    assert "function undoBatch" in html


def test_has_offline_reconnect_handling():
    html = webpage.render([("所有歌曲", [track()], None)], token="tok")
    assert 'id="offline"' in html  # 斷線提示元素
    assert "/health" in html  # 心跳輪詢端點
    assert "location.reload" in html  # 恢復後刷新頁面

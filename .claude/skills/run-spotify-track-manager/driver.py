"""Launch the `stm serve` web app with a FAKE Spotify client — no OAuth, no
credentials, no network. Serves sample data so the interactive page can be
driven on a clean machine.

    python .claude/skills/run-spotify-track-manager/driver.py [PORT]

Defaults to port 8799. The session token is the fixed string "demo-token"
so the /api/* endpoints can be driven with curl. The fake client records
actions instead of touching a real library, so delete/add/play are safe.

Endpoints (see SKILL.md):
    GET  /                      the page (HTML)
    GET  /health                {"ok": true}            (no token)
    POST /api/play   {track_id}                          (X-Token: demo-token)
    POST /api/delete {track_ids}
    POST /api/add    {track_ids}
    POST /api/search {query}
    GET  /api/history
    POST /api/undo   {batch_id}
"""

from __future__ import annotations

import sys

from stm import server, webpage
from stm.history import History
from stm.models import Track

TOKEN = "demo-token"

# (id, name, artist(s), album, album_id, year, duration_ms, popularity, playable)
_SAMPLE = [
    ("t01", "求佛", "誓言", "求佛", "al1", "2008", 261000, 44, True),
    ("t02", "求佛", "誓言", "求佛 (Reissue)", "al2", "2010", 261000, 9, True),   # dup of t01
    ("t03", "夜空中最亮的星", "逃跑計劃", "世界", "al3", "2011", 245000, 71, True),
    ("t04", "一起寂寞 Lonely Duet", "邱鋒澤 Feng Ze, 艾薇 Ivy", "合輯", "al4", "2015", 264000, 68, True),  # 多歌手
    ("t05", "起風了", "買辣椒也用券", "起風了", "al5", "2017", 311000, 66, True),
    ("t06", "晴天", "周杰倫", "葉惠美", "al6", "2003", 269000, 74, True),
    ("t07", "小情歌", "蘇打綠", "小宇宙", "al7", "2006", 258000, 63, True),
    ("t08", "理想三旬", "陳鴻宇", "濃煙下的詩歌電台", "al8", "2016", 288000, 59, False),  # dead(無替身)
    ("t09", "成都", "趙雷", "無法長大", "al9", "2016", 327000, 61, True),
    ("t10", "成都", "趙雷", "成都 (Live)", "al10", "2017", 330000, 40, True),   # dup of t09
    ("t11", "成都", "趙雷", "成都 (失效版)", "al11", "2014", 327000, 30, False),  # dead 有可播放替身
]


def sample_tracks() -> list[Track]:
    return [
        Track(
            id=i, name=n, artists=tuple(a.split(", ")), isrc=None, popularity=pop, is_playable=ok,
            added_at=f"20{20 - idx % 5}-0{idx % 9 + 1}-15T00:00:00Z",
            album=alb, album_id=aid, release_date=yr, duration_ms=dur,
        )
        for idx, (i, n, a, alb, aid, yr, dur, pop, ok) in enumerate(_SAMPLE)
    ]


class FakeClient:
    """Records actions instead of touching a real Spotify library."""

    def __init__(self):
        self.actions: list = []

    def remove_saved_tracks(self, ids):
        self.actions.append(("delete", list(ids)))

    def add_saved_tracks(self, ids):
        self.actions.append(("add", list(ids)))

    def start_playback(self, track_id):
        self.actions.append(("play", track_id))

    def search_tracks(self, query, limit=8):
        term = query.split()[0] if query.split() else query
        albums = ["Original", "Remaster 2020", "Live", "Deluxe Edition", "Single"]
        return [
            {"id": f"alt{i}", "name": term, "artist": "Some Artist", "album": alb}
            for i, alb in enumerate(albums, 1)
        ]


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    tracks = sample_tracks()
    sections = server.build_sections(tracks)
    cleanup = server.build_cleanup(tracks)
    playcounts = {t.id: (idx + 1) * 1_234_567 for idx, t in enumerate(tracks)}
    page = webpage.render(sections, TOKEN, playcounts=playcounts, cleanup=cleanup)
    tracks_by_id = {t.id: {"name": t.name, "artist": t.primary_artist} for t in tracks}
    app = server.create_app(
        FakeClient(), page, TOKEN, history=History(":memory:"), tracks_by_id=tracks_by_id
    )
    print(f"DRIVER UP http://127.0.0.1:{port}  token={TOKEN}", flush=True)
    app.run(host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()

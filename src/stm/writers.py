"""把歌曲清單整理成單一、自包含的 HTML 頁籤式報表。

輸入是多個 (分節標題, 歌曲清單),輸出是一份含頁籤(tab)切換的 .html 檔:
每個分節一個頁籤,點選顯示該類別的表格。零外部依賴,離線開啟即可。
"""

from __future__ import annotations

import html
from pathlib import Path

from .models import Track

Section = tuple[str, list[Track]]

_STYLE = """<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, "Segoe UI", "Noto Sans TC", sans-serif;
         margin: 2rem auto; max-width: 960px; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  .tabs { display: flex; flex-wrap: wrap; gap: .25rem; border-bottom: 2px solid #8884;
          margin-bottom: 1rem; }
  .tab { border: none; background: none; padding: .5rem .9rem; cursor: pointer;
         font-size: .95rem; color: inherit; border-bottom: 2px solid transparent;
         margin-bottom: -2px; }
  .tab:hover { background: #8881; }
  .tab.active { border-bottom-color: #1db954; font-weight: 600; }
  .badge { display: inline-block; min-width: 1.2em; padding: 0 .4em; border-radius: 1em;
           background: #1db954; color: #fff; font-size: .8rem; text-align: center; }
  .count { color: #8a8a8a; margin: .3rem 0 1rem; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #8883; }
  th { position: sticky; top: 0; background: Canvas; }
  tbody tr:hover { background: #1db95418; }
  td:nth-child(3) { text-align: right; font-variant-numeric: tabular-nums; }
  code { font-size: .85em; color: #8a8a8a; }
</style>"""

_SCRIPT = """<script>
  function showTab(i) {
    document.querySelectorAll('.panel').forEach((p, j) => { p.hidden = j !== i; });
    document.querySelectorAll('.tab').forEach((t, j) => {
      t.classList.toggle('active', j === i);
    });
  }
</script>"""


def _esc(text) -> str:
    return html.escape(str(text))


def _table(tracks: list[Track]) -> str:
    rows = "".join(
        f"<tr><td>{_esc(t.name)}</td><td>{_esc(t.primary_artist)}</td>"
        f"<td>{t.popularity}</td><td><code>{_esc(t.id)}</code></td></tr>"
        for t in tracks
    )
    return (
        "<table><thead><tr>"
        "<th>歌名</th><th>歌手</th><th>人氣</th><th>ID</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
    )


def write_report(sections: list[Section], path, title: str = "Spotify 收藏報表") -> None:
    """把多個分節整理成單一 HTML 頁籤式報表寫到 path。"""
    tabs, panels = [], []
    for i, (section_title, tracks) in enumerate(sections):
        active = " active" if i == 0 else ""
        tabs.append(
            f'<button class="tab{active}" onclick="showTab({i})">'
            f'{_esc(section_title)} <span class="badge">{len(tracks)}</span></button>'
        )
        hidden = "" if i == 0 else " hidden"
        panels.append(
            f'<section class="panel"{hidden}>'
            f'<p class="count">共 {len(tracks)} 首歌曲</p>{_table(tracks)}</section>'
        )

    doc = (
        '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{_esc(title)}</title>\n{_STYLE}\n</head>\n<body>\n"
        f"<h1>{_esc(title)}</h1>\n"
        f'<div class="tabs">{"".join(tabs)}</div>\n'
        f'<div class="panels">{"".join(panels)}</div>\n'
        f"{_SCRIPT}\n</body>\n</html>\n"
    )

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(doc, encoding="utf-8")

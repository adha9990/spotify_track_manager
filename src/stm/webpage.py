"""產生 ``stm serve`` 的互動式 HTML 頁面。

與靜態報表(writers.py)不同:每列有播放/刪除按鈕、可信重複節有一鍵刪除、
頂端有 fuzzy 搜尋(即時排序 + 高亮),並內嵌帶 session token 呼叫 ``/api/*`` 的 JS。
"""

from __future__ import annotations

import html
import json

from .models import Track

# section = (標題, 歌曲清單, 批量刪除 ids 或 None)
Section = tuple[str, list[Track], list[str] | None]

_STYLE = """<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, "Segoe UI", "Noto Sans TC", sans-serif;
         margin: 2rem auto; max-width: 1040px; padding: 0 1rem; }
  h1 { font-size: 1.4rem; margin-bottom: .5rem; }
  #search { width: 100%; box-sizing: border-box; padding: .55rem .8rem; font-size: 1rem;
            border: 1px solid #8886; border-radius: .5rem; margin-bottom: 1rem;
            background: Canvas; color: inherit; }
  .tabs { display: flex; flex-wrap: wrap; gap: .25rem; border-bottom: 2px solid #8884;
          margin-bottom: 1rem; }
  .tab { border: none; background: none; padding: .5rem .9rem; cursor: pointer;
         font-size: .95rem; color: inherit; border-bottom: 2px solid transparent;
         margin-bottom: -2px; }
  .tab:hover { background: #8881; }
  .tab.active { border-bottom-color: #1db954; font-weight: 600; }
  .badge { display: inline-block; min-width: 1.2em; padding: 0 .4em; border-radius: 1em;
           background: #1db954; color: #fff; font-size: .8rem; text-align: center; }
  .sechead { display: flex; justify-content: space-between; align-items: center;
             gap: 1rem; margin: .3rem 0 1rem; }
  .count { color: #8a8a8a; }
  .bulk { background: #e22; color: #fff; border: none; border-radius: .4rem;
          padding: .5rem .9rem; cursor: pointer; font-size: .9rem; white-space: nowrap; }
  .bulk:disabled { background: #8a8a8a; cursor: default; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #8883; }
  th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
  th.sortable:hover { background: #8881; }
  th.sortable[data-dir="asc"]::after { content: " ▲"; font-size: .75em; }
  th.sortable[data-dir="desc"]::after { content: " ▼"; font-size: .75em; }
  td:nth-child(5), td:nth-child(6), td:nth-child(7), td:nth-child(8) {
    text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:hover { background: #1db95418; }
  #offline { position: fixed; top: 0; left: 0; right: 0; background: #e22; color: #fff;
             text-align: center; padding: .6rem; font-size: .95rem; z-index: 10; }
  .histbtn { background: none; border: 1px solid #8886; border-radius: .4rem;
             padding: .35rem .7rem; cursor: pointer; color: inherit; font-size: .9rem;
             margin-bottom: 1rem; }
  #history { border: 1px solid #8884; border-radius: .5rem; padding: .5rem 1rem;
             margin-bottom: 1rem; max-height: 16rem; overflow: auto; }
  .hrow { display: flex; justify-content: space-between; align-items: center;
          gap: 1rem; padding: .35rem 0; border-bottom: 1px solid #8882; }
  .hrow:last-child { border-bottom: none; }
  .hrow button { border: 1px solid #8886; background: none; color: inherit;
                 border-radius: .3rem; padding: .2rem .6rem; cursor: pointer; }
  .hrow button:disabled { opacity: .5; cursor: default; }
  .hrow .undone { color: #1db954; font-size: .85rem; }
  mark { background: #ffd54a; color: #000; border-radius: .15em; }
  .play, .del, .repl-btn { border: none; background: none; cursor: pointer; font-size: 1rem;
                padding: .1rem .4rem; border-radius: .3rem; }
  .play:hover { background: #1db95433; }
  .del:hover { background: #e2222233; }
  .repl-btn:hover { background: #8882; }
  tr.repl td { background: #8881; }
  .rq { padding: .35rem .5rem; min-width: 18rem; }
  .results { margin-top: .5rem; }
  .rrow { display: flex; justify-content: space-between; align-items: center;
          gap: 1rem; padding: .25rem 0; }
  .rrow small { color: #8a8a8a; }
  #toast { position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
           background: #222; color: #fff; padding: .6rem 1rem; border-radius: .5rem;
           opacity: 0; transition: opacity .2s; pointer-events: none; }
  #toast.show { opacity: 1; }
</style>"""


def _esc(text) -> str:
    return html.escape(str(text))


def _duration(ms: int) -> str:
    sec = (ms or 0) // 1000
    return f"{sec // 60}:{sec % 60:02d}"


def _year(release_date: str | None) -> str:
    return release_date[:4] if release_date else ""


def _date(added_at: str | None) -> str:
    return added_at[:10] if added_at else ""


def _pc_cell(playcounts: dict[str, int], track_id: str) -> str:
    n = playcounts.get(track_id)
    disp = f"{n:,}" if n is not None else "—"
    sort = n if n is not None else -1
    return f'<td data-sort="{sort}">{disp}</td>'


def _row(track: Track, order: int, playcounts: dict[str, int], replaceable: bool) -> str:
    tid = _esc(track.id)
    name, artist, album = _esc(track.name), _esc(track.primary_artist), _esc(track.album)
    year, added = _year(track.release_date), _date(track.added_at)
    replace_btn = (
        '<button class="repl-btn" title="找平替" onclick="findReplacement(this)">🔁</button>'
        if replaceable
        else ""
    )
    return (
        f'<tr data-id="{tid}" data-order="{order}">'
        f'<td><button class="play" title="播放" onclick="play(\'{tid}\')">▶</button></td>'
        f'<td data-sort="{name}">{name}</td><td data-sort="{artist}">{artist}</td>'
        f'<td data-sort="{album}">{album}</td><td data-sort="{year}">{year}</td>'
        f'<td data-sort="{track.duration_ms}">{_duration(track.duration_ms)}</td>'
        f'<td data-sort="{track.popularity}">{track.popularity}</td>'
        f"{_pc_cell(playcounts, track.id)}"
        f'<td data-sort="{added}">{added}</td>'
        f'<td>{replace_btn}<button class="del" title="刪除" onclick="del(\'{tid}\')">🗑</button></td>'
        "</tr>"
    )


def _th(label: str) -> str:
    return f'<th class="sortable" onclick="sortBy(this)">{label}</th>'


def _table(tracks: list[Track], playcounts: dict[str, int], replaceable: bool = False) -> str:
    rows = "".join(_row(t, i, playcounts, replaceable) for i, t in enumerate(tracks))
    header = (
        "<th></th>"
        + _th("歌名") + _th("歌手") + _th("專輯") + _th("年")
        + _th("時長") + _th("人氣") + _th("播放次數") + _th("收藏日")
        + "<th></th>"
    )
    return f"<table><thead><tr>{header}</tr></thead><tbody>{rows}</tbody></table>"


def _section_header(count: int, bulk_ids: list[str] | None) -> str:
    count_html = f'<span class="count">共 {count} 首歌曲</span>'
    bulk_html = ""
    if bulk_ids:
        ids = _esc(",".join(bulk_ids))
        bulk_html = (
            f'<button class="bulk" data-ids="{ids}" onclick="bulkDelete(this)">'
            f"一鍵刪除可信重複(將刪 {len(bulk_ids)} 首,每組保留人氣最高)</button>"
        )
    return f'<div class="sechead">{count_html}{bulk_html}</div>'


def _script(token: str) -> str:
    return (
        "<script>\n"
        f"const TOKEN = {json.dumps(token)};\n"
        """
function showTab(i) {
  document.querySelectorAll('.panel').forEach((p, j) => { p.hidden = j !== i; });
  document.querySelectorAll('.tab').forEach((t, j) => t.classList.toggle('active', j === i));
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Token': TOKEN },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
async function apiGet(path) {
  const res = await fetch(path, { headers: { 'X-Token': TOKEN }, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
const ACTION_LABEL = { delete: '刪除', add: '加入' };
async function toggleHistory() {
  const box = document.getElementById('history');
  if (!box.hidden) { box.hidden = true; return; }
  try {
    const { batches } = await apiGet('/api/history');
    if (!batches.length) {
      box.innerHTML = '<div class="hrow">尚無操作紀錄</div>';
    } else {
      box.innerHTML = batches.map(b => {
        const label = (ACTION_LABEL[b.action] || b.action) + ' ' + b.n + ' 首';
        const right = b.undone
          ? '<span class="undone">已復原</span>'
          : `<button data-bid="${b.batch_id}" onclick="undoBatch(this.dataset.bid, this)">復原</button>`;
        return `<div class="hrow"><span>${esc(label)} · ${esc(b.ts)}</span>${right}</div>`;
      }).join('');
    }
    box.hidden = false;
  } catch (e) { toast('讀取歷史失敗:' + e.message); }
}
async function undoBatch(batchId, btn) {
  if (!confirm('確定復原這筆操作?(會反向加回/移除對應歌曲)')) return;
  try {
    const { restored } = await api('/api/undo', { batch_id: batchId });
    toast('已復原 ' + restored + ' 首,重新整理頁面');
    location.reload();
  } catch (e) { toast('復原失敗:' + e.message); }
}
function refreshCounts() {
  document.querySelectorAll('.panel').forEach((panel, i) => {
    const n = panel.querySelectorAll('tbody tr').length;
    panel.querySelector('.count').textContent = '共 ' + n + ' 首歌曲';
    document.querySelectorAll('.tab')[i].querySelector('.badge').textContent = n;
  });
}
function removeRows(ids) {
  ids.forEach(id => document.querySelectorAll('tr[data-id="' + CSS.escape(id) + '"]')
                            .forEach(tr => tr.remove()));
  refreshCounts();
}
async function play(id) {
  try { await api('/api/play', { track_id: id }); toast('已開始播放'); }
  catch (e) { toast('播放失敗:' + e.message); }
}
async function del(id) {
  try { await api('/api/delete', { track_ids: [id] }); removeRows([id]); toast('已刪除'); }
  catch (e) { toast('刪除失敗:' + e.message); }
}
function findReplacement(btn) {
  const row = btn.closest('tr');
  const next = row.nextElementSibling;
  if (next && next.classList.contains('repl')) { next.remove(); return; }  // 再點收合
  const name = row.cells[1].textContent, artist = row.cells[2].textContent;
  const deadId = row.dataset.id;
  const tr = document.createElement('tr');
  tr.className = 'repl';
  const td = document.createElement('td');
  td.colSpan = row.cells.length;
  td.innerHTML = '<input class="rq" type="search"> <button class="rgo">搜尋</button>'
               + '<div class="results"></div>';
  tr.appendChild(td); row.after(tr);
  const input = td.querySelector('.rq');
  const box = td.querySelector('.results');
  input.value = name + ' ' + artist;            // 用 property 設值,免去屬性跳脫
  const run = () => replSearch(input, box, deadId);
  td.querySelector('.rgo').onclick = run;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  run();
}
async function replSearch(input, box, deadId) {
  box.textContent = '搜尋中…';
  try {
    const { results } = await api('/api/search', { query: input.value });
    if (!results.length) { box.textContent = '找不到結果'; return; }
    box.innerHTML = results.map(r =>
      '<div class="rrow"><span>' + esc(r.name) + ' — ' + esc(r.artist)
      + ' <small>' + esc(r.album) + '</small></span>'
      + '<button data-id="' + r.id + '" data-dead="' + deadId
      + '" onclick="addReplacement(this)">加入</button></div>'
    ).join('');
  } catch (e) { box.textContent = '搜尋失敗:' + e.message; }
}
async function addReplacement(btn) {
  const trackId = btn.dataset.id, deadId = btn.dataset.dead;
  try {
    await api('/api/add', { track_ids: [trackId] });
    btn.disabled = true; btn.textContent = '已加入';
    if (confirm('已加入替代版,刪除原本的失效歌?')) {
      await api('/api/delete', { track_ids: [deadId] });
      removeRows([deadId]);
      toast('已加入並刪除失效版');
    } else { toast('已加入'); }
  } catch (e) { toast('加入失敗:' + e.message); }
}
async function bulkDelete(btn) {
  const ids = (btn.dataset.ids || '').split(',').filter(Boolean);
  if (!ids.length) { toast('沒有可刪除的重複'); return; }
  if (!confirm('將刪除 ' + ids.length + ' 首重複歌曲(每組保留人氣最高),確定?')) return;
  try {
    await api('/api/delete', { track_ids: ids });
    removeRows(ids);                                  // 全頁移除已刪的歌
    const panel = btn.closest('.panel');
    panel.querySelectorAll('tbody tr').forEach(r => r.remove());  // 重複已清,清空本節
    btn.dataset.ids = ''; btn.disabled = true; btn.textContent = '重複已清除';
    refreshCounts();
    toast('已刪除 ' + ids.length + ' 首,重複已清除');
  } catch (e) { toast('刪除失敗:' + e.message); }
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fuzzy(q, text) {
  const t = text.toLowerCase(); q = q.toLowerCase();
  let qi = 0, score = 0, run = 0; const idx = [];
  for (let j = 0; j < t.length && qi < q.length; j++) {
    if (t[j] === q[qi]) {
      idx.push(j); run++; score += 10 + run * 5;
      if (j === 0) score += 15;
      qi++;
    } else { run = 0; }
  }
  if (qi < q.length) return null;          // 非子序列,不算命中
  return { score: score - t.length * 0.5, idx };
}
function highlight(text, idx) {
  const set = new Set(idx); let out = '';
  for (let j = 0; j < text.length; j++) {
    const c = esc(text[j]);
    out += set.has(j) ? '<mark>' + c + '</mark>' : c;
  }
  return out;
}
function search() {
  const q = document.getElementById('search').value.trim();
  document.querySelectorAll('.panel').forEach(panel => {
    const tbody = panel.querySelector('tbody');
    const scored = [...tbody.querySelectorAll('tr')].map(row => {
      const nameCell = row.cells[1], artistCell = row.cells[2];
      const name = nameCell.textContent, artist = artistCell.textContent;
      const nm = q ? fuzzy(q, name) : null;
      const am = q ? fuzzy(q, artist) : null;
      nameCell.innerHTML = nm ? highlight(name, nm.idx) : esc(name);
      artistCell.innerHTML = am ? highlight(artist, am.idx) : esc(artist);
      row.hidden = !(!q || nm || am);
      const score = Math.max(nm ? nm.score : -1e9, am ? am.score : -1e9);
      return { row, score, order: +row.dataset.order };
    });
    scored.sort((a, b) => q ? b.score - a.score : a.order - b.order);
    scored.forEach(s => tbody.appendChild(s.row));
  });
}
function sortBy(th) {
  const idx = [...th.parentNode.children].indexOf(th);
  const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
  th.parentNode.querySelectorAll('th').forEach(h => { if (h !== th) h.removeAttribute('data-dir'); });
  th.dataset.dir = dir;
  const tbody = th.closest('table').querySelector('tbody');
  const rows = [...tbody.querySelectorAll('tr')];
  const val = r => {
    const c = r.cells[idx];
    return c.dataset.sort !== undefined ? c.dataset.sort : c.textContent;
  };
  const numeric = rows.length > 0 && rows.every(r => { const v = val(r); return v !== '' && !isNaN(v); });
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    const cmp = numeric ? (+x - +y) : String(x).localeCompare(String(y));
    return dir === 'asc' ? cmp : -cmp;
  });
  rows.forEach((r, i) => { r.dataset.order = i; tbody.appendChild(r); });  // 排序成為新基準
}
// 心跳:斷線顯示橫幅;後端恢復後刷新頁面(順便換到新 server 的 token)
let connected = true;
async function ping() {
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    if (!res.ok) throw new Error('bad');
    if (!connected) { location.reload(); return; }
  } catch (e) {
    connected = false;
    document.getElementById('offline').hidden = false;
  }
}
setInterval(ping, 2000);
</script>"""
    )


def render(
    sections: list[Section],
    token: str,
    title: str = "Spotify 收藏報表",
    playcounts: dict[str, int] | None = None,
) -> str:
    """產生互動式 HTML 頁面字串。playcounts 缺的歌顯示為 —。"""
    playcounts = playcounts or {}
    tabs, panels = [], []
    for i, section in enumerate(sections):
        section_title, tracks, bulk_ids = section[0], section[1], section[2]
        replaceable = section[3] if len(section) > 3 else False
        active = " active" if i == 0 else ""
        tabs.append(
            f'<button class="tab{active}" onclick="showTab({i})">'
            f'{_esc(section_title)} <span class="badge">{len(tracks)}</span></button>'
        )
        hidden = "" if i == 0 else " hidden"
        panels.append(
            f'<section class="panel"{hidden}>'
            f"{_section_header(len(tracks), bulk_ids)}"
            f"{_table(tracks, playcounts, replaceable)}</section>"
        )

    return (
        '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{_esc(title)}</title>\n{_STYLE}\n</head>\n<body>\n"
        '<div id="offline" hidden>與伺服器失去連線,嘗試重新連線中…</div>\n'
        f"<h1>{_esc(title)}</h1>\n"
        '<button class="histbtn" onclick="toggleHistory()">↩ 操作歷史</button>\n'
        '<div id="history" hidden></div>\n'
        '<input id="search" type="search" placeholder="搜尋歌名或歌手…" '
        'oninput="search()" autocomplete="off">\n'
        f'<div class="tabs">{"".join(tabs)}</div>\n'
        f'<div class="panels">{"".join(panels)}</div>\n'
        '<div id="toast"></div>\n'
        f"{_script(token)}\n</body>\n</html>\n"
    )

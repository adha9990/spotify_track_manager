# 設計:`stm serve` 互動式網頁

日期:2026-06-05

## 目標

讓使用者在瀏覽器中直接對掃描結果採取行動:
- 每首歌**左側播放鍵**:在使用者 Spotify 的 active device 播這首
- 每首歌**右側刪除鍵**:從收藏移除這首(單首即時、不跳確認)
- **可信重複**頁籤頂端**一鍵刪除**:每組保留人氣最高,刪其餘(跳確認框)

純靜態 HTML 無授權、無法呼叫 Spotify API,故新增本機伺服器承載已授權 client。

## 架構

新增 `stm serve` 指令:
1. 建立已授權 client → `fetch` 抓歌 → `detect` 偵測(沿用現有純邏輯)
2. `dedupe.plan_deletions(confident, keep="popularity")` 算出可信重複刪除計畫
3. 啟動 Flask 伺服器,**僅綁 `127.0.0.1`**,預設 port 8765,開瀏覽器
4. 頁面按鈕經 `fetch()` 呼叫伺服器端點操作帳號

`stm scan` 靜態報表與 `writers.py` 維持不動。

## 元件

| 檔案 | 職責 | 介面 |
|------|------|------|
| `src/stm/webpage.py`(新) | 產生互動版 HTML | `render(sections, plan_delete_ids, token, title) -> str` |
| `src/stm/server.py`(新) | Flask app + 路由 | `create_app(client, html, plan_delete_ids, token)`、`serve(...)` |
| `src/stm/client.py` | 加播放 | `start_playback(track_id)`(spotipy `start_playback(uris=[...])`) |
| `src/stm/config.py` | 擴充 scope | `+ user-modify-playback-state user-read-playback-state` |
| `src/stm/cli.py` | 加指令 | `serve(--playlist, --port=8765)` |
| `pyproject.toml` | 依賴 | `+ flask` |

## API 端點(皆需帶 session token,否則 403)

- `POST /api/play` `{track_id}` → `client.start_playback(track_id)`
  - 無 active device → 409 + 訊息「請先在 Spotify 開啟播放裝置」
  - 非 Premium / 其他錯誤 → 4xx + 訊息
- `POST /api/delete` `{track_ids: [...]}` → `client.remove_saved_tracks(track_ids)`
  - 單首(1 個 id)與批量(計畫清單)共用此端點

## 資料流

- 啟動時算好 `plan_delete_ids`(可信重複的刪除清單)嵌入頁面;批量鍵送這份清單
- 單首刪除成功 → 前端移除該列、頁籤數字 −1
- 批量刪除前端先 `confirm`,確認後送計畫清單,成功後移除對應列

## 錯誤處理

- 播放/刪除失敗 → 前端 toast 顯示後端訊息,刪除失敗時列不消失
- token 不符 → 403

## 安全

- 伺服器僅綁 `127.0.0.1`(不對外)
- 啟動產生隨機 session token,嵌入頁面,API 需於 header 帶上 → 擋其他本機網頁/程式的 CSRF 式呼叫

## 測試(TDD)

- `webpage.py`:每列含 play/delete 按鈕、可信重複頁籤含一鍵刪除、token 有嵌入、儲存格 HTML 跳脫
- `server.py`(Flask test client + 假 client):
  - `/api/delete` 真的呼叫 `remove_saved_tracks` 且帶正確 ids
  - `/api/play` 呼叫 `start_playback`
  - 缺/錯 token → 403
  - 無 active device → 409 + 訊息
- `client.start_playback` 委派(假 spotipy)

## 使用者須知

- 加了播放 scope → 下次啟動 spotipy 會要求**重新授權**一次
- 播放需 **Spotify Premium** + 開著的播放裝置

## 不做(YAGNI)

- 不做帳號多人、不做雲端部署、不做 0.0.0.0 對外、不做播放佇列/暫停等完整播放器(只做「播這首」)
- 失效歌曲頁籤暫不加一鍵刪除(可日後再加)

# Spotify 收藏年鑑

在本機瀏覽 Spotify「我的最愛」與歌單。「歌曲來源」可在全部收藏和任一歌單之間切換。歌單中的每筆曲目依照原本的位置顯示。

## 啟動

需要 Node.js 22 以上與 pnpm。請在專案根目錄執行以下指令。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

開啟 [http://127.0.0.1:8888](http://127.0.0.1:8888)，按「連線 Spotify」並在 Spotify 頁面授權。Node.js 服務停止後，下次啟動時需要重新登入。清理紀錄依 Spotify 帳號存在專案的 `.cache/`。

| 頁籤 | 操作 |
| --- | --- |
| 歌曲 | 選擇全部收藏或一張歌單。在「重新整理」旁按「尋找相似歌曲」，查看目前來源中符合門檻的相似群組。 |
| 失效歌曲 | 查找仍需替代的曲目。收藏中已有同 ISRC、同藝人版本或同名可播放曲目時，可展開查看對應版本。 |

「尋找替代」會用原曲的歌名、主要藝人與 ISRC 搜尋可播放候選，再使用「尋找相似歌曲」的向量資料庫與評分。相同 ISRC 直接為 100%。其他有兩筆獨立音訊向量的版本依相似度排序，預設門檻為 90%。缺少音訊向量的候選會列在「待試聽確認」。

Spotify 的歌單曲目 API 開放給歌單擁有者與協作者。歌單中的曲目可透過連結在 Spotify 開啟。

載入或重新整理歌曲來源時，瀏覽器會在本機 IndexedDB 建立每首曲目的稀疏歌名向量，並保存比對使用的 ISRC、藝人、專輯和時長。「尋找相似歌曲」沿用資料庫中的向量，預設門檻為 70%。

有效 ISRC 相同的兩首歌曲直接得到 100%。其餘配對的曲目資料分數會比對歌名與藝人，已有曲目資料配對且專輯名稱相同時加 2 分。各有獨立的 Discogs Multi 向量時，合計 90% 的音訊餘弦相似度與 10% 的曲目資料分數。缺少音訊配對時，曲目資料占 100%。兩首的時長都已知時，再用毫秒計算「較短時長 ÷ 較長時長」並乘上前述分數。同一 Spotify 曲目重複出現在歌單、時長一致時也會得到 100%。

歌單中的重複曲目會顯示各自的位置。從相似結果移除一個收藏版本後，視窗會列出這組仍在收藏的其他版本。

## Spotify 應用程式設定

預設沿用專案的公開 Client ID。可以在專案根目錄的 `.env` 設定 `SPOTIFY_CLIENT_ID` 來使用自己的 Spotify App。到 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 為 App 選擇 Web API 和 Web Playback SDK，將 Redirect URI 設成 `http://127.0.0.1:8888/callback`。Development Mode 的 App 擁有者需有 Premium，其他使用者須加入該 App 的允許清單。

網頁播放需要 Spotify Premium 與支援加密媒體的瀏覽器。連線 Spotify 後，按底部的播放鍵會從目前列表第一首可播放曲目開始，也可在列表中指定起播歌曲。歌單依 Spotify 歌單順序播放，全部收藏一次最多排入所選歌曲及後續 99 首可播放歌曲。

## 開發

```sh
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
```

開發時 Vite 使用 `127.0.0.1:8888`，將 API 和 OAuth 回呼代理到 Fastify 的 `127.0.0.1:8765`。打包後由 Fastify 同時提供 React 網頁與 API。

要用範例資料查看網頁，可以在兩個終端機分別執行以下指令，再開啟同一個本機網址。

```sh
node apps/frontend/mock-server.mjs
pnpm dev:frontend
```

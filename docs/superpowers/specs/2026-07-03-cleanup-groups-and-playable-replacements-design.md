# 設計:清理群組並列檢視 + 可播放的替代搜尋

日期:2026-07-03
狀態:已核可(brainstorming 完成)

## 背景與問題

兩個使用者需求:

1. **清理建議無從人工驗證。** 「清理」分頁只列出被移除的那首歌的名稱/歌手/理由,但判定為重複的「保留方」資訊完全沒有顯示。使用者無法檢查兩首是否真的重複,發現誤判時也只能整批不執行。
2. **「尋找替代」找出的歌曲不保證可播放。** `ReplaceDialog` 的搜尋結果沒有過濾掉在使用者地區同樣不可播放的曲目(可能換到另一個同樣失效的版本),也沒有試聽按鈕可以在替換前確認是對的版本。

現況關鍵事實:

- 後端 `planDeletions` 產出 `{ keep, remove }` 群組,但 `buildCleanup` 攤平成 `CleanupItem { id, name, artist, reason }`,配對關係在契約層丟失。
- 播放基礎設施已齊全:`POST /api/play` → Spotify Connect(需 Premium + 開啟中的 Spotify 播放器),前端 `usePlayTrack` 已被主表使用。
- `searchTracks` 已帶 `market=from_token`,回應本來就含 `is_playable`,目前只是沒讀取。

## 需求決策(已與使用者確認)

- 清理群組要能**勾選排除**:預設全勾,發現誤判可取消勾選該組,一鍵清理只移除勾選中的組。
- 替代搜尋**兩者都要**:過濾不可播放的結果,且每列加試聽鍵。
- 試聽沿用現有 Spotify Connect 播放機制,與主表播放鍵一致。

## 方案選擇

契約形狀採**方案 A:群組契約**(已核可):`CleanupGroup { keep: Track, removals: [{ track, reason }] }`,汰換平面 `CleanupItem`。

- 對照方案 B(平面清單附掛 keptName/keptAlbum 等欄位):反正規化、同組多首時保留方資訊重複、「排除某組」需重建分組,否決。
- 對照方案 C(前端用 tracks 自行重建分組):跨前後端牆複製 domain 邏輯,違反 shared Zod 契約是唯一真相的紀律,否決。

## 設計

### 1. Shared 契約(`packages/shared/src/index.ts`)

```ts
export const CleanupRemovalSchema = z.object({
  track: TrackSchema,   // 完整資訊:專輯、人氣、加入日期、時長、失效狀態、ISRC
  reason: z.string(),
});
export const CleanupGroupSchema = z.object({
  keep: TrackSchema,    // 保留方完整資訊;keep.id 即穩定組 key,不另設 groupId
  removals: z.array(CleanupRemovalSchema).min(1),
});
```

- `LibrarySchema.cleanup`:`CleanupItem[]` → `CleanupGroup[]`。
- `CleanupItemSchema` 移除(唯一消費者是 CleanupView,一併汰換)。
- `SearchResultSchema` 加 `durationMs: z.number().int()`。
- **`reason` 屬於每首被移除的歌而非整組**:同一組可能同時有「已失效,且已有可播放的同名同歌手版本」與「重複(已保留同組人氣最高者)」兩種理由。

### 2. 後端

- `domain/cleanup.ts`:`buildCleanup` 改回傳 `CleanupGroup[]`。它本來就持有 `planDeletions` 的 `{ keep, remove }`,只是先前把 keep 丟棄;理由判斷邏輯不變。
- `adapters/spotify/library.ts` 的 `searchTracks`:
  - 請求 `limit=20`(超抓)→ 過濾 `is_playable === false` → 回傳前 10 筆。
  - `RawSearchTrack` 增讀 `is_playable`、`duration_ms`,映射出 `durationMs`。
  - 比照 `collect` 的 `pager` 模式,`apiJson` 改為可注入參數(預設值為真實實作),讓測試離線可跑。
- 路由與 `LibraryService` 介面不變(型別隨契約更新)。

### 3. 前端 CleanupView(重寫)

- 每組一張卡片:
  - **保留方**一列,綠色「保留」徽章。
  - 每首**移除方**一列,琥珀色理由徽章(理由逐列顯示)。
  - 欄位對齊並列:歌名、歌手、專輯、人氣、加入日期、時長、失效標記 — 差異一眼可辨。
  - **每列都有試聽鍵**(`usePlayTrack`):聽是驗證「真的重複」的最強手段。
- 組層級勾選框,預設全勾。勾選狀態存 Zustand ui store,形狀為「排除集合」`Set<keep.id>`:
  - 切換分頁不丟狀態(CleanupView 隨分頁卸載,local state 會消失,故放 store)。
  - 重新整理收藏後 cleanup 重算,讀取時只認仍存在的組 — 過期排除項自然失效,不需主動清理。
- 頂欄:「找到 N 組重複,已勾選 K 首可移除」;一鍵清理只送勾選中群組的 removal ids;確認對話框顯示組數與首數。

### 4. 前端 ReplaceDialog

- 結果列加試聽鍵(`usePlayTrack`)與時長欄(判斷同版本的關鍵線索)。
- 播放失敗時就地顯示提示:「無法播放:請先開啟 Spotify 播放器(需 Premium)」。目前全 app 播放失敗皆無聲;試聽情境必須有回饋,CleanupView 卡片區同樣處理。
- 空結果文案:「沒有結果(已濾除不可播放的版本)」,讓使用者知道過濾發生過。

### 5. 錯誤處理

- `/api/play` 失敗(404 無作用中裝置等)→ 後端 throw → HTTP 500 → 前端 mutation `isError` → 就地提示。不做重試。
- 搜尋過濾後為空 → 顯示上述空結果文案,不視為錯誤。

### 6. 測試(全部離線,不觸網)

- `domain/cleanup.test.ts`:改斷言群組形狀;新增「同組混合理由」案例(一首失效 + 一首低人氣,理由各自正確)。
- `adapters/spotify/library.test.ts`:`searchTracks` 注入假 fetcher — 驗證不可播放者被濾除、超抓截斷至 10、`durationMs` 映射。
- 前端無測試基建:以 `mock-server.mjs` 手動驗證(cleanup 假資料改群組形狀、search 結果加 `durationMs`,並保留一筆 `is_playable: false` 已被後端濾除的情境不出現於結果)。
- `pnpm typecheck` + `pnpm lint` 守住契約傳播與分層邊界。

## 範圍外(YAGNI)

- 勾選狀態不跨 session 持久化。
- 不做 30 秒 preview 內嵌播放(Spotify 已棄用 preview_url;Connect 播放是本 app 既有路徑)。
- 不動主表 TrackTable 的無聲播放失敗(僅新增的兩處試聽情境加提示)。
- 不提供「組內改保留另一首」的進階操作 — 誤判時取消勾選整組即可。

# Spotify 收藏年鑑

一個整理 Spotify 收藏的**桌面 App**:找出收藏裡**重複**與**已失效**的歌曲,一鍵清理,並可隨時復原。

打開 App、完成 Spotify OAuth 同意頁登入,就能開始整理。

## 怎麼用

1. 打開 App,會跳出 Spotify **OAuth 同意頁**,登入並授權(密碼只在 Spotify 官方頁面輸入)。
2. App 自動載入你的「我的最愛」。
3. 在三個頁籤之間操作:

| 頁籤 | 內容 |
|------|------|
| **全部收藏** | 完整清單(支援上千首的虛擬捲動)。可模糊搜尋(歌名/歌手/專輯)、點欄位排序、逐首播放或刪除、批次刪除選取。 |
| **清理建議** | 同名同歌手(或同 ISRC)的重複歌曲,每組已自動保留最佳的一首(優先保留**可播放**、再依人氣)。一鍵清理其餘,清理前會再確認。 |
| **失效歌曲** | 在你所在地區已無法播放的歌曲。可搜尋並換成可播放的替代版本,或直接移除。 |

每一次刪除/新增都記入**操作歷史**,點右上角「歷史」即可逐筆**復原**。

### 關於隱私

- App 從不要求、也不會看到你的 Spotify 密碼——密碼只在 Spotify 官方 OAuth 登入頁輸入。
- 登入後取得的 refresh token 會以系統金鑰(`safeStorage`)**加密**存在你電腦的 App 資料夾(`spotify_refresh.bin`),不會以明文寫入任何檔案,也不會上傳到任何地方。
- 後端只綁定 `127.0.0.1`(本機),不對外開放。

## 開發

pnpm monorepo,三個 app(`backend` / `desktop` / `frontend`)共用一份 Zod 契約(`packages/shared`)。

```bash
pnpm install          # 安裝(electron / esbuild / better-sqlite3 的原生建置已列入白名單)
pnpm dev              # 前端(Vite :5173)+ Electron 殼層
pnpm test             # 所有套件測試(vitest,全離線)
pnpm typecheck        # 全套件型別檢查
pnpm -r build         # 建置所有套件

# 不需登入就能看 UI:用 mock 後端 + 前端開發伺服器(範例資料)
node apps/frontend/mock-server.mjs 8765   # 一個終端機
pnpm --filter @stm/frontend dev           # 另一個終端機 → http://localhost:5173
```

開發者需在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 建一個 app(APIs 勾 **Web API**),Redirect URI 填 `http://127.0.0.1:8888/callback`(PKCE 規定用 `127.0.0.1`、不可 `localhost`),取得 `client_id` 後填入 `apps/desktop/src/auth.ts` 的 `EMBEDDED_CLIENT_ID`——PKCE 的 client_id 是**公開值、非機密**,直接燒進 build,使用者端零設定。dev/CI 可用環境變數 `SPOTIFY_CLIENT_ID` 覆蓋。

架構與設計細節(OAuth PKCE 登入流程、型別/建置注意事項)見 [CLAUDE.md](./CLAUDE.md)。

### 技術堆疊

- **後端** Fastify · OAuth Authorization Code + PKCE(refresh token 刷新 access token)· 官方 Web API · better-sqlite3 操作紀錄。純函式的去重核心,離線測試。
- **桌面殼層** Electron(PKCE 登入 → refresh token `safeStorage` 加密 → 以環境變數傳給後端子行程)。
- **前端** React 19 · Vite · Tailwind v4 · TanStack Query/Virtual · Zustand · fuzzysort · Radix UI。

## 讓其他人使用自己的 Spotify

`client_id` 代表**這個 App**(身分固定一個),不代表帳號;**帳號是每個使用者登入時各自決定的**——別人開同一個 App、用自己的 Spotify 登入,操作的就是自己的收藏。架構上完全支援多使用者,程式不用改;每個人的 token 各自加密存在自己電腦的 `spotify_refresh.bin`。

唯一限制來自 Spotify 政策:新註冊的 app 預設是 **Development 模式**,只有你在 Dashboard → 你的 app → **User Management** 手動加入的帳號(最多 **25** 個,以對方 Spotify email 加入)能授權登入;未加入者會在同意頁被擋。

- **小範圍(你 + 朋友,≤25 人)**:到 Dashboard 把對方 email 加進 User Management 即可。
- **公開給任何人**:向 Spotify 申請 **Extended Quota 模式**(需審核),通過後免 allowlist、不限人數。

App 內「**帳號 → 重新登入 / 切換帳號**」選單可清除目前 token、換另一個帳號登入。

## 注意事項

- 播放功能需 **Spotify Premium** 且有開著的播放裝置(手機/桌面 App)。
- 刪除會即時反映在你的 Spotify 收藏,但都可從「歷史」復原。
- `spotify_refresh.bin`、`.env`、`stm_history.db` 等都已列入 `.gitignore`,請勿提交。

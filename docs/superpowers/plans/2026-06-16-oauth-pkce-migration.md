# OAuth PKCE 遷移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Spotify 授權從會被反濫用封鎖的 `sp_dc + TOTP web-player token + Pathfinder` 改成官方 Authorization Code + PKCE,並移除 Pathfinder 加值(playcount / 中文名),核心功能全走官方 Web API。

**Architecture:** 兩階段。Phase 1 先移除 Pathfinder 與 `playcount`(純程式碼、可離線測試、降低濫用訊號)。Phase 2 把 token 來源換成 OAuth:桌面端用 PKCE + `127.0.0.1` loopback 接 redirect、換 refresh token 並加密存放;後端用 refresh token + client_id 在 API 呼叫時刷新 access token。token rotation 透過 fork IPC 回傳桌面端持久化。

**Tech Stack:** Electron 33 (main/preload, CJS via esbuild)、Fastify backend、React 19 + Vite frontend、Zod 契約 `@stm/shared`、Vitest。

**Prerequisite(只有使用者能做,與 Phase 1 並行):** 到 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 建一個 app → APIs 勾 **Web API** → Redirect URI 填 `http://127.0.0.1:8888/callback` → 取得 `client_id`。dev 階段把它與一組 refresh token 放進 `apps/backend/.env`(見 Task 12)。封鎖未退時 Phase 2 的端到端登入測試需等 24h 冷卻。

---

## Phase 1 — 移除 Pathfinder 與 playcount

### Task 1: 從契約移除 `playcount`

**Files:**
- Modify: `packages/shared/src/index.ts:4-18`

- [ ] **Step 1: 移除 schema 欄位**

把 `TrackSchema` 的這兩行刪掉:
```ts
  /** Total play count from the unofficial Pathfinder API; null when unavailable. */
  playcount: z.number().int().nullable(),
```
並把第 3 行註解 `enriched via Pathfinder` 改為 `from the official Web API`。

- [ ] **Step 2: build shared 驗證型別**

Run: `pnpm --filter @stm/shared build`
Expected: PASS(無型別錯誤)。後續 typecheck 會抓出所有引用點。

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "refactor(shared): 移除 Track.playcount 欄位"
```

### Task 2: 後端 normalize / fixtures 移除 playcount

**Files:**
- Modify: `apps/backend/src/spotify/normalize.ts:53`
- Modify: `apps/backend/src/core/fixtures.ts:19`

- [ ] **Step 1: 移除 normalize 的 playcount**

刪掉 `apps/backend/src/spotify/normalize.ts` 第 53 行 `playcount: null, // enriched later by the Pathfinder pass`。

- [ ] **Step 2: 移除 fixtures 的 playcount**

刪掉 `apps/backend/src/core/fixtures.ts` 第 19 行 `playcount: null,`,並把第 4 行註解的 `all 12 fields` 改成 `all fields`。

- [ ] **Step 3: 跑 backend 測試**

Run: `pnpm --filter @stm/backend test`
Expected: PASS(pathfinder.test.ts 仍存在會失敗 → 下一個 Task 移除)。若只想先驗 normalize:`pnpm --filter @stm/backend test -- src/spotify/normalize.test.ts`,Expected: PASS。

### Task 3: 刪除 Pathfinder 模組

**Files:**
- Delete: `apps/backend/src/spotify/pathfinder.ts`
- Delete: `apps/backend/src/spotify/pathfinder.test.ts`

- [ ] **Step 1: 刪檔**

```bash
git rm apps/backend/src/spotify/pathfinder.ts apps/backend/src/spotify/pathfinder.test.ts
```

- [ ] **Step 2: Commit(Task 2+3 一起)**

```bash
git add -A
git commit -m "refactor(backend): 移除 Pathfinder 加值與 playcount"
```

### Task 4: library-service 去掉 Phase 2 enrichment

**Files:**
- Modify: `apps/backend/src/library-service.ts`
- Modify: `apps/frontend/src/lib/api.ts:13-21`(對應前端型別,Task 8 也會動)

- [ ] **Step 1: 改寫 library-service**

整個檔案改為(移除 `enrichInBackground`、`enrichTracks`/`applyEnrichmentInPlace` import、`buildId`、enriching 欄位):
```ts
import type { Library, Track } from "@stm/shared";
import { buildCleanup } from "./core/cleanup";
import { fetchSavedTracks } from "./spotify/library";

// In-memory cache of the fetched library + its cleanup plan. The official Web API
// gives everything the app needs (name/artists/isrc/popularity/is_playable), so
// there is no background enrichment pass — one fetch builds the whole snapshot.

export interface LibrarySnapshot extends Library {
  fetchedAt: string;
}

let cache: LibrarySnapshot | null = null;
let inFlight: Promise<LibrarySnapshot> | null = null;

async function build(now: string): Promise<LibrarySnapshot> {
  const tracks = await fetchSavedTracks();
  const snapshot: LibrarySnapshot = { tracks, cleanup: buildCleanup(tracks), fetchedAt: now };
  cache = snapshot;
  return snapshot;
}

/** Return the cached library, building it once if needed. Concurrent first calls share the fetch. */
export async function getLibrary(now: string, force = false): Promise<LibrarySnapshot> {
  if (cache && !force) return cache;
  if (force) cache = null;
  if (!inFlight) {
    inFlight = build(now).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Drop tracks from the cached snapshot after a successful delete, without a refetch. */
export function applyLocalDelete(ids: string[]): void {
  if (!cache) return;
  const removed = new Set(ids);
  const tracks = cache.tracks.filter((t: Track) => !removed.has(t.id));
  cache = { ...cache, tracks, cleanup: buildCleanup(tracks) };
}

export function invalidateLibrary(): void {
  cache = null;
}
```

- [ ] **Step 2: typecheck backend**

Run: `pnpm --filter @stm/backend typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/library-service.ts
git commit -m "refactor(backend): library 快照不再做背景 enrichment"
```

### Task 5: 前端移除 enriching 與 playcount 顯示

**Files:**
- Modify: `apps/frontend/src/lib/api.ts:13-21`
- Modify: `apps/frontend/src/hooks/useLibrary.ts:43`
- Modify: `apps/frontend/src/App.tsx`(Footer、loading 文案)
- Modify: `apps/frontend/src/components/TrackTable.tsx`(GRID/COLUMNS/Row/import)
- Modify: `apps/frontend/src/hooks/useVisibleTracks.ts:41-42`
- Modify: `apps/frontend/src/store/ui.ts:9`
- Modify: `apps/frontend/src/lib/format.ts:5-6`

- [ ] **Step 1: `lib/api.ts` 精簡 snapshot 型別**

把 `LibrarySnapshot`(13-21 行)改為:
```ts
export interface LibrarySnapshot {
  tracks: Track[];
  cleanup: CleanupItem[];
  fetchedAt: string;
}
```

- [ ] **Step 2: `useLibrary.ts` 移除 enriching 輪詢**

把第 43 行 `refetchInterval: (q) => (q.state.data?.enriching ? 4000 : false),` 整行刪掉(連同上方提到 enriching 的註解);`useLibrary` 的 `useQuery` 保留 `staleTime: Infinity`。

- [ ] **Step 3: `store/ui.ts` 移除 playcount sort key**

第 9 行 `export type SortKey = "added" | "name" | "artist" | "playcount" | "popularity";` 改為:
```ts
export type SortKey = "added" | "name" | "artist" | "popularity";
```

- [ ] **Step 4: `useVisibleTracks.ts` 移除 playcount 比較**

刪掉 `compare` 內這兩行:
```ts
    case "playcount":
      return (a.playcount ?? -1) - (b.playcount ?? -1);
```

- [ ] **Step 5: `format.ts` 移除 formatPlaycount**

刪掉第 5-6 行(`formatPlaycount` 的註解與宣告)。

- [ ] **Step 6: `TrackTable.tsx` 移除播放次數欄**

(a) import 由 `import { formatDate, formatDuration, formatPlaycount } from "../lib/format";` 改為 `import { formatDate, formatDuration } from "../lib/format";`
(b) `GRID` 移除播放次數欄寬(把 `... 96px 84px ...` 的 `96px ` 拿掉):
```ts
const GRID =
  "36px 32px minmax(200px,2.4fr) minmax(130px,1.6fr) minmax(120px,1.4fr) 84px 112px 60px 36px";
```
(c) `COLUMNS` 移除 `{ key: "playcount", label: "播放次數", align: "right" },` 整行。
(d) Row 移除 `<div className="nums text-right text-stone-600">{formatPlaycount(track.playcount)}</div>` 整行。

- [ ] **Step 7: `App.tsx` 移除 Footer enriching、改 loading 文案**

(a) 第 60 行載入文案 `正在載入你的收藏…(含播放次數與中文歌名,首次需要一點時間)` 改為 `正在載入你的收藏…`。
(b) 把 `Footer` 元件(144-173 行)整個改為只顯示更新時間:
```tsx
function Footer({ snap }: { snap: { fetchedAt: string } }) {
  return (
    <footer className="mt-2 flex items-center gap-4 pt-2 text-xs text-stone-400">
      <span>更新於 {snap.fetchedAt.slice(0, 16).replace("T", " ")}</span>
    </footer>
  );
}
```
(c) 確認 `{snap && <Footer snap={snap} />}`(86 行)仍可編譯(`snap` 型別已是新的精簡 snapshot)。

- [ ] **Step 8: typecheck + 前端 build**

Run: `pnpm --filter @stm/frontend typecheck && pnpm --filter @stm/frontend build`
Expected: PASS,無 `playcount`/`enriching` 殘留引用。

- [ ] **Step 9: Commit**

```bash
git add apps/frontend
git commit -m "refactor(frontend): 移除播放次數欄與 enrichment 進度 UI"
```

### Task 6: 更新 dev mock-server

**Files:**
- Modify: `apps/frontend/mock-server.mjs`

- [ ] **Step 1: 移除 mock 回傳的 playcount / enriching**

把 mock 的 `/api/library` 回應改成只含 `{ tracks, cleanup, fetchedAt }`,每個 track 移除 `playcount`。grep `playcount`、`enriching` 確認無殘留。

- [ ] **Step 2: 全套測試 + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/mock-server.mjs
git commit -m "chore(frontend): mock-server 對齊精簡後的 library 形狀"
```

---

## Phase 2 — OAuth Authorization Code + PKCE

### Task 7: 後端 OAuth refresh 模組(TDD)

**Files:**
- Create: `apps/backend/src/spotify/oauth.ts`
- Test: `apps/backend/src/spotify/oauth.test.ts`

- [ ] **Step 1: 寫失敗測試**

`apps/backend/src/spotify/oauth.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "./oauth";

describe("refreshAccessToken", () => {
  it("POSTs the refresh_token grant with client_id and parses the new token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: "AT", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const set = await refreshAccessToken("CID", "RT", fetchImpl as unknown as typeof fetch);

    expect(set.accessToken).toBe("AT");
    expect(set.expiresInSec).toBe(3600);
    expect(set.refreshToken).toBeNull(); // not rotated this time

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://accounts.spotify.com/api/token");
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("RT");
    expect(body.get("client_id")).toBe("CID");
  });

  it("surfaces a rotated refresh_token when Spotify returns one", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "AT2", expires_in: 3600, refresh_token: "RT2" }), {
        status: 200,
      }),
    );
    const set = await refreshAccessToken("CID", "RT", fetchImpl as unknown as typeof fetch);
    expect(set.refreshToken).toBe("RT2");
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(refreshAccessToken("CID", "RT", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /token refresh failed: 400/,
    );
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm --filter @stm/backend test -- src/spotify/oauth.test.ts`
Expected: FAIL("Cannot find module './oauth'")。

- [ ] **Step 3: 實作 oauth.ts**

```ts
// Authorization Code + PKCE token refresh. Public client: the client_id is enough,
// no client secret. Pure over an injectable fetch so the refresh path is unit-tested
// offline. The interactive code↔token exchange happens in the desktop main process
// (it owns the login window + loopback); this module is only the repeated refresh.
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";

export interface TokenSet {
  accessToken: string;
  expiresInSec: number;
  /** Spotify may rotate the refresh token; null when it returned none (keep the old one). */
  refreshToken: string | null;
}

interface RawTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const data = (await res.json()) as RawTokenResponse;
  if (!data.access_token) throw new Error("no access_token in refresh response");
  return {
    accessToken: data.access_token,
    expiresInSec: data.expires_in ?? 3600,
    refreshToken: data.refresh_token ?? null,
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm --filter @stm/backend test -- src/spotify/oauth.test.ts`
Expected: PASS(3 個測試)。

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/spotify/oauth.ts apps/backend/src/spotify/oauth.test.ts
git commit -m "feat(backend): OAuth refresh_token grant(PKCE public client)"
```

### Task 8: 後端 auth.ts 改用 OAuth refresh

**Files:**
- Modify: `apps/backend/src/spotify/auth.ts`(整檔改寫)
- Delete: `apps/backend/src/spotify/token.ts`
- Delete: `apps/backend/src/spotify/token.test.ts`

- [ ] **Step 1: 改寫 auth.ts**

```ts
import { refreshAccessToken } from "./oauth";

// Holds the OAuth access token, refreshed on demand from the refresh token the
// desktop captured at login (PKCE) and passed via env. Access tokens last ~1h.
// If Spotify rotates the refresh token, hand it back to the main process (via the
// fork IPC channel) so it can be re-persisted for the next launch.

let cached: { token: string; expires: number } | null = null;
let refreshToken: string | undefined = process.env.SPOTIFY_REFRESH_TOKEN || undefined;

function clientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("no SPOTIFY_CLIENT_ID configured");
  return id;
}

export async function accessToken(force = false): Promise<string> {
  if (!refreshToken) throw new Error("no refresh token configured");
  if (!force && cached && cached.expires > Date.now()) return cached.token;
  const set = await refreshAccessToken(clientId(), refreshToken);
  // Refresh a minute early so an in-flight call never races the expiry.
  cached = { token: set.accessToken, expires: Date.now() + (set.expiresInSec - 60) * 1000 };
  if (set.refreshToken && set.refreshToken !== refreshToken) {
    refreshToken = set.refreshToken;
    process.send?.({ type: "refresh_token", value: set.refreshToken });
  }
  return set.accessToken;
}
```

- [ ] **Step 2: 刪除舊 TOTP token 模組**

```bash
git rm apps/backend/src/spotify/token.ts apps/backend/src/spotify/token.test.ts
```

- [ ] **Step 3: backend 測試 + typecheck**

Run: `pnpm --filter @stm/backend test && pnpm --filter @stm/backend typecheck`
Expected: PASS(api.ts 已用 `accessToken()`,簽名不變)。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(backend): access token 改由 OAuth refresh 取得,移除 TOTP"
```

### Task 9: 桌面端 PKCE 登入流程

**Files:**
- Modify: `apps/desktop/src/auth.ts`(整檔改寫)

- [ ] **Step 1: 改寫 auth.ts 為 OAuth PKCE**

```ts
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { app, BrowserWindow, safeStorage } from "electron";

// OAuth Authorization Code + PKCE. We open Spotify's real consent page in a window,
// catch the redirect on a 127.0.0.1 loopback server, exchange the code for tokens,
// and store the refresh token encrypted (safeStorage). No sp_dc, no client secret.

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = [
  "user-library-read",
  "user-library-modify",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

const tokenFile = (): string => path.join(app.getPath("userData"), "spotify_refresh.bin");

export function clientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("SPOTIFY_CLIENT_ID is not set");
  return id;
}

function readStored(): string | null {
  try {
    return safeStorage.decryptString(fs.readFileSync(tokenFile()));
  } catch {
    return null;
  }
}
export function storeRefreshToken(value: string): void {
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(value));
}
export function clearTokens(): void {
  try {
    fs.unlinkSync(tokenFile());
  } catch {
    /* nothing to clear */
  }
}

const base64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function exchangeCode(code: string, verifier: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId(),
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`code exchange failed: ${res.status}`);
  const data = (await res.json()) as { refresh_token?: string };
  if (!data.refresh_token) throw new Error("no refresh_token in exchange response");
  return data.refresh_token;
}

function loginFlow(): Promise<string> {
  const { verifier, challenge } = pkcePair();
  const state = base64url(crypto.randomBytes(16));
  const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    state,
  })}`;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindow({ width: 480, height: 760, title: "登入 Spotify", autoHideMenuBar: true });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2 style='font-family:sans-serif'>登入完成,請回到 App。</h2>");
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      finish(
        error ? Promise.reject(new Error(`authorize error: ${error}`))
        : gotState !== state ? Promise.reject(new Error("state mismatch"))
        : !code ? Promise.reject(new Error("no code in callback"))
        : exchangeCode(code, verifier),
      );
    });

    function cleanup(): void {
      server.close();
      if (!win.isDestroyed()) win.close();
    }
    function finish(p: Promise<string>): void {
      if (settled) return;
      settled = true;
      p.then((rt) => {
        storeRefreshToken(rt);
        cleanup();
        resolve(rt);
      }).catch((err) => {
        cleanup();
        reject(err);
      });
    }

    server.on("error", (err) => finish(Promise.reject(err)));
    server.listen(REDIRECT_PORT, "127.0.0.1", () => void win.loadURL(authUrl));
    win.on("closed", () => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("login window closed before authorization"));
      }
    });
  });
}

/** Return a stored refresh token, or run the OAuth login to capture and persist one. */
export async function ensureRefreshToken(): Promise<string> {
  const stored = readStored();
  if (stored) return stored;
  return loginFlow();
}
```

- [ ] **Step 2: typecheck desktop**

Run: `pnpm --filter @stm/desktop typecheck`
Expected: 會在 `main.ts` / `backend.ts` 報 `ensureSpDc` 已不存在 → 下兩個 Task 修。先確認 auth.ts 本身無誤可暫時跳過,或直接接著做 Task 10/11 再一起 typecheck。

### Task 10: 桌面端 backend.ts 傳 OAuth token + 保留 IPC

**Files:**
- Modify: `apps/desktop/src/backend.ts`

- [ ] **Step 1: 改寫 startBackend 簽名與 env、保留 fork IPC、persist 旋轉的 refresh token**

把 `startBackend`/`stopBackend` 改為:
```ts
import { type ChildProcess, fork } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import { storeRefreshToken } from "./auth";

let child: ChildProcess | null = null;

function serverPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "backend", "server.cjs")
    : path.join(__dirname, "../../backend/dist/server.cjs");
}

export function startBackend(clientId: string, refreshToken: string, port: number): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPOTIFY_CLIENT_ID: clientId,
    SPOTIFY_REFRESH_TOKEN: refreshToken,
    PORT: String(port),
    STM_DB_PATH: path.join(app.getPath("userData"), "stm_history.db"),
  };
  const options = app.isPackaged
    ? { env: { ...env, ELECTRON_RUN_AS_NODE: "1" } }
    : { env, execPath: process.env.npm_node_execpath || "node" };

  // Keep an IPC channel (4th stdio slot) so the backend can hand back a rotated
  // refresh token; windowsHide stops the dev system-Node spawning a console window.
  child = fork(serverPath(), [], {
    ...options,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    windowsHide: true,
  });
  child.on("message", (msg: { type?: string; value?: string }) => {
    if (msg?.type === "refresh_token" && msg.value) storeRefreshToken(msg.value);
  });
}

export function stopBackend(): void {
  child?.kill();
  child = null;
}
```

- [ ] **Step 2: Commit(Task 9+10)**

```bash
git add apps/desktop/src/auth.ts apps/desktop/src/backend.ts
git commit -m "feat(desktop): PKCE 登入 + 後端改吃 client_id/refresh token"
```

### Task 11: 桌面端 main.ts 串接 + 重新登入選單

**Files:**
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: 改 whenReady 串接、加「帳號→重新登入」選單**

```ts
import path from "node:path";
import { app, BrowserWindow, Menu } from "electron";
import { clientId, clearTokens, ensureRefreshToken } from "./auth";
import { startBackend, stopBackend } from "./backend";

const DEV_URL = "http://localhost:5173";
const PORT = 8765;
const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: "#f6f1e7",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  if (isDev) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(process.resourcesPath, "frontend", "index.html"));
}

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "帳號",
        submenu: [{ label: "重新登入 / 切換帳號", click: () => void relogin() }],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

async function relogin(): Promise<void> {
  try {
    stopBackend();
    clearTokens();
    const refreshToken = await ensureRefreshToken(); // opens the OAuth login window
    startBackend(clientId(), refreshToken, PORT);
    mainWindow?.webContents.reload();
  } catch (err) {
    console.error("relogin failed:", err);
  }
}

void app.whenReady().then(async () => {
  try {
    const refreshToken = await ensureRefreshToken(); // OAuth login if no stored token
    startBackend(clientId(), refreshToken, PORT);
  } catch (err) {
    console.error("login/backend startup failed:", err);
    app.quit();
    return;
  }
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 2: desktop typecheck + build**

Run: `pnpm --filter @stm/desktop typecheck && pnpm --filter @stm/desktop build`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat(desktop): 串接 OAuth 登入並加重新登入選單"
```

### Task 12: dev 設定與文件

**Files:**
- Modify: `apps/backend/.env`(本機,gitignored)
- Modify: `CLAUDE.md`(更新 auth flow 段落)
- Modify: `README.md`(更新登入說明)

- [ ] **Step 1: dev `.env`**

`apps/backend/.env`(不進版控)放:
```
SPOTIFY_CLIENT_ID=<你的 client_id>
SPOTIFY_REFRESH_TOKEN=<一次性手動取得的 refresh token,見下>
```
standalone backend dev 用;Electron dev 走完整 PKCE 登入後 `SPOTIFY_REFRESH_TOKEN` 由桌面端自動帶入,不必手填(此 .env 僅供不開 Electron、直接 `pnpm --filter @stm/backend dev` 時用)。

- [ ] **Step 2: 更新 CLAUDE.md 的 auth flow 段**

把「The auth flow」與架構段落中 `sp_dc` / TOTP / Pathfinder 的描述改為 OAuth PKCE:桌面端 `auth.ts` 跑 PKCE + 127.0.0.1 loopback 取 refresh token(safeStorage 加密存 `spotify_refresh.bin`),後端 `oauth.ts` 用 refresh token + `SPOTIFY_CLIENT_ID` 刷新 access token;移除 Pathfinder 與 playcount。

- [ ] **Step 3: 全套驗證**

Run: `pnpm test && pnpm typecheck && pnpm -r build`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: 更新為 OAuth PKCE 授權流程"
```

### Task 13: 端到端登入(需 client_id,且封鎖已退)

- [ ] **Step 1:** 確認 `apps/backend/.env` 有 `SPOTIFY_CLIENT_ID`(Electron dev 不需 refresh token)。
- [ ] **Step 2:** `pnpm dev` → 桌面端跳出 Spotify **真正的 OAuth 同意頁** → 登入 + 同意。
- [ ] **Step 3:** 視窗回到 App,ConnectionPill 顯示使用者名稱、product;收藏載入、重複/失效分頁正常。
- [ ] **Step 4:** 測「帳號 → 重新登入」可清掉 token 並重跑登入。
- [ ] **Step 5:** 觀察數分鐘無 429(官方限流正常情況下不該出現)。

---

## Self-Review 註記

- **Spec 覆蓋:** 決策(改 OAuth PKCE、拿掉 playcount/中文名)→ Phase 2 / Phase 1 全覆蓋;恢復路徑(原始需求)→ Task 11 重新登入選單。
- **型別一致:** `refreshAccessToken`/`TokenSet`(Task 7)→ `auth.ts`(Task 8)使用;`storeRefreshToken`/`clearTokens`/`clientId`/`ensureRefreshToken`(Task 9)→ `backend.ts`(Task 10)/`main.ts`(Task 11)使用,名稱一致。
- **已知限制:** desktop 的 Electron glue(登入視窗/loopback)無單元測試,依 Task 13 互動驗證(與原 sp_dc 流程相同慣例);packaging 後的 ABI rebuild 與首次真實登入無法 headless 驗證。

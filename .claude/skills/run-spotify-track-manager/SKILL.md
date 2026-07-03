---
name: run-spotify-track-manager
description: Run, build, screenshot, or drive the Spotify Track Manager desktop app (Electron + Fastify + React monorepo). Use when asked to start the app, see the UI, take a screenshot, or smoke-test the frontend/backend.
---

# Run Spotify Track Manager

A pnpm monorepo desktop app: `apps/backend` (Fastify, 127.0.0.1 only), `apps/desktop`
(Electron shell), `apps/frontend` (React + Vite). The real app needs an interactive
Spotify OAuth login (PKCE) to fetch data, so the **agent-drivable path is the frontend
driven by the mock backend** — `apps/frontend/mock-server.mjs` (committed) serves the
real `/api/*` contract with sample data that exercises every view. Drive the UI at
`http://localhost:5173` with a browser tool (Playwright MCP verified).

All paths are relative to the repo root. Verified on Windows via Git Bash
(Node 25, pnpm 10) — use the Bash tool, not PowerShell, for node commands.

## Prerequisites

```bash
pnpm install     # electron / esbuild / better-sqlite3 build scripts are allow-listed
```

Node ≥ 22 (the backend uses `process.loadEnvFile`).

## Build / verify (no app launch needed)

```bash
pnpm typecheck        # tsc --noEmit across all packages (exit 0)
pnpm test             # 63 vitest tests (all in apps/backend), fully offline (exit 0)
pnpm -r build         # esbuild backend+desktop bundles, vite frontend build
```

## Run — agent path (mock backend + Vite + browser)

Start two background processes (Bash tool `run_in_background`, or append `&`):

```bash
node apps/frontend/mock-server.mjs 8765      # mock backend (default port is also 8765)
pnpm --filter @stm/frontend dev              # Vite :5173, proxies /api → 127.0.0.1:8765
```

Wait until it answers, then sanity-check the proxy:

```bash
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:5173/ && break; sleep 0.5; done
curl -s http://localhost:5173/api/status    # {"connected":true,"user":"示範使用者","product":"premium"}
curl -s http://localhost:5173/api/library | head -c 120
```

Then drive `http://localhost:5173`. All interactions below were exercised with the
Playwright MCP (targets are ARIA roles/names; tab names include the count badge,
e.g. button `清理建議 3` — partial name match works):

- **Tabs**: buttons `全部收藏 24` / `清理建議 3` / `失效歌曲 3`.
- **Search**: fill textbox `搜尋歌曲、歌手、專輯…` with `周杰倫` → counter drops
  `24 首` → `4 首` (fuzzy-filters the virtual table). Fill `""` to clear.
- **清理建議**: 3 groups rendered keep/remove side-by-side (`保留` vs `移除·重複`
  badges, per-row `試聽` button). Each group has a checkbox named like
  `起風了 — 買辣椒也用券 2 個版本`; unchecking it drops the button from
  `一鍵清理 (3)` to `一鍵清理 (2)`. Clicking it opens the Radix dialog `確認清理`;
  `確認移除 2 首` POSTs and closes.
- **失效歌曲**: 3 rows, each with `尋找替代` + `移除`. `尋找替代` opens dialog
  `尋找替代版本` with the query prefilled (e.g. `她說 林俊傑`); results show
  duration (`4:14`) with per-row `試聽` and `替換`.
- **歷史** (header button): dialog `操作歷史` — per-batch `復原` buttons; already
  undone batches show `已復原`.

The mock serves `GET /api/status`, `/api/library` (tracks **and** cleanup groups),
`/api/history`, `/api/search`, `/health`; **every POST returns `{ok:true,...}` and
mutates nothing** — destructive buttons are safe to click, and the data is static
(after "confirming" a cleanup, the refetch shows the same groups again).

Reference screenshots taken this way live in this skill dir: `screenshot.png`
(全部收藏) and `screenshot-cleanup.png` (清理建議 keep/remove view).

## Run — real backend standalone (no GUI, no login)

Smoke-tests the composition-root wiring after `pnpm -r build`:

```bash
PORT=8799 STM_DB_PATH="$TMPDIR/stm-smoke.db" node apps/backend/dist/server.cjs   # background
curl -s http://127.0.0.1:8799/health        # {"ok":true}
curl -s http://127.0.0.1:8799/api/status    # {"connected":false,"error":"Error: no refresh token configured"}
```

That `/api/status` error is the backend degrading gracefully without a Spotify
refresh token — not a crash.

## Run — human path (the real Electron app)

```bash
pnpm dev    # concurrently: Vite :5173 + Electron shell
```

On first run a Spotify OAuth consent window opens (PKCE); the refresh token is
stored encrypted via `safeStorage`. **Requires a human to log in — cannot be done
headless, and never handle the user's password or tokens** (see CLAUDE.md).

## Gotchas

- **Vite port is strict (5173) and the dev-server process outlives its wrapper.**
  `strictPort: true` — if 5173 is taken the next run exits. Killing the `pnpm dev`
  wrapper (or the background task) leaves the Vite node child listening. Find and
  kill it:

  ```bash
  netstat -ano | grep ":5173 .*LISTEN"    # → PID in the last column
  taskkill //PID <pid> //F                # Git Bash needs the doubled slashes
  ```

- **`favicon.ico` 404** in the browser console is the only expected console error —
  noise, not a failure.
- **Playwright MCP output paths**: `browser_take_screenshot` with a relative
  filename writes to the **repo root** (its cwd); page snapshots go to
  `.playwright-mcp/` (gitignored). Move screenshots where you need them.
- **better-sqlite3 is native.** Loads fine under plain Node (dev / tests /
  standalone backend). The packaged Electron app needs the electron-rebuild step
  that `pnpm dist` runs (`rebuild:native`) — packaging + installer can't be
  verified headless.
- **Don't set `module: CommonJS` in a package tsconfig.** The base config uses
  `verbatimModuleSyntax`, which is incompatible with it; esbuild emits the CJS.
- **CJK fonts.** The display font is Latin-only; Chinese names fall back to the
  system CJK font (JhengHei/PingFang/Noto). Expected.

## Troubleshooting

- `pnpm dev` does nothing visible headless → that's the human path; use the agent
  path (mock + vite + browser) instead.
- Proxy 502 / ECONNREFUSED on `/api/*` → the mock backend (or real backend) on 8765
  isn't running; start it first.
- `node --version` prints **nothing** in PowerShell on this machine (nvm4w shim
  quirk) while pnpm works → run node commands through Git Bash (the Bash tool).
- Electron binary missing after install → ensure `electron` is in the root
  `pnpm.onlyBuiltDependencies`, then re-run `pnpm install`.

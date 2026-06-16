---
name: run-spotify-track-manager
description: Run, build, screenshot, or drive the Spotify Track Manager desktop app (Electron + Fastify + React monorepo). Use when asked to start the app, see the UI, take a screenshot, or smoke-test the frontend/backend.
---

# Run Spotify Track Manager

A pnpm monorepo desktop app: `apps/backend` (Fastify, 127.0.0.1), `apps/desktop`
(Electron shell), `apps/frontend` (React + Vite). The real app needs an interactive
Spotify login to fetch data, so the **agent-drivable path is the frontend driven by
a mock backend** — no login, no cookie, sample data that exercises every view.

All paths below are relative to the repo root.

## Prerequisites

```bash
pnpm install     # electron / esbuild / better-sqlite3 native builds are allow-listed
```

Node ≥ 22 (the backend uses `process.loadEnvFile`).

## Build / verify (no app launch needed)

```bash
pnpm typecheck        # tsc --noEmit across all packages (exit 0)
pnpm test             # 63 vitest tests, fully offline (exit 0)
pnpm -r build         # esbuild backend+desktop bundles, vite frontend build
```

## Run — agent path (drive + screenshot the UI)

Two background processes, then drive with a browser tool. This is exactly what was
used to verify every view:

```bash
# 1. Mock backend with sample data (duplicates, dead tracks, zh-TW names, playcounts)
node apps/frontend/mock-server.mjs 8765 &

# 2. Frontend dev server (Vite proxies /api → 127.0.0.1:8765)
pnpm --filter @stm/frontend dev &

# 3. Wait until it answers, then it's drivable at http://localhost:5173
until curl -sf -o /dev/null http://localhost:5173/; do sleep 0.5; done
curl -s http://localhost:5173/api/library | head -c 80   # sanity: proxied sample data
```

Then drive `http://localhost:5173` with Playwright/chromium-cli (or the Playwright
MCP). Verified interactions:

- Tabs: `button:has-text("全部收藏")`, `"清理建議"`, `"失效歌曲"`.
- Search: type into `input[placeholder*="搜尋"]` → fuzzy-filters the virtual table.
- One-click cleanup: `button:has-text("一鍵清理")` → Radix confirm dialog.
- Find replacement: on 失效歌曲, `button:has-text("尋找替代")` (one per row) → search dialog.
- History: `button:has-text("歷史")` → op-log with per-batch 復原.

The mock serves `/api/status`, `/api/library`, `/api/history`, `/api/search`; POSTs
return `{ok:true}` (no real mutation), so destructive buttons are safe to click.

## Run — human path (the real Electron app)

```bash
pnpm dev    # concurrently: Vite :5173 + Electron shell
```

A login window opens; the user logs into their own Spotify account. The app captures
the `sp_dc` cookie, encrypts it via `safeStorage`, forks the backend with it, and
loads the real library. **Requires a human to log in — cannot be done headless, and
never handle the user's password or the raw cookie.**

## Gotchas

- **Vite port is strict (5173).** `strictPort: true` — if 5173 is taken the dev
  server exits instead of picking another port. Kill the stale process first.
- **Real data needs login; the mock does not.** `/api/status` without a cookie
  returns `{connected:false, error:"no sp_dc configured"}` — that's the backend
  degrading gracefully, not a crash. The frontend then shows "尚未連線".
- **better-sqlite3 is native.** It loads fine under Node for dev/tests, but the
  packaged Electron app needs `electron-rebuild` (different ABI under
  `ELECTRON_RUN_AS_NODE`). Not yet wired into packaging.
- **fuzzysort v3.** Search uses `fuzzysort.go(query, prepared, {keys})`; the v2
  `single()` API is gone. Targets are pre-`prepare`d once for speed over 1700 rows.
- **Don't set `module: CommonJS` in a package tsconfig.** The base config uses
  `verbatimModuleSyntax`, which is incompatible with it; esbuild emits the CJS.
- **CJK fonts.** The Fraunces display font is Latin-only; Chinese names fall back to
  the system CJK font (JhengHei/PingFang/Noto). That's expected.

## Troubleshooting

- `pnpm dev` does nothing visible headless → that's the human path; use the agent
  path (mock + vite + browser) instead.
- Proxy 502 / ECONNREFUSED on `/api/*` → the mock backend (or real backend) on 8765
  isn't running; start it first.
- Electron binary missing after install → ensure `electron` is in the root
  `pnpm.onlyBuiltDependencies`, then re-run `pnpm install`.

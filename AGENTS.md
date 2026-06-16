# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

Spotify Track Manager is a **desktop app** (Electron) that scans a Spotify library for duplicate / dead tracks and cleans them up — built for non-developers, so there is **no `client_id`, no OAuth, no manual cookie/F12**. The user logs into Spotify in an embedded window; the app captures the `sp_dc` cookie and mints a web-player token from it. A pnpm monorepo with three apps (`backend`, `desktop`, `frontend`) over a shared Zod contract.

## Commands

```bash
pnpm install                       # workspace install (electron/esbuild build scripts are allow-listed)
pnpm -r build                      # build every package (esbuild backend + main/preload, vite frontend)
pnpm test                          # all package tests (vitest — fully offline, no network/Spotify)
pnpm typecheck                     # tsc --noEmit across all packages
pnpm dev                           # frontend (vite :5173) + electron shell, concurrently

# Single package / single test
pnpm --filter @stm/backend test
pnpm --filter @stm/backend test -- src/core/detect.test.ts
pnpm --filter @stm/backend bundle  # esbuild → apps/backend/dist/server.cjs
```

`packageManager` is pinned to pnpm; Node ≥ 22 (uses `process.loadEnvFile`). Root `package.json` lists `electron` and `esbuild` under `pnpm.onlyBuiltDependencies` — pnpm 10 ignores build scripts otherwise, and the electron binary never downloads.

## The auth flow (the reason this is an Electron app)

A normal browser cannot read Spotify's httpOnly `sp_dc` cookie (Chrome app-bound encryption defeats `browser_cookie3`). Electron's `session.cookies.get` can. The chain:

1. `apps/desktop/src/auth.ts` — opens a login `BrowserWindow`, polls `session.defaultSession.cookies.get({name:"sp_dc"})`, stores the value **encrypted** via `safeStorage` at `userData/sp_dc.bin`. Never written in plaintext.
2. `apps/desktop/src/backend.ts` — forks `apps/backend/dist/server.cjs` (via `ELECTRON_RUN_AS_NODE`), passing the decrypted `sp_dc` through the **process env** (`SP_DC`), not a file or CLI arg.
3. `apps/backend/src/spotify/token.ts` — `sp_dc` + a reverse-engineered **TOTP** → `GET open.spotify.com/api/token` → a web-player access token that works on both the official Web API and the unofficial Pathfinder GraphQL API. No `client_id` anywhere.

**Hard security rules:** never put `sp_dc` (or any token) on a command line, in a tool-written file, or anywhere in the transcript/logs. Never ask for or handle the user's Spotify password — only they can complete the interactive login.

## Architecture

The discipline is **pure logic isolated from I/O so it unit-tests offline**. All cross-process data shapes are Zod schemas in `packages/shared` (`@stm/shared`) — the single contract between backend and frontend.

- **`apps/backend`** (Fastify, bound to `127.0.0.1` only):
  - `spotify/token.ts` — TOTP (HMAC-SHA1, 30s, 6 digits), secret fetched at runtime from an auto-updated source with a hardcoded fallback (it rotates every few days). Pinned against an RFC 6238 vector in `token.test.ts`.
  - `spotify/auth.ts` / `api.ts` — token caching (~50 min) and the official Web API wrapper (`api`/`apiJson`, retries once on 401 with a fresh token).
  - `spotify/normalize.ts` — `trackFromItem`: Spotify's nested JSON → the flat `Track`. All the defensive defaults live here; a track with no id (local files) returns null and never reaches dedup/delete.
  - `spotify/library.ts` — paginated `fetchSavedTracks`/`fetchPlaylistTracks` (the page-walk takes an injectable `pager` for tests), plus `removeSavedTracks`/`addSavedTracks`/`searchTracks`/`playTrack`.
  - `spotify/pathfinder.ts` — **unofficial and fragile.** The official API gives neither play counts nor localized (e.g. Chinese) names. This hits the internal Pathfinder GraphQL `queryAlbumTracks` per album (`Accept-Language: zh-TW`) for playcount + localized name/artists/album in one query. **Best-effort:** per-album failures are tolerated and surfaced via `failedAlbums`; tracks keep official data. The persisted-query hash and TOTP secret rotate — a wrong hash just no-ops enrichment.
  - `core/` — **pure, no network.** `detect.ts` (`findConfidentDuplicates` merges name+artist and ISRC groups via union-find), `dedupe.ts` (`planDeletions` keep-policy), `cleanup.ts` (`buildCleanup` → the one-click plan with per-row reasons).
  - `library-service.ts` — in-memory cache of the fetched+enriched library and its cleanup plan; `routes.ts` — all HTTP endpoints (Zod-validated bodies).
- **`apps/desktop`** (Electron, CJS via esbuild) — `main.ts` orchestrates: ensure `sp_dc` → fork backend → load the frontend (dev: `localhost:5173`, prod: `frontend/dist`).
- **`apps/frontend`** (React 19 + Vite + Tailwind v4 + TanStack Query/Virtual + Zustand + fuzzysort) — virtualized table for 1700+ rows; talks to the backend over `/api/*` (vite proxies to `127.0.0.1:8765`).

## Conventions

- **`Track.artists[0]`** (primary artist) is for grouping/dedup; **`artists.join(", ")`** is for display — don't swap them.
- Deletion keep-policy **prefers a playable track over a dead one**, then popularity (ties → earliest added), then id for determinism. Never keep a dead copy over a live one. A missing `addedAt` sorts last (treated as newest) via the `￿` sentinel.
- New behavior is test-first; keep `core/` and `normalize`/`pathfinder` parsing pure so tests stay offline (inject fakes for the network seam). Don't make a test hit Spotify.
- Anything through `pathfinder.ts` is fragile: it must never propagate failure into the rest of the app.

## TypeScript / build gotchas

- The base tsconfig uses `verbatimModuleSyntax`, which is **incompatible with `module: CommonJS`**. Keep tsconfigs in ESM module mode for typechecking; let **esbuild** emit the CJS that Electron/Node need. Do not add `module: CommonJS` to a package tsconfig — it breaks the typecheck.
- esbuild can't emit top-level `await` as CJS — the backend wraps its Fastify setup in `async function main()`.
- The backend bundles **self-contained** (`--external:better-sqlite3` only) — fastify/zod/etc. are inlined, so packaging ships one `server.cjs` plus the single native module, not a `node_modules` tree.

## Packaging (electron-builder)

`pnpm dist` (or `dist:dir` for an unpacked build) from the root runs: `pnpm -r build` → `apps/desktop` `stage` → `rebuild:native` → `electron-builder`.

- `apps/desktop/scripts/stage.mjs` assembles `apps/desktop/build/`: the frontend build, the self-contained `server.cjs`, and better-sqlite3 + its **runtime** closure (`bindings` → `file-uri-to-path`; `prebuild-install` is skipped — install-time only). pnpm hides better-sqlite3 from the desktop package, so the script resolves it from the backend's `package.json`.
- `electron-builder.yml` packs only `dist/**` (main/preload) into the asar; `build/` ships under `resources/` via `extraResources`. `backend.ts`/`main.ts` resolve those with `process.resourcesPath` when `app.isPackaged`. The forked `server.cjs` and the `.node` live outside the asar so `fork()` and the native load work.
- **`rebuild:native` (electron-rebuild) must run on the user's machine** — the staged better-sqlite3 carries a Node-ABI binary; it needs rebuilding for Electron's ABI. This (and the installer build + the first real login) can't be verified headless.
- The undo DB lives at `userData/stm_history.db` in the packaged app (`STM_DB_PATH`), not next to the binary.

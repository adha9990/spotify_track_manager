# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Spotify Track Manager is a **desktop app** (Electron) that scans a Spotify library for duplicate / dead tracks and cleans them up — built for non-developers. The user logs into Spotify via an OAuth consent page; the app exchanges the authorization code for a refresh token and stores it encrypted. A pnpm monorepo with three apps (`backend`, `desktop`, `frontend`) over a shared Zod contract.

## Commands

```bash
pnpm install                       # workspace install (electron/esbuild build scripts are allow-listed)
pnpm -r build                      # build every package (esbuild backend + main/preload, vite frontend)
pnpm test                          # all package tests (vitest — fully offline, no network/Spotify)
pnpm typecheck                     # tsc --noEmit across all packages
pnpm lint                          # eslint — enforces the backend's layered import boundaries
pnpm dev                           # frontend (vite :5173) + electron shell, concurrently

# Single package / single test
pnpm --filter @stm/backend test
pnpm --filter @stm/backend test -- src/domain/detect.test.ts
pnpm --filter @stm/backend bundle  # esbuild → apps/backend/dist/server.cjs
PORT=8799 STM_DB_PATH=/tmp/x.db node apps/backend/dist/server.cjs  # boot the bundle standalone → curl /health to smoke-test wiring without the GUI/login
```

`packageManager` is pinned to pnpm; Node ≥ 22 (uses `process.loadEnvFile`). Root `package.json` lists `electron` and `esbuild` under `pnpm.onlyBuiltDependencies` — pnpm 10 ignores build scripts otherwise, and the electron binary never downloads.

## The auth flow (the reason this is an Electron app)

Electron lets us open a real Spotify consent page and catch the OAuth redirect on a local loopback server — something a normal browser extension cannot do without a registered redirect URI per-user. The chain:

1. `apps/desktop/src/auth.ts` — opens a `BrowserWindow` with Spotify's OAuth authorize URL (PKCE, `S256`), spins up an `http.createServer` on `127.0.0.1:8888`, catches `/callback?code=…`, exchanges the code for tokens, and stores the **refresh token encrypted** via `safeStorage` at `userData/spotify_refresh.bin`. Never written in plaintext.
2. `apps/desktop/src/backend.ts` — forks `apps/backend/dist/server.cjs`, passing `SPOTIFY_CLIENT_ID` and `SPOTIFY_REFRESH_TOKEN` through the **process env**, not a file or CLI arg. Listens for `{ type: "refresh_token" }` IPC messages and re-persists any rotated token.
3. `apps/backend/src/adapters/spotify/oauth.ts` — `refreshAccessToken(clientId, refreshToken)`: POSTs `grant_type=refresh_token` to `accounts.spotify.com/api/token` (public client — no secret). `auth.ts` caches the access token (~50 min) and, if Spotify rotates the refresh token, sends the new value back via `process.send` IPC.

**Developers** must register a Spotify app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard): APIs → Web API; Redirect URI → `http://127.0.0.1:8888/callback`; required scopes: `user-library-read`, `user-library-modify`, `user-read-private`, `user-modify-playback-state`, `user-read-playback-state`. Put the `client_id` in `apps/backend/.env` as `SPOTIFY_CLIENT_ID` (standalone dev) — Electron dev supplies it automatically at launch.

**Hard security rules:** never put refresh tokens or access tokens on a command line, in a tool-written file, or anywhere in the transcript/logs. Never ask for or handle the user's Spotify password — only they can complete the interactive OAuth login.

**Never go back** to the `sp_dc` cookie + reverse-engineered TOTP web-player token + Pathfinder GraphQL path — it triggers Spotify's anti-abuse ban (persistent `429`, `retry-after: 86400`). That's why auth is OAuth PKCE and play counts / localized (Chinese) names were dropped (the official API has `popularity`, not play counts).

Debugging stored creds: the encrypted `spotify_refresh.bin` + `stm_history.db` live in `userData` = `%APPDATA%\@stm\desktop` (Windows). To decrypt from a standalone Electron script, call `app.setPath("userData", …/@stm/desktop)` **before** `whenReady` — safeStorage's key sits in that dir's `Local State`, so any other userData path decrypts with the wrong key.

## Architecture

The discipline is **pure logic isolated from I/O so it unit-tests offline**. All cross-process data shapes are Zod schemas in `packages/shared` (`@stm/shared`) — the single contract between backend and frontend.

- **`apps/backend`** (Fastify, bound to `127.0.0.1` only) — a **layered architecture**; dependencies flow **inward only** (`http → services → ports/domain`; `adapters → ports/domain`; `bin/` = composition root), enforced by ESLint (`pnpm lint` fails the build on any violation):
  - `domain/` — **pure logic, zero I/O.** `detect.ts` (`findConfidentDuplicates` merges name+artist and ISRC groups via union-find), `dedupe.ts` (`planDeletions` keep-policy — prefers playable over dead, then `popularity`), `cleanup.ts` (`buildCleanup` → the one-click plan with per-row reasons), `canonical.ts` (`canonical()`: NFKC-normalizes, folds Traditional→Simplified Chinese via OpenCC, lowercases, collapses whitespace — a comparison key only, shared by `detect` and `suspects`), `suspects.ts` (`findSuspectPairs`: within same-primary-artist buckets, pairs a stripped version-suffix match or a char-bigram Dice score ≥ 0.85 into a suggested pair, excluding confident groups and any already-dismissed `pairKey`; keep/remove reuses `planDeletions`). `fixtures.ts` is a test-only helper.
  - `ports/` — **interfaces only** (the dependency-inversion seams): `SpotifyGateway`, `HistoryStore`, `DismissalStore`. Inner layers depend on these, never on a concrete adapter.
  - `adapters/` — **the only place that touches concrete I/O.** `spotify/oauth.ts` (`refreshAccessToken`, pure over injectable fetch), `spotify/auth.ts`+`api.ts` (access-token cache + Web API wrapper, retries on 401/429), `spotify/normalize.ts` (`trackFromItem`: Spotify JSON → flat `Track`; defensive defaults, no-id → null), `spotify/library.ts` (paginated `fetchSavedTracks` with injectable `pager`, plus remove/add/search/play), `spotify/gateway.ts` (assembles them + the `/me` status probe into the `SpotifyGateway`). `db/history.ts` — the better-sqlite3 undo op-log implementing `HistoryStore`. `db/dismissals.ts` — a second better-sqlite3 connection to the same DB file, implementing `DismissalStore` (a `dismissed_pairs` table of user "not a duplicate" verdicts).
  - `services/library-service.ts` — `createLibraryService(gateway, dismissals)` caches the fetched library + cleanup plan and computes suspect pairs against the `DismissalStore`'s dismissed set; depends only on the `SpotifyGateway`/`DismissalStore` ports, so it's unit-tested with fakes.
  - `http/routes.ts` — all HTTP endpoints (Zod-validated bodies), taking injected `{ library, history, gateway }`.
  - `bin/server.ts` — the **composition root**: builds the concrete adapters, injects them, and starts Fastify. The only layer allowed to import an adapter (and the esbuild bundle entry).
- **`apps/desktop`** (Electron, CJS via esbuild) — `main.ts` orchestrates: `ensureRefreshToken()` (OAuth login if no stored token) → `startBackend(clientId, refreshToken, port)` → load the frontend (dev: `localhost:5173`, prod: `frontend/dist`).
- **`apps/frontend`** (React 19 + Vite + Tailwind v4 + TanStack Query/Virtual + Zustand + fuzzysort) — virtualized table for 1700+ rows. Layered `api/` (typed client) → `hooks/` (TanStack Query data hooks) → `components/`, plus `store/` (Zustand UI state) and `lib/` (formatters). UI flows **components → hooks → api**; ESLint (`pnpm lint`) stops a component importing the api client directly and keeps the front/back wall — the frontend reaches the backend only over `/api/*` (vite proxies to `127.0.0.1:8765`). Component tests run **offline** on vitest + jsdom + `@testing-library/react` (`pnpm --filter @stm/frontend test`, wired into `pnpm test`): render the **exported** component and `vi.mock("../hooks/useLibrary")` to spy on the mutation seam (make the mock's `mutate` invoke `opts.onSuccess()` so success side-effects — announce/close/focus — run); jsdom faithfully reproduces our explicit focus calls but not Radix's implicit focus-restore, so don't assert the latter.

## Conventions

- **`Track.artists[0]`** (primary artist) is for grouping/dedup; **`artists.join(", ")`** is for display — don't swap them.
- Deletion keep-policy **prefers a playable track over a dead one**, then popularity (ties → earliest added), then id for determinism. Never keep a dead copy over a live one. A missing `addedAt` sorts last (treated as newest) via the `￿` sentinel.
- New behavior is test-first; keep `domain/` and the Spotify `normalize` pure so tests stay offline (inject a fake gateway/pager for the network seam). Don't make a test hit Spotify.
- Respect the layer boundaries (`pnpm lint`): add I/O in `adapters/` behind a `ports/` interface and wire it at the `bin/server.ts` composition root — never import an adapter from `services/`/`http/`.
- `canonical()`'s output is a comparison key only — never use it as a display string.

## TypeScript / build gotchas

- The base tsconfig uses `verbatimModuleSyntax`, which is **incompatible with `module: CommonJS`**. Keep tsconfigs in ESM module mode for typechecking; let **esbuild** emit the CJS that Electron/Node need. Do not add `module: CommonJS` to a package tsconfig — it breaks the typecheck.
- esbuild can't emit top-level `await` as CJS — the backend wraps its Fastify setup in `async function main()`.
- The backend bundles **self-contained** (`--external:better-sqlite3` only) — fastify/zod/etc. are inlined, so packaging ships one `server.cjs` plus the single native module, not a `node_modules` tree.

## Packaging (electron-builder)

`pnpm dist` (or `dist:dir` for an unpacked build) from the root runs: `pnpm -r build` → `apps/desktop` `stage` → `rebuild:native` → `electron-builder`.

- `apps/desktop/scripts/stage.mjs` assembles `apps/desktop/build/`: the frontend build, the self-contained `server.cjs`, and better-sqlite3 + its **runtime** closure (`bindings` → `file-uri-to-path`; `prebuild-install` is skipped — install-time only). pnpm hides better-sqlite3 from the desktop package, so the script resolves it from the backend's `package.json`.
- `electron-builder.yml` packs only `dist/**` (main/preload) into the asar; `build/` ships under `resources/` via `extraResources`. `backend.ts`/`main.ts` resolve those with `process.resourcesPath` when `app.isPackaged`. The forked `server.cjs` and the `.node` live outside the asar so `fork()` and the native load work.
- **`rebuild:native` (electron-rebuild) must run on the user's machine** — the staged better-sqlite3 carries a Node-ABI binary; it needs rebuilding for Electron's ABI. This (and the installer build + the first real login) can't be verified headless.
- The undo DB lives at `userData/stm_history.db` in the packaged app (`STM_DB_PATH`), not next to the binary (this same file also holds the `dismissed_pairs` ignore-list table).

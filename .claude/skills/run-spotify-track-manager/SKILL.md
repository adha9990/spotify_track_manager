---
name: run-spotify-track-manager
description: Build, launch, drive, and screenshot the spotify_track_manager app — the `stm` CLI (scan/dedupe) and the `stm serve` interactive web UI. Use when asked to run, start, serve, smoke-test, screenshot, or drive this app, or to exercise the web page without Spotify credentials.
---

# Run spotify_track_manager

`stm` is a Python tool with two surfaces:
- **CLI** — `stm scan` / `stm dedupe` (need Spotify OAuth, so not runnable on a clean machine without credentials).
- **Web UI** — `stm serve` starts a `127.0.0.1`-only Flask app whose buttons play / delete / dedupe / restore your library via token-protected `/api/*` endpoints.

**The agent path does not need Spotify credentials.** `driver.py` launches the same Flask app wired to a *fake* client serving sample data, so the whole interactive page is drivable with `curl` and screenshottable in a browser. Paths below are relative to the repo root.

> Verified on Windows (PowerShell + `curl.exe` + Python 3.13). On Linux/macOS the Python/curl commands are identical; only the port-killing one-liner differs (see Troubleshooting).

## Prerequisites

- Python 3.10+.
- Editable install (pulls in Flask, requests, spotipy, typer, rapidfuzz, pydantic-settings):

```
pip install -e .
```

- Test/lint extras (optional, for the test step):

```
pip install -e ".[dev]"
```

## Run — agent path (no credentials)

Launch the web app with a fake client + sample data. Token is the fixed string `demo-token`, so `/api/*` is curl-able. Actions are recorded, not sent to Spotify.

```
python .claude/skills/run-spotify-track-manager/driver.py 8799
```

It prints `DRIVER UP http://127.0.0.1:8799  token=demo-token` and serves until killed. Drive it:

```
curl -s http://127.0.0.1:8799/health
```
→ `{"ok":true}`

```
curl -s http://127.0.0.1:8799/ | grep -c "class=\"tab"
```
→ non-zero (the tabbed page rendered).

```
curl -s -X POST http://127.0.0.1:8799/api/delete -H "Content-Type: application/json" -H "X-Token: demo-token" -d "{\"track_ids\":[\"t02\"]}"
```
→ `{"deleted":1,"ok":true}` (fake — nothing leaves a real library).

```
curl -s http://127.0.0.1:8799/api/history -H "X-Token: demo-token"
```
→ the recorded delete batch (SQLite history → undo works end-to-end).

### Screenshot

Open `http://127.0.0.1:8799/` in a browser and capture it. With the chrome-devtools MCP this session:
- `new_page` → `http://127.0.0.1:8799/`
- `take_screenshot` with `filePath: .claude/skills/run-spotify-track-manager/screenshot.png`, `fullPage: true`

The committed `screenshot.png` is the expected result: a centered "Spotify 收藏報表" page, editorial serif (Fraunces) heading, five tabs, and a sample table with play counts. If your capture is blank or left/right-misaligned, the server didn't pick up `src/stm/webpage.py` — restart the driver.

## Direct invocation (no server, no creds)

Render the page HTML straight from the renderer:

```
python -c "from stm import webpage; open('page.html','w',encoding='utf-8').write(webpage.render([('所有歌曲', [], None)], 'tok'))"
```

Run the pure logic / API tests:

```
python -m pytest -q
```
→ `123 passed` (detection, dedupe keep-policy, Flask routes, page structure, SQLite history, TOTP math vs RFC 6238).

## Run — human path (real Spotify, needs credentials)

```
stm serve --port 8765
```

Opens a browser to `http://127.0.0.1:8765` against your real library. Requires:
- `.env` with `CLIENT_ID` / `CLIENT_SECRET` and `REDIRECT_URI=http://127.0.0.1:8888/callback` (the **same** value registered in the Spotify dashboard).
- First run opens a Spotify consent page (browser OAuth) — cannot complete headless.
- Playback needs **Spotify Premium** + an open Spotify device.
- Play counts need an optional `SP_DC` cookie in `.env` (see `.env.example`).

`stm scan` / `stm dedupe` use the same OAuth.

## Gotchas

- **`http://localhost` is rejected** by Spotify as an insecure redirect URI. Use `http://127.0.0.1:8888/callback` in *both* `.env` and the Spotify dashboard, or auth fails with `INVALID_CLIENT: Insecure redirect URI`.
- **First-run OAuth is interactive** — there is no headless login. That is exactly why the agent path uses `driver.py` with a fake client instead of `stm serve`.
- **Editable install required before the driver runs** — `driver.py` does `from stm import ...`; without `pip install -e .` it is `ModuleNotFoundError: No module named 'stm'`.
- **`/health` needs no token; every other `/api/*` needs `X-Token`** — calls without the header get `403`.
- **The live page heartbeats `/health` and reloads when the server returns.** Kill + relaunch the server and any open tab reconnects and reloads (picking up new CSS *and* a fresh session token — old tokens stop working, which is why the reload matters).
- **Play counts are best-effort** — they go through Spotify's unofficial Pathfinder API with a reverse-engineered TOTP secret that Spotify rotates; the column blanks on failure and nothing else breaks.

## Troubleshooting

- **`ModuleNotFoundError: No module named 'stm'`** → `pip install -e .` from the repo root.
- **Port already in use / want a clean relaunch (Windows):**
  ```
  powershell -Command "Get-NetTCPConnection -LocalPort 8799 -State Listen -EA SilentlyContinue | %% { Stop-Process -Id $_.OwningProcess -Force }"
  ```
  Linux/macOS equivalent: `lsof -ti tcp:8799 | xargs -r kill -9`.
- **`stm: command not found`** → the console script is registered by `pip install -e .`; re-run it, or use `python -m stm.cli ...`.
- **Driver page looks misaligned** → an old render is cached; reload with cache ignored, or kill + relaunch `driver.py`.

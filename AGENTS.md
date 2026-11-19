# Spotify Track Manager

This pnpm workspace contains a local web app for browsing and organizing a Spotify library. Fastify runs on Node.js 22 or later. Vite builds the React UI. The shared Zod contracts live in `packages/shared`.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

The browser entry point is `http://127.0.0.1:8888`. In development, Vite forwards API and OAuth callback requests to Fastify on port 8765. The built app serves both from Fastify on port 8888.

## Boundaries

- Keep Spotify and SQLite I/O in adapters. The composition root in `bin/server.ts` wires adapters to ports, services, and HTTP routes. ESLint checks these boundaries.
- Keep frontend requests behind hooks and the API client. Add response shapes to the shared Zod contract. Run tests offline with fake Spotify responses.
- Keep Liked Songs unique by track ID. Playlist entries preserve each occurrence and identify it by its one-based position. Display all artists.

## Spotify authentication

Use the official Authorization Code flow with PKCE. The user completes Spotify login in their browser. Keep refresh tokens in the Node.js process. Pass the short-lived access token directly to the Web Playback SDK from the authenticated same-origin endpoint. Keep it out of browser storage and query caches. Never request the user's password or include OAuth codes or tokens in transcripts, logs, command lines, or development fixtures.

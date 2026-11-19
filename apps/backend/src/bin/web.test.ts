import { createHash } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { History } from "../adapters/db/history";
import { fetchPlaylistEntries } from "../adapters/spotify/library";
import { trackFromItem } from "../adapters/spotify/normalize";
import { createAuthorizationUrl } from "../adapters/spotify/oauth";
import { registerAuthRoutes } from "../http/auth-routes";
import { registerRoutes } from "../http/routes";
import type { SpotifyGateway } from "../ports/spotify-gateway";
import { createLibraryService } from "../services/library-service";

describe("local web app", () => {
  it("authorizes the browser session and serves playlist entries in their original order", async () => {
    const app = Fastify();
    const history = new History();
    const profile = { accountId: "account", user: "Tester", product: null };
    const gateway: SpotifyGateway = {
      getProfile: async () => profile,
      fetchSavedTracks: async () => {
        const track = trackFromItem({ track: { id: "saved", name: "Saved Song", artists: [{ name: "Artist" }], album: { name: "Single" } } });
        return track ? [track] : [];
      },
      fetchTrackDetails: vi.fn(async (ids) => ids.includes("earlier")
        ? [{ id: "earlier", name: "Earlier Song", artists: ["Original Artist"], album: "Old Album" }] : []),
      fetchPlaylists: async () => [{ id: "playlist", name: "KTV", itemCount: 7 }],
      fetchPlaylistEntries: (id) => fetchPlaylistEntries(id, async () => ({
        items: [
          { item: { id: "a", name: "Song A" } },
          { item: { id: "b", name: "Song B", external_ids: { isrc: "CODE" } } },
          null,
          { item: { id: "a", name: "Song A" } },
          { item: { id: "c", name: "Song B Remastered", external_ids: { isrc: "code" } } },
          { item: { id: "d", name: "Song C", artists: [{ name: "Artist" }] } },
          { item: { id: "e", name: "Song C", artists: [{ name: "Artist" }] } },
        ],
      })),
      removeSavedTracks: vi.fn(),
      addSavedTracks: vi.fn(),
      searchTracks: async () => [],
      playTrack: vi.fn(),
      getPlayback: async () => null,
      controlPlayback: vi.fn(),
    };
    const connect = vi.fn(async (_code: string, _verifier: string) => ({
      profile, gateway, history, library: createLibraryService(gateway),
      webPlaybackToken: async () => "test-access",
    }));
    const oauth = { clientId: "test-app", redirectUri: "http://127.0.0.1:8888/callback" };

    try {
      await app.register(cookie);
      const sessionFor = registerAuthRoutes(app, {
        authorizationUrl: (state, challenge) => createAuthorizationUrl(oauth, state, challenge),
        connect,
      });
      await registerRoutes(app, sessionFor);

      const before = await app.inject("/api/playlists");
      expect(before.statusCode).toBe(401);
      expect((await app.inject("/api/playback")).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/api/playback" })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/api/playback/token" })).statusCode).toBe(401);
      const login = await app.inject("/api/auth/login");
      expect(login.statusCode).toBe(302);
      expect(login.headers.location).toBeDefined();
      const consent = new URL(login.headers.location ?? "");
      expect(consent.searchParams.get("redirect_uri")).toBe(oauth.redirectUri);
      expect(consent.searchParams.get("scope")?.split(" ")).toContain("playlist-read-private");
      expect(consent.searchParams.get("scope")?.split(" ")).toContain("playlist-read-collaborative");
      expect(consent.searchParams.get("scope")?.split(" ")).toContain("user-read-playback-state");
      expect(consent.searchParams.get("scope")?.split(" ")).toContain("user-modify-playback-state");
      expect(consent.searchParams.get("scope")?.split(" ")).toEqual(expect.arrayContaining([
        "streaming", "user-read-email", "user-read-private",
      ]));
      expect(consent.searchParams.get("code_challenge_method")).toBe("S256");
      const state = consent.searchParams.get("state");
      const oauthCookie = login.cookies.find(({ name }) => name === "stm_oauth");
      expect(oauthCookie?.value).toBe(state);

      const callback = `/callback?code=sample-code&state=${state}`;
      const invalid = await app.inject(callback);
      expect(invalid.headers.location).toBe("/?login=failed");
      expect(connect).not.toHaveBeenCalled();

      const signedIn = await app.inject({
        url: callback,
        headers: { cookie: `stm_oauth=${oauthCookie?.value}` },
      });
      expect(signedIn.headers.location).toBe("/");
      expect(connect.mock.calls[0]?.[0]).toBe("sample-code");
      const verifier = connect.mock.calls[0]?.[1] ?? "";
      expect(createHash("sha256").update(verifier).digest("base64url")).toBe(consent.searchParams.get("code_challenge"));
      const sessionCookie = signedIn.cookies.find(({ name }) => name === "stm_session");
      expect(sessionCookie).toBeDefined();
      const headers = { cookie: `stm_session=${sessionCookie?.value}` };

      expect((await app.inject({ url: "/api/status", headers })).json()).toEqual({
        connected: true, user: "Tester", product: null,
      });
      expect((await app.inject({ url: "/api/playlists", headers })).json().playlists[0].name).toBe("KTV");
      expect((await app.inject({ url: "/api/playback", headers })).json()).toEqual({ playback: null });
      const tokenRequest = (site: string) => app.inject({
        method: "POST", url: "/api/playback/token", headers: { ...headers, "sec-fetch-site": site },
      });
      expect((await tokenRequest("same-site")).statusCode).toBe(403);
      const token = await tokenRequest("same-origin");
      expect(token.headers["cache-control"]).toBe("no-store");
      expect(token.json()).toEqual({ accessToken: "test-access" });
      const browserStart = {
        id: "a", deviceId: "browser-device", context: { type: "playlist", playlistId: "playlist", position: 4 },
      };
      expect((await app.inject({ method: "POST", url: "/api/play", headers, payload: browserStart })).json())
        .toEqual({ ok: true });
      expect(gateway.playTrack).toHaveBeenCalledWith(browserStart);
      const setVolume = (volumePercent: number) => app.inject({
        method: "POST", url: "/api/playback", headers,
        payload: { action: "volume", deviceId: "speaker", volumePercent },
      });
      expect((await setVolume(101)).statusCode).toBe(400);
      expect(gateway.controlPlayback).not.toHaveBeenCalled();
      expect((await setVolume(0)).json()).toEqual({ ok: true });
      expect(gateway.controlPlayback).toHaveBeenCalledWith({ action: "volume", deviceId: "speaker", volumePercent: 0 });
      const seekTo = (positionMs: number) => app.inject({
        method: "POST", url: "/api/playback", headers,
        payload: { action: "seek", deviceId: "speaker", positionMs },
      });
      expect((await seekTo(-1)).statusCode).toBe(400);
      expect((await seekTo(0.25)).statusCode).toBe(400);
      expect((await seekTo(25_000)).json()).toEqual({ ok: true });
      expect(gateway.controlPlayback).toHaveBeenCalledTimes(2);
      expect(gateway.controlPlayback).toHaveBeenLastCalledWith({ action: "seek", deviceId: "speaker", positionMs: 25_000 });
      const items = await app.inject({ url: "/api/playlists/playlist/items", headers });
      expect(items.statusCode).toBe(200);
      expect(items.json()).toMatchObject({
        skipped: 1,
        entries: [
          { position: 1, track: { id: "a" } },
          { position: 2, track: { id: "b" } },
          { position: 4, track: { id: "a" } },
          { position: 5, track: { id: "c" } },
          { position: 6, track: { id: "d" } },
          { position: 7, track: { id: "e" } },
        ],
      });
      expect(items.json()).not.toHaveProperty("duplicates");
      expect(Object.keys((await app.inject({ url: "/api/library", headers })).json()).sort()).toEqual([
        "fetchedAt", "tracks",
      ]);
      const removedRoute = await app.inject({ method: "POST", url: "/api/suspects/dismiss", headers });
      expect(removedRoute.statusCode).toBe(404);
      expect(gateway.removeSavedTracks).not.toHaveBeenCalled();
      expect(gateway.addSavedTracks).not.toHaveBeenCalled();

      history.record("delete", ["earlier"], "legacy", "2026-01-01T00:00:00Z");
      const deletion = await app.inject({ method: "POST", url: "/api/tracks/delete", headers, payload: { ids: ["saved"] } });
      expect(deletion.json()).toEqual({ deleted: 1 });
      expect(gateway.removeSavedTracks).toHaveBeenCalledWith(["saved"]);
      const historyResponse = await app.inject({ url: "/api/history", headers });
      expect(historyResponse.json().batches).toMatchObject([
        { action: "delete", tracks: [{ id: "saved", name: "Saved Song", artists: ["Artist"], album: "Single" }] },
        { batchId: "legacy", tracks: [{ id: "earlier", name: "Earlier Song", artists: ["Original Artist"], album: "Old Album" }] },
      ]);
      expect(gateway.fetchTrackDetails).toHaveBeenCalledTimes(1);
      expect(gateway.fetchTrackDetails).toHaveBeenCalledWith(["earlier"]);
      const undo = await app.inject({ method: "POST", url: "/api/history/undo", headers, payload: { batchId: "legacy" } });
      expect(undo.json()).toEqual({ undone: 1 });
      expect(gateway.addSavedTracks).toHaveBeenCalledWith(["earlier"]);
      expect((await app.inject({ url: "/api/history", headers })).json().batches[1].undone).toBe(true);
      expect(gateway.fetchTrackDetails).toHaveBeenCalledTimes(1);

      await app.inject({ method: "POST", url: "/api/auth/logout", headers });
      const loggedOut = await app.inject({ url: "/api/playlists", headers });
      expect(loggedOut.statusCode).toBe(401);
      expect((await tokenRequest("same-origin")).statusCode).toBe(401);
    } finally {
      await app.close();
      history.close();
    }
  });
});

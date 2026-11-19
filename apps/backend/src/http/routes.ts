import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PlaybackCommandSchema, PlayTrackSchema, SpotifyIdSchema, WebPlaybackTokenSchema } from "@stm/shared";
import { z } from "zod";
import type { HistoryStore } from "../ports/history-store";
import type { SpotifyGateway, SpotifyProfile } from "../ports/spotify-gateway";
import type { LibraryService } from "../services/library-service";

// All HTTP routes for the desktop app's local backend. Bodies are validated with
// Zod so a malformed request fails loudly with 400 instead of surfacing deep in a
// Spotify call. Dependencies arrive injected (ports + service) — this layer never
// imports an adapter directly; the composition root in bin/server.ts wires them.

export interface LibrarySession {
  profile: SpotifyProfile;
  library: LibraryService;
  history: HistoryStore;
  gateway: SpotifyGateway;
  webPlaybackToken: (() => Promise<string>) | null;
}

const IdsBody = z.object({ ids: z.array(SpotifyIdSchema).min(1) });
const UndoBody = z.object({ batchId: z.string() });

const now = () => new Date().toISOString();

export async function registerRoutes(
  app: FastifyInstance,
  sessionFor: (request: FastifyRequest) => LibrarySession | null,
): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.get("/api/status", async (request) => {
    const profile = sessionFor(request)?.profile;
    return { connected: Boolean(profile), user: profile?.user ?? null, product: profile?.product ?? null };
  });

  function requireSession(request: FastifyRequest): LibrarySession {
    const session = sessionFor(request);
    if (!session) {
      throw Object.assign(new Error("請先連線 Spotify"), { statusCode: 401 });
    }
    return session;
  }

  app.get<{ Querystring: { refresh?: string } }>("/api/library", async (req) => {
    const { library } = requireSession(req);
    return library.getLibrary(now(), req.query.refresh === "1");
  });

  app.get("/api/playlists", async (req) => {
    const { gateway } = requireSession(req);
    return { playlists: await gateway.fetchPlaylists() };
  });

  app.get<{ Params: { id: string } }>("/api/playlists/:id/items", async (req, reply) => {
    const { gateway } = requireSession(req);
    const id = SpotifyIdSchema.safeParse(req.params.id);
    if (!id.success) return reply.code(400).send({ error: "歌單 ID 格式錯誤" });
    return gateway.fetchPlaylistEntries(id.data);
  });

  app.post("/api/tracks/delete", async (req, reply) => {
    const { library, history, gateway } = requireSession(req);
    const parsed = IdsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const tracks = library.cachedTracks(parsed.data.ids);
    await gateway.removeSavedTracks(parsed.data.ids);
    library.applyLocalDelete(parsed.data.ids);
    history.record("delete", parsed.data.ids, randomUUID(), now(), tracks);
    return { deleted: parsed.data.ids.length };
  });

  app.post("/api/tracks/add", async (req, reply) => {
    const { library, history, gateway } = requireSession(req);
    const parsed = IdsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const tracks = library.cachedTracks(parsed.data.ids);
    await gateway.addSavedTracks(parsed.data.ids);
    library.invalidateLibrary(); // re-added tracks must reappear on next fetch
    history.record("add", parsed.data.ids, randomUUID(), now(), tracks);
    return { added: parsed.data.ids.length };
  });

  app.get("/api/history", async (req) => {
    const { library, history, gateway } = requireSession(req);
    const batches = history.list();
    const missing = new Set(batches.flatMap((batch) => batch.tracks.filter(({ name }) => !name).map(({ id }) => id)));
    if (missing.size === 0) return { batches };

    const tracks = library.cachedTracks([...missing]).filter(({ name }) => name);
    for (const track of tracks) missing.delete(track.id);
    const fetched = await gateway.fetchTrackDetails([...missing]);
    if (tracks.length === 0 && fetched.length === 0) return { batches };
    history.rememberTracks([...tracks, ...fetched]);
    return { batches: history.list() };
  });

  app.post("/api/history/undo", async (req, reply) => {
    const { library, history, gateway } = requireSession(req);
    const parsed = UndoBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const reversal = history.beginUndo(parsed.data.batchId);
    if (!reversal) return reply.code(404).send({ error: "batch not found or already undone" });

    // Reverse the recorded action; roll the undo flag back if Spotify rejects it.
    try {
      if (reversal.action === "delete") await gateway.addSavedTracks(reversal.trackIds);
      else await gateway.removeSavedTracks(reversal.trackIds);
    } catch (err) {
      history.cancelUndo(parsed.data.batchId);
      return reply.code(502).send({ error: String(err) });
    }
    library.invalidateLibrary();
    return { undone: reversal.trackIds.length };
  });

  app.get<{ Querystring: { q?: string } }>("/api/search", async (req, reply) => {
    const { gateway } = requireSession(req);
    const q = (req.query.q ?? "").trim();
    if (!q) return reply.code(400).send({ error: "q is required" });
    return { results: await gateway.searchTracks(q) };
  });

  app.post("/api/play", async (req, reply) => {
    const { gateway } = requireSession(req);
    const parsed = PlayTrackSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    await gateway.playTrack(parsed.data);
    return { ok: true };
  });

  app.post("/api/playback/token", async (req, reply) => {
    const { webPlaybackToken } = requireSession(req);
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    const fetchSite = req.headers["sec-fetch-site"];
    if (fetchSite && fetchSite !== "same-origin") {
      return reply.code(403).send({ error: "請從本機的收藏年鑑網頁開啟播放器。" });
    }
    if (!webPlaybackToken) return reply.code(403).send({ error: "請重新授權 Spotify 網頁播放。" });
    return WebPlaybackTokenSchema.parse({ accessToken: await webPlaybackToken() });
  });

  app.get("/api/playback", async (req) => {
    const { gateway } = requireSession(req);
    return { playback: await gateway.getPlayback() };
  });

  app.post("/api/playback", async (req, reply) => {
    const { gateway } = requireSession(req);
    const command = PlaybackCommandSchema.safeParse(req.body);
    if (!command.success) return reply.code(400).send({ error: "播放操作格式錯誤" });
    await gateway.controlPlayback(command.data);
    return { ok: true };
  });
}

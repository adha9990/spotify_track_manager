import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HistoryStore } from "../ports/history-store";
import type { SpotifyGateway } from "../ports/spotify-gateway";
import type { LibraryService } from "../services/library-service";

// All HTTP routes for the desktop app's local backend. Bodies are validated with
// Zod so a malformed request fails loudly with 400 instead of surfacing deep in a
// Spotify call. Dependencies arrive injected (ports + service) — this layer never
// imports an adapter directly; the composition root in bin/server.ts wires them.

export interface RouteDeps {
  library: LibraryService;
  history: HistoryStore;
  gateway: SpotifyGateway;
}

const IdsBody = z.object({ ids: z.array(z.string()).min(1) });
const PlayBody = z.object({ id: z.string() });
const UndoBody = z.object({ batchId: z.string() });

const now = () => new Date().toISOString();

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { library, history, gateway } = deps;

  app.get("/health", async () => ({ ok: true }));

  app.get("/api/status", async () => {
    try {
      const profile = await gateway.getProfile();
      return { connected: true, ...profile };
    } catch (err) {
      return { connected: false, error: String(err) };
    }
  });

  app.get<{ Querystring: { refresh?: string } }>("/api/library", async (req) => {
    return library.getLibrary(now(), req.query.refresh === "1");
  });

  app.post("/api/tracks/delete", async (req, reply) => {
    const parsed = IdsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    await gateway.removeSavedTracks(parsed.data.ids);
    library.applyLocalDelete(parsed.data.ids);
    history.record("delete", parsed.data.ids, randomUUID(), now());
    return { deleted: parsed.data.ids.length };
  });

  app.post("/api/tracks/add", async (req, reply) => {
    const parsed = IdsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    await gateway.addSavedTracks(parsed.data.ids);
    library.invalidateLibrary(); // re-added tracks must reappear on next fetch
    history.record("add", parsed.data.ids, randomUUID(), now());
    return { added: parsed.data.ids.length };
  });

  app.get("/api/history", async () => ({ batches: history.list() }));

  app.post("/api/history/undo", async (req, reply) => {
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
    const q = (req.query.q ?? "").trim();
    if (!q) return reply.code(400).send({ error: "q is required" });
    return { results: await gateway.searchTracks(q) };
  });

  app.post("/api/play", async (req, reply) => {
    const parsed = PlayBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    await gateway.playTrack(parsed.data.id);
    return { ok: true };
  });
}

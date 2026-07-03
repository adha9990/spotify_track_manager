import { existsSync } from "node:fs";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { Dismissals } from "../adapters/db/dismissals";
import { Embeddings } from "../adapters/db/embeddings";
import { History } from "../adapters/db/history";
import { createLabseGateway } from "../adapters/embedding/labse";
import { spotifyGateway } from "../adapters/spotify/gateway";
import { registerRoutes } from "../http/routes";
import { createLibraryService, type CrossLanguageEmbedding } from "../services/library-service";

// Standalone dev: load SPOTIFY_CLIENT_ID from a local apps/backend/.env (gitignored).
// In the packaged app, Electron passes SPOTIFY_CLIENT_ID and SPOTIFY_REFRESH_TOKEN
// via the forked process env after the OAuth login flow.
try {
  process.loadEnvFile();
} catch {
  /* no .env — credentials come from the env */
}

async function main(): Promise<void> {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(cors, { origin: true });

  // Composition root: build the concrete adapters once and inject them into the
  // routes. This is the only layer that touches adapters; everything inward depends
  // on ports. Swapping an implementation (e.g. a fake gateway in a test) happens here.
  const gateway = spotifyGateway;
  const dbPath = process.env.STM_DB_PATH ?? "stm_history.db";
  const history = new History(dbPath);
  const dismissals = new Dismissals(dbPath);

  // Cross-language duplicate detection is opt-in on a local model being present:
  // STM_MODEL_PATH is set by the desktop shell (packaged: resources; dev: repo).
  // Absent → no embedding capability injected → cross-language detection is simply
  // off (lexical + confident detection unaffected). The gateway itself loads lazily,
  // so even a set-but-missing model can't crash boot — the service degrades on embed.
  // Only wire cross-language when the model actually exists on disk. STM_MODEL_PATH is
  // always set by the desktop shell, so a truthiness check alone would make every user
  // who never fetched the model attempt (and fail) to load it on each first library
  // fetch. existsSync makes the capability genuinely opt-in: absent model → cleanly off.
  const modelPath = process.env.STM_MODEL_PATH;
  const embed: CrossLanguageEmbedding | undefined =
    modelPath && existsSync(modelPath)
      ? { cache: new Embeddings(dbPath), gateway: createLabseGateway({ modelPath }) }
      : undefined;

  const library = createLibraryService(gateway, dismissals, embed);
  await registerRoutes(app, { library, history, gateway });

  const port = Number(process.env.PORT ?? 8765);
  await app.listen({ host: "127.0.0.1", port });
  app.log.info(`backend listening on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

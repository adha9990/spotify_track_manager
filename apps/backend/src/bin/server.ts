import cors from "@fastify/cors";
import Fastify from "fastify";
import { History } from "../adapters/db/history";
import { spotifyGateway } from "../adapters/spotify/gateway";
import { registerRoutes } from "../http/routes";
import { createLibraryService } from "../services/library-service";

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
  const history = new History(process.env.STM_DB_PATH ?? "stm_history.db");
  const library = createLibraryService(gateway);
  await registerRoutes(app, { library, history, gateway });

  const port = Number(process.env.PORT ?? 8765);
  await app.listen({ host: "127.0.0.1", port });
  app.log.info(`backend listening on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { History } from "../adapters/db/history";
import { createAccessToken } from "../adapters/spotify/auth";
import { createSpotifyGateway } from "../adapters/spotify/gateway";
import { canStream, createAuthorizationUrl, exchangeCode } from "../adapters/spotify/oauth";
import { registerAuthRoutes } from "../http/auth-routes";
import { registerRoutes } from "../http/routes";
import { createLibraryService } from "../services/library-service";

const HOST = "127.0.0.1";
const PUBLIC_CLIENT_ID = "399e9348bd3b411e8e42eb262f66aec7";
const dev = process.argv.includes("--dev");
const root = dev ? path.resolve("../..") : process.cwd();
const envFile = path.join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const webPort = dev ? 8888 : Number(process.env.PORT ?? 8888);
  const listenPort = dev ? 8765 : webPort;
  const origin = `http://${HOST}:${webPort}`;
  const oauth = {
    clientId: process.env.SPOTIFY_CLIENT_ID || PUBLIC_CLIENT_ID,
    redirectUri: `${origin}/callback`,
  };
  const webRoot = path.join(root, "apps/frontend/dist");
  if (!dev && !existsSync(path.join(webRoot, "index.html"))) {
    throw new Error("找不到網頁建置檔。請先執行 pnpm build。");
  }

  const app = Fastify({ logger: { level: "info" }, disableRequestLogging: true });
  await app.register(cookie);
  app.addHook("onRequest", async (request, reply) => {
    // The browser uses the public loopback origin in both dev and built mode.
    // Vite changes the upstream Host to the backend address when proxying.
    if (
      request.headers.host !== `${HOST}:${listenPort}` ||
      (request.headers.origin && request.headers.origin !== origin)
    ) {
      return reply.code(403).send({ error: "請從本機的收藏年鑑網頁連線" });
    }
    reply.header("Referrer-Policy", "no-referrer");
    if (request.url.startsWith("/api/") || request.url.startsWith("/callback")) {
      reply.header("Cache-Control", "no-store");
    }
  });

  const dataDir = path.resolve(root, process.env.STM_DATA_DIR || ".cache");
  const stores = new Map<string, History>();
  app.addHook("onClose", async () => {
    for (const history of stores.values()) history.close();
  });

  const sessionFor = registerAuthRoutes(app, {
    authorizationUrl: (state, challenge) => createAuthorizationUrl(oauth, state, challenge),
    async connect(code, verifier) {
      const tokens = await exchangeCode(oauth, code, verifier);
      const accessToken = createAccessToken(oauth.clientId, tokens);
      const gateway = createSpotifyGateway(accessToken);
      const profile = await gateway.getProfile();
      let history = stores.get(profile.accountId);
      if (!history) {
        mkdirSync(dataDir, { recursive: true });
        const filename = createHash("sha256").update(profile.accountId).digest("hex") + ".db";
        const db = path.join(dataDir, filename);
        history = new History(db);
        stores.set(profile.accountId, history);
      }
      const library = createLibraryService(gateway);
      return { gateway, profile, library, history, webPlaybackToken: canStream(tokens) ? accessToken : null };
    },
  });
  await registerRoutes(app, sessionFor);
  if (!dev) await app.register(staticFiles, { root: webRoot });
  await app.listen({ host: HOST, port: listenPort });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { LibrarySession } from "./routes";

const LOGIN_COOKIE = "stm_oauth";
const SESSION_COOKIE = "stm_session";
const CALLBACK_PATH = "/callback";
const LOGIN_TIMEOUT_SECONDS = 300;
const CookieOptions = { httpOnly: true, sameSite: "lax" } as const;
const CallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1),
  error: z.string().optional(),
});

interface AuthDeps {
  authorizationUrl(state: string, challenge: string): string;
  connect(code: string, verifier: string): Promise<LibrarySession>;
}

interface LoginAttempt {
  state: string;
  verifier: string;
  expiresAt: number;
}

export function registerAuthRoutes(app: FastifyInstance, { authorizationUrl, connect }: AuthDeps) {
  let pending: LoginAttempt | null = null;
  let generation = 0;
  let active: { id: string; session: LibrarySession } | null = null;

  app.get("/api/auth/login", async (request, reply) => {
    if (request.headers["sec-fetch-site"] === "cross-site") {
      return reply.code(403).send({ error: "請從收藏年鑑開啟 Spotify 登入" });
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    generation++;
    pending = { state, verifier, expiresAt: Date.now() + LOGIN_TIMEOUT_SECONDS * 1000 };
    return reply
      .setCookie(LOGIN_COOKIE, state, {
        ...CookieOptions, path: CALLBACK_PATH, maxAge: LOGIN_TIMEOUT_SECONDS,
      })
      .redirect(authorizationUrl(state, challenge));
  });

  app.get(CALLBACK_PATH, async (request, reply) => {
    const query = CallbackQuery.safeParse(request.query);
    const attempt = pending;
    if (
      !query.success || !attempt || attempt.expiresAt <= Date.now() ||
      query.data.state !== attempt.state || request.cookies[LOGIN_COOKIE] !== attempt.state
    ) {
      return reply.redirect("/?login=failed");
    }
    const attemptGeneration = generation;
    pending = null;
    reply.clearCookie(LOGIN_COOKIE, { path: CALLBACK_PATH });
    if (query.data.error || !query.data.code) return reply.redirect("/?login=failed");

    try {
      const session = await connect(query.data.code, attempt.verifier);
      if (attemptGeneration !== generation) return reply.redirect("/");
      const id = randomBytes(32).toString("base64url");
      active = { id, session };
      return reply.setCookie(SESSION_COOKIE, id, { ...CookieOptions, path: "/" }).redirect("/");
    } catch (error) {
      request.log.warn({ err: error }, "Spotify sign-in failed");
      return reply.redirect("/?login=failed");
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (active && request.cookies[SESSION_COOKIE] === active.id) {
      generation++;
      pending = null;
      active = null;
    }
    return reply.clearCookie(SESSION_COOKIE, { path: "/" }).send({ ok: true });
  });

  return (request: FastifyRequest): LibrarySession | null =>
    active && request.cookies[SESSION_COOKIE] === active.id ? active.session : null;
}

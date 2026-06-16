import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { app, BrowserWindow, safeStorage } from "electron";

// OAuth Authorization Code + PKCE. We open Spotify's real consent page in a window,
// catch the redirect on a 127.0.0.1 loopback server, exchange the code for tokens,
// and store the refresh token encrypted (safeStorage). No sp_dc, no client secret.

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = [
  "user-library-read",
  "user-library-modify",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

const tokenFile = (): string => path.join(app.getPath("userData"), "spotify_refresh.bin");

// The app's own Spotify client_id — registered ONCE by the app author at
// developer.spotify.com and baked into the build. Under PKCE the client_id is a
// PUBLIC identifier (not a secret), so it ships embedded: end users never see it,
// register anything, or set an env var — they just log in on Spotify's consent
// page. Dev/CI can override via the SPOTIFY_CLIENT_ID env var.
const EMBEDDED_CLIENT_ID = "399e9348bd3b411e8e42eb262f66aec7";

export function clientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID || EMBEDDED_CLIENT_ID;
  if (!id) throw new Error("Spotify client_id is not configured");
  return id;
}

function readStored(): string | null {
  try {
    return safeStorage.decryptString(fs.readFileSync(tokenFile()));
  } catch {
    return null;
  }
}
export function storeRefreshToken(value: string): void {
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(value));
}
export function clearTokens(): void {
  try {
    fs.unlinkSync(tokenFile());
  } catch {
    /* nothing to clear */
  }
}

const base64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function exchangeCode(code: string, verifier: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId(),
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`code exchange failed: ${res.status}`);
  const data = (await res.json()) as { refresh_token?: string };
  if (!data.refresh_token) throw new Error("no refresh_token in exchange response");
  return data.refresh_token;
}

function loginFlow(): Promise<string> {
  const { verifier, challenge } = pkcePair();
  const state = base64url(crypto.randomBytes(16));
  const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    state,
  })}`;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindow({ width: 480, height: 760, title: "登入 Spotify", autoHideMenuBar: true });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2 style='font-family:sans-serif'>登入完成,請回到 App。</h2>");
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      finish(
        error ? Promise.reject(new Error(`authorize error: ${error}`))
        : gotState !== state ? Promise.reject(new Error("state mismatch"))
        : !code ? Promise.reject(new Error("no code in callback"))
        : exchangeCode(code, verifier),
      );
    });

    const timer = setTimeout(
      () => finish(Promise.reject(new Error("OAuth login timed out after 5 minutes"))),
      5 * 60_000,
    );

    function cleanup(): void {
      clearTimeout(timer);
      server.close();
      if (!win.isDestroyed()) win.close();
    }
    function finish(p: Promise<string>): void {
      if (settled) return;
      settled = true;
      p.then((rt) => {
        storeRefreshToken(rt);
        cleanup();
        resolve(rt);
      }).catch((err) => {
        cleanup();
        reject(err);
      });
    }

    server.on("error", (err) => finish(Promise.reject(err)));
    server.listen(REDIRECT_PORT, "127.0.0.1", () => void win.loadURL(authUrl));
    win.on("closed", () => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("login window closed before authorization"));
      }
    });
  });
}

/** Return a stored refresh token, or run the OAuth login to capture and persist one. */
export async function ensureRefreshToken(): Promise<string> {
  const stored = readStored();
  if (stored) return stored;
  return loginFlow();
}

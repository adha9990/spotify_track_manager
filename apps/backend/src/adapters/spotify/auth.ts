import { refreshAccessToken } from "./oauth";

// Holds the OAuth access token, refreshed on demand from the refresh token the
// desktop captured at login (PKCE) and passed via env. Access tokens last ~1h.
// If Spotify rotates the refresh token, hand it back to the main process (via the
// fork IPC channel) so it can be re-persisted for the next launch.

let cached: { token: string; expires: number } | null = null;
let refreshToken: string | undefined = process.env.SPOTIFY_REFRESH_TOKEN || undefined;
let inFlight: Promise<string> | null = null;

function clientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("no SPOTIFY_CLIENT_ID configured");
  return id;
}

export async function accessToken(force = false): Promise<string> {
  if (!refreshToken) throw new Error("no refresh token configured");
  if (!force && cached && cached.expires > Date.now()) return cached.token;
  if (force) cached = null;
  if (!inFlight) {
    inFlight = refreshAccessToken(clientId(), refreshToken)
      .then((set) => {
        // Refresh a minute early so an in-flight call never races the expiry.
        cached = { token: set.accessToken, expires: Date.now() + (set.expiresInSec - 60) * 1000 };
        if (set.refreshToken && set.refreshToken !== refreshToken) {
          refreshToken = set.refreshToken;
          process.send?.({ type: "refresh_token", value: set.refreshToken });
        }
        return set.accessToken;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

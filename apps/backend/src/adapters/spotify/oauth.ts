import { z } from "zod";

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const AUTHORIZE_ENDPOINT = "https://accounts.spotify.com/authorize";

const WEB_PLAYBACK_SCOPES = ["streaming", "user-read-email", "user-read-private"];
const SCOPES = [
  "user-library-read",
  "user-library-modify",
  ...WEB_PLAYBACK_SCOPES,
  "user-modify-playback-state",
  "user-read-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

export interface TokenSet {
  accessToken: string;
  expiresInSec: number;
  /** Spotify may rotate the refresh token; null when it returned none (keep the old one). */
  refreshToken: string | null;
  scopes: string[] | null;
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().default(3600),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

export function canStream({ scopes }: TokenSet): boolean {
  // An omitted scope means Spotify granted the scopes requested at authorization.
  return scopes === null || WEB_PLAYBACK_SCOPES.every((scope) => scopes.includes(scope));
}

interface OAuthConfig {
  clientId: string;
  redirectUri: string;
}

export function createAuthorizationUrl(
  config: OAuthConfig,
  state: string,
  challenge: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    show_dialog: "true",
    state,
  });
  return `${AUTHORIZE_ENDPOINT}?${params}`;
}

export async function exchangeCode(
  config: OAuthConfig,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code,
    code_verifier: verifier,
  });
  const tokens = await requestTokens(body, "code exchange", fetchImpl);
  if (!tokens.refreshToken) throw new Error("Spotify 沒有回傳更新憑證");
  return tokens;
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  return requestTokens(body, "token refresh", fetchImpl);
}

async function requestTokens(
  body: URLSearchParams,
  grant: "code exchange" | "token refresh",
  fetchImpl: typeof fetch,
): Promise<TokenSet> {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`${grant} failed: ${res.status}`);
  const data = TokenResponse.parse(await res.json());
  return {
    accessToken: data.access_token,
    expiresInSec: data.expires_in,
    refreshToken: data.refresh_token ?? null,
    scopes: data.scope === undefined ? null : data.scope.split(/\s+/),
  };
}

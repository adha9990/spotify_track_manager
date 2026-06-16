// Authorization Code + PKCE token refresh. Public client: the client_id is enough,
// no client secret. Pure over an injectable fetch so the refresh path is unit-tested
// offline. The interactive code↔token exchange happens in the desktop main process
// (it owns the login window + loopback); this module is only the repeated refresh.
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";

export interface TokenSet {
  accessToken: string;
  expiresInSec: number;
  /** Spotify may rotate the refresh token; null when it returned none (keep the old one). */
  refreshToken: string | null;
}

interface RawTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
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
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const data = (await res.json()) as RawTokenResponse;
  if (!data.access_token) throw new Error("no access_token in refresh response");
  return {
    accessToken: data.access_token,
    expiresInSec: data.expires_in ?? 3600,
    refreshToken: data.refresh_token ?? null,
  };
}

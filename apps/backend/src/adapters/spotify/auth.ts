import { refreshAccessToken, type TokenSet } from "./oauth";

/** Each logged-in session owns its tokens and shares one in-flight refresh. */
export function createAccessToken(
  clientId: string,
  initial: TokenSet,
  refresh = refreshAccessToken,
) {
  let refreshToken = initial.refreshToken;
  let accessToken = initial.accessToken;
  let expiresAt = nextExpiry(initial.expiresInSec);
  let inFlight: Promise<string> | null = null;

  return async (force = false): Promise<string> => {
    if (!force && Date.now() < expiresAt) return accessToken;
    if (!refreshToken) throw new Error("請重新連線 Spotify");
    inFlight ??= refresh(clientId, refreshToken)
      .then((tokens) => {
        accessToken = tokens.accessToken;
        expiresAt = nextExpiry(tokens.expiresInSec);
        refreshToken = tokens.refreshToken ?? refreshToken;
        return accessToken;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

const nextExpiry = (seconds: number) => Date.now() + Math.max(0, seconds - 60) * 1000;

export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Spotify rate-limits bursts (the first-load fetch is ~34 track pages). On 429 it
// returns a Retry-After header; honour it (capped) and retry so a transient throttle
// slows us down instead of failing. But the status health-check is polled constantly,
// so it opts out (retries429: 0) and fails fast rather than hanging for ~minute.
const DEFAULT_429_RETRIES = 4;
const RETRY_AFTER_CAP_S = 10;

export interface ApiOptions {
  /** How many times to back off + retry on HTTP 429. Default 4; pass 0 to fail fast. */
  retries429?: number;
}

export interface SpotifyApi {
  request(path: string, init?: RequestInit, opts?: ApiOptions): Promise<Response>;
  json(path: string, init?: RequestInit, opts?: ApiOptions): Promise<unknown>;
}

class SpotifyApiError extends Error {
  constructor(readonly statusCode: number) {
    super(`Spotify API 回應 ${statusCode}`);
  }
}

export function createSpotifyApi(accessToken: (force?: boolean) => Promise<string>): SpotifyApi {
  const request: SpotifyApi["request"] = async (path, init = {}, opts = {}) => {
    const maxRetries = opts.retries429 ?? DEFAULT_429_RETRIES;
    const call = async (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(`${SPOTIFY_API_BASE}${path}`, { ...init, headers });
    };

    let res = await call(await accessToken());
    if (res.status === 401) res = await call(await accessToken(true));

    for (let attempt = 0; res.status === 429 && attempt < maxRetries; attempt++) {
      const retryAfter = Number(res.headers.get("retry-after")) || 1;
      await sleep((Math.min(retryAfter, RETRY_AFTER_CAP_S) + attempt) * 1000);
      res = await call(await accessToken());
    }
    return res;
  };

  return {
    request,
    async json(path, init, opts) {
      const res = await request(path, init, opts);
      if (!res.ok) throw new SpotifyApiError(res.status);
      return res.json();
    },
  };
}

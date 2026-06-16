import { accessToken } from "./auth";

const BASE = "https://api.spotify.com/v1";
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

/** Call the official Web API with the web-player token; retries on 401 (fresh token) and 429 (backoff). */
export async function api(path: string, init: RequestInit = {}, opts: ApiOptions = {}): Promise<Response> {
  const maxRetries = opts.retries429 ?? DEFAULT_429_RETRIES;
  const call = async (token: string) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });

  let res = await call(await accessToken());
  if (res.status === 401) res = await call(await accessToken(true));

  for (let attempt = 0; res.status === 429 && attempt < maxRetries; attempt++) {
    const retryAfter = Number(res.headers.get("retry-after")) || 1;
    await sleep((Math.min(retryAfter, RETRY_AFTER_CAP_S) + attempt) * 1000);
    res = await call(await accessToken());
  }
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit, opts?: ApiOptions): Promise<T> {
  const res = await api(path, init, opts);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

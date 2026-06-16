import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "./oauth";

describe("refreshAccessToken", () => {
  it("POSTs the refresh_token grant with client_id and parses the new token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: "AT", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const set = await refreshAccessToken("CID", "RT", fetchImpl as unknown as typeof fetch);

    expect(set.accessToken).toBe("AT");
    expect(set.expiresInSec).toBe(3600);
    expect(set.refreshToken).toBeNull(); // not rotated this time

    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://accounts.spotify.com/api/token");
    const body = new URLSearchParams(call[1].body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("RT");
    expect(body.get("client_id")).toBe("CID");
  });

  it("surfaces a rotated refresh_token when Spotify returns one", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "AT2", expires_in: 3600, refresh_token: "RT2" }), {
        status: 200,
      }),
    );
    const set = await refreshAccessToken("CID", "RT", fetchImpl as unknown as typeof fetch);
    expect(set.refreshToken).toBe("RT2");
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(refreshAccessToken("CID", "RT", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /token refresh failed: 400/,
    );
  });
});

import type { SpotifyGateway, SpotifyProfile } from "../../ports/spotify-gateway";
import { apiJson } from "./api";
import { accessToken } from "./auth";
import { addSavedTracks, fetchSavedTracks, playTrack, removeSavedTracks, searchTracks } from "./library";

// The concrete Spotify adapter: the official Web API behind the SpotifyGateway port.
// Free functions in this folder stay individually unit-testable; this object just
// assembles them (plus the status probe) into the port the inner layers depend on.

async function getProfile(): Promise<SpotifyProfile> {
  await accessToken();
  // Fail fast on 429 — /api/status polls this, so it must stay cheap and never pile
  // up behind the long backoff used for the library fetch.
  const me = await apiJson<{ display_name?: string; product?: string }>("/me", undefined, {
    retries429: 0,
  });
  return { user: me.display_name ?? null, product: me.product ?? null };
}

export const spotifyGateway: SpotifyGateway = {
  getProfile,
  fetchSavedTracks: () => fetchSavedTracks(),
  removeSavedTracks,
  addSavedTracks,
  searchTracks: (q) => searchTracks(q),
  playTrack,
};

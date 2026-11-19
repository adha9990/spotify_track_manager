import { z } from "zod";
import type { SpotifyGateway } from "../../ports/spotify-gateway";
import { createSpotifyApi } from "./api";
import {
  PlaylistsPage, TrackPage, fetchPlaylistEntries, fetchPlaylists, fetchSavedTracks, fetchTrackDetails,
  mutateSaved, searchTracks,
} from "./library";
import { controlPlayback, getPlayback, playTrack } from "./playback";

// The concrete Spotify adapter: the official Web API behind the SpotifyGateway port.
const Profile = z.object({
  account_id: z.string().min(1).nullish(),
  id: z.string().min(1).optional(),
  display_name: z.string().nullable().optional(),
  product: z.string().optional(),
});

export function createSpotifyGateway(accessToken: (force?: boolean) => Promise<string>): SpotifyGateway {
  const { json, request } = createSpotifyApi(accessToken);
  const readTracks = async (endpoint: string) => TrackPage.parse(await json(endpoint));
  return {
    async getProfile() {
      const me = Profile.parse(await json("/me", undefined, { retries429: 0 }));
      const accountId = me.account_id ?? me.id;
      if (!accountId) throw new Error("Spotify 帳號缺少識別碼");
      return { accountId, user: me.display_name ?? null, product: me.product ?? null };
    },
    fetchSavedTracks: () => fetchSavedTracks(readTracks),
    fetchTrackDetails: (ids) => fetchTrackDetails(ids, json),
    fetchPlaylists: () => fetchPlaylists(async (endpoint) => PlaylistsPage.parse(await json(endpoint))),
    fetchPlaylistEntries: (id) => fetchPlaylistEntries(id, readTracks),
    removeSavedTracks: (ids) => mutateSaved(request, "DELETE", ids),
    addSavedTracks: (ids) => mutateSaved(request, "PUT", ids),
    searchTracks: (q) => searchTracks(q, json),
    playTrack: (track) => playTrack(request, track),
    getPlayback: () => getPlayback(request),
    controlPlayback: (command) => controlPlayback(request, command),
  };
}

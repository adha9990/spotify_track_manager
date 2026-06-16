import type { SearchResult, Track } from "@stm/shared";

// The Spotify operations the app needs, independent of how they're fulfilled.
// Services and the HTTP layer depend on this interface; the concrete Web API
// implementation lives in adapters/spotify. This is the dependency-inversion seam
// that keeps the inner layers free of any I/O detail.

export interface SpotifyProfile {
  user: string | null;
  product: string | null;
}

export interface SpotifyGateway {
  /** Current user's display name + product tier — used for the connection status check. */
  getProfile(): Promise<SpotifyProfile>;
  fetchSavedTracks(): Promise<Track[]>;
  removeSavedTracks(ids: string[]): Promise<void>;
  addSavedTracks(ids: string[]): Promise<void>;
  searchTracks(query: string): Promise<SearchResult[]>;
  playTrack(id: string): Promise<void>;
}

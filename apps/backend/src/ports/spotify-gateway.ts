import type {
  HistoryTrack, PlaybackCommand, PlaybackState, PlayTrackRequest, PlaylistContents, PlaylistSummary, SearchResult, Track,
} from "@stm/shared";

// The Spotify operations the app needs, independent of how they're fulfilled.
// Services and the HTTP layer depend on this interface; the concrete Web API
// implementation lives in adapters/spotify. This is the dependency-inversion seam
// that keeps the inner layers free of any I/O detail.

export interface SpotifyProfile {
  accountId: string;
  user: string | null;
  product: string | null;
}

export interface SpotifyGateway {
  /** Current user's display name + product tier — used for the connection status check. */
  getProfile(): Promise<SpotifyProfile>;
  fetchSavedTracks(): Promise<Track[]>;
  fetchTrackDetails(ids: string[]): Promise<HistoryTrack[]>;
  fetchPlaylists(): Promise<PlaylistSummary[]>;
  fetchPlaylistEntries(id: string): Promise<PlaylistContents>;
  removeSavedTracks(ids: string[]): Promise<void>;
  addSavedTracks(ids: string[]): Promise<void>;
  searchTracks(query: string): Promise<SearchResult[]>;
  playTrack(track: PlayTrackRequest): Promise<void>;
  getPlayback(): Promise<PlaybackState | null>;
  controlPlayback(command: PlaybackCommand): Promise<void>;
}

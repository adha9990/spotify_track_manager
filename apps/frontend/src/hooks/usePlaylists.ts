import { skipToken, useQuery } from "@tanstack/react-query";
import { getPlaylist, getPlaylists } from "../api/client";

export function usePlaylists(enabled: boolean) {
  return useQuery({ queryKey: ["playlists"], queryFn: getPlaylists, enabled, staleTime: 60_000 });
}

export function usePlaylist(id: string | null) {
  return useQuery({
    queryKey: ["playlist", id],
    queryFn: id ? () => getPlaylist(id) : skipToken,
    staleTime: 60_000,
    retry: false,
  });
}

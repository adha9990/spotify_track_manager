import type { Library, Track } from "@stm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTracks,
  deleteTracks,
  getHistory,
  getLibrary,
  getStatus,
  logout,
  searchTracks,
  undoBatch,
} from "../api/client";
import { replacementQueries } from "../lib/replacements";
import type { TrackVectorSource } from "../lib/similar-tracks";

const LIBRARY_KEY = ["library"] as const;
const HISTORY_KEY = ["history"] as const;

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
  });
}

export function useLogout() {
  return useMutation({ mutationFn: logout, onSuccess: () => window.location.replace("/") });
}

export function useLibrary(enabled: boolean) {
  return useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: () => getLibrary(false),
    enabled,
    staleTime: Infinity,
  });
}

export function useReplacementSearch(track: Track) {
  const queries = replacementQueries(track);
  return useQuery({
    queryKey: ["replacements", track.id, queries],
    queryFn: async ({ signal }) => {
      const searches = await Promise.allSettled(queries.map((query) => searchTracks(query, signal)));
      const failures = searches.filter((search) => search.status === "rejected").length;
      if (failures > 0 && failures === searches.length) throw new Error("無法搜尋 Spotify 曲目。");
      return {
        tracks: searches.flatMap((search) => search.status === "fulfilled" ? search.value : []),
        incomplete: failures > 0,
      };
    },
    retry: false,
  });
}

export function useReplacementScores(track: TrackVectorSource, candidates: TrackVectorSource[], searchFinished: boolean) {
  return useQuery({
    queryKey: ["replacement-scores", track, candidates],
    queryFn: async () => (await import("../lib/song-vector-index")).scoreTrackCandidates(track, candidates),
    enabled: searchFinished && candidates.length > 0,
    retry: false,
  });
}

function useLibraryMutation<TArgs>(
  fn: (args: TArgs) => Promise<unknown>,
  updateSnapshot?: (library: Library, args: TArgs) => Library,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (_, args) => {
      if (updateSnapshot) {
        await qc.cancelQueries({ queryKey: LIBRARY_KEY });
        qc.setQueryData<Library>(LIBRARY_KEY, (library) => library && updateSnapshot(library, args));
      }
    },
    onSettled: (_, error) => {
      const refresh = Promise.all([
        qc.invalidateQueries({ queryKey: LIBRARY_KEY }),
        qc.invalidateQueries({ queryKey: HISTORY_KEY }),
      ]);
      // A failed replacement may have already saved the new track. Refresh before retrying.
      if (error) return refresh;
    },
  });
}

function withoutTrack(library: Library, trackId: string) {
  return { ...library, tracks: library.tracks.filter(({ id }) => id !== trackId) };
}

export const useDeleteTrack = () => useLibraryMutation((id: string) => deleteTracks([id]), withoutTrack);

export function useReplaceTrack() {
  const qc = useQueryClient();
  return useLibraryMutation(async ({ originalId, replacementId }: { originalId: string; replacementId: string }) => {
    const saved = qc.getQueryData<Library>(LIBRARY_KEY)?.tracks.some(({ id }) => id === replacementId);
    if (!saved) {
      try {
        await addTracks([replacementId]);
      } catch {
        throw new Error("無法將替代版本加入收藏。請重試。");
      }
    }
    try {
      await deleteTracks([originalId]);
    } catch {
      throw new Error("替代版本已在收藏。移除失效歌曲失敗，請重試。");
    }
  }, (library, { originalId }) => withoutTrack(library, originalId));
}

/** The undo op-log, newest first. */
export function useHistory(enabled: boolean) {
  return useQuery({ queryKey: HISTORY_KEY, queryFn: getHistory, enabled });
}

/** Reverse a recorded batch; refreshes both the library and the op-log. */
export function useUndo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => undoBatch(batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      qc.invalidateQueries({ queryKey: HISTORY_KEY });
    },
  });
}

/** Force a fresh fetch from Spotify, replacing the cached snapshot. */
export function useRefreshLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getLibrary(true),
    onSuccess: (data) => qc.setQueryData(LIBRARY_KEY, data),
  });
}

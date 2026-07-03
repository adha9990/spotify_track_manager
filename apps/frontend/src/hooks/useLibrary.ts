import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTracks,
  deleteTracks,
  dismissSuspect,
  getHistory,
  getLibrary,
  getStatus,
  playTrack,
  searchTracks,
  undoBatch,
  type LibrarySnapshot,
} from "../api/client";
import { useUi } from "../store/ui";

const LIBRARY_KEY = ["library"] as const;
const HISTORY_KEY = ["history"] as const;

/** Poll connection status until connected, then stop. */
export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data?.connected) return false;
      // When rate-limited, poll slowly so we don't keep Spotify's throttle window
      // full (which would stop it ever clearing); otherwise poll briskly.
      return data?.error?.includes("429") ? 30000 : 6000;
    },
  });
}

/**
 * The library. Fetched once; the backend caches the snapshot. Cross-language suspects
 * are computed in the background, so while `crossLanguagePending` is true we re-fetch
 * the cached snapshot periodically until the pass finishes and merges its pairs in.
 */
export function useLibrary(enabled: boolean) {
  return useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: () => getLibrary(false),
    enabled,
    staleTime: Infinity,
    refetchInterval: (q) => (q.state.data?.crossLanguagePending ? 1500 : false),
  });
}

/** Catalog search for a dead track's replacement, gated on a non-empty query. */
export function useSearchTracks(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => searchTracks(query),
    enabled: enabled && query.trim().length > 0,
  });
}

function useLibraryMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  const clearSelection = useUi((s) => s.clearSelection);
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      // Mutations change the library AND append to the history op-log.
      qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      qc.invalidateQueries({ queryKey: HISTORY_KEY });
      clearSelection();
    },
  });
}

export const useDeleteTracks = () => useLibraryMutation((ids: string[]) => deleteTracks(ids));
export const useAddTracks = () => useLibraryMutation((ids: string[]) => addTracks(ids));

/** Dismiss a suspected-duplicate pair. Not a history op, so it doesn't touch the op-log or selection. */
export function useDismissSuspect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pairKey: string) => dismissSuspect(pairKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIBRARY_KEY });
    },
  });
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

/** Play is fire-and-forget; it does not touch the library cache. */
export function usePlayTrack() {
  return useMutation({ mutationFn: (id: string) => playTrack(id) });
}

/** Force a fresh fetch + enrichment from Spotify, replacing the cache. */
export function useRefreshLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getLibrary(true),
    onSuccess: (data: LibrarySnapshot) => qc.setQueryData(LIBRARY_KEY, data),
  });
}

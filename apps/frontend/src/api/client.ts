import type { CleanupGroup, HistoryBatch, SearchResult, SuspectPair, Track } from "@stm/shared";

// Thin typed wrapper over the local backend (vite proxies /api → 127.0.0.1:8765).
// Every call throws on a non-2xx so TanStack Query surfaces it as an error state.

export interface Status {
  connected: boolean;
  user: string | null;
  product: string | null;
  error?: string;
}

export interface LibrarySnapshot {
  tracks: Track[];
  cleanup: CleanupGroup[];
  suspects: SuspectPair[];
  fetchedAt: string;
  /** True while the cross-language suspect pass is still running in the backend; the hook polls until it clears. */
  crossLanguagePending: boolean;
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${input} → ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export const getStatus = () => json<Status>("/api/status");

export const getLibrary = (refresh = false) =>
  json<LibrarySnapshot>(`/api/library${refresh ? "?refresh=1" : ""}`);

export const deleteTracks = (ids: string[]) =>
  json<{ deleted: number }>("/api/tracks/delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });

export const addTracks = (ids: string[]) =>
  json<{ added: number }>("/api/tracks/add", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });

export const searchTracks = (q: string) =>
  json<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.results);

export const playTrack = (id: string) =>
  json<{ ok: boolean }>("/api/play", { method: "POST", body: JSON.stringify({ id }) });

export const getHistory = () =>
  json<{ batches: HistoryBatch[] }>("/api/history").then((r) => r.batches);

export const dismissSuspect = (pairKey: string) =>
  json<{ dismissed: boolean }>("/api/suspects/dismiss", {
    method: "POST",
    body: JSON.stringify({ pairKey }),
  });

export const undoBatch = (batchId: string) =>
  json<{ undone: number }>("/api/history/undo", {
    method: "POST",
    body: JSON.stringify({ batchId }),
  });

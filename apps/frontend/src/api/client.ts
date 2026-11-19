import {
  HistoryBatchSchema, LibrarySchema, PlaylistContentsSchema, PlaylistSummarySchema,
  SearchResultSchema, WebPlaybackTokenSchema, type PlayTrackRequest,
} from "@stm/shared";
import { z } from "zod";

// Thin typed wrapper over the local backend (vite proxies /api → 127.0.0.1:8765).
// Every call throws on a non-2xx so TanStack Query surfaces it as an error state.

export interface Status {
  connected: boolean;
  user: string | null;
  product: string | null;
  error?: string;
}

export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const ErrorBody = z.object({ error: z.string().optional(), message: z.string().optional() });
const PlaylistList = z.object({ playlists: z.array(PlaylistSummarySchema) });
const HistoryList = z.object({ batches: z.array(HistoryBatchSchema) });
const SearchResults = z.object({ results: z.array(SearchResultSchema) });

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const detail = ErrorBody.safeParse(await res.json().catch(() => null));
    const message = detail.success ? detail.data.message ?? detail.data.error : undefined;
    throw new RequestError(res.status, message ?? `連線失敗（${res.status}）`);
  }
  return (await res.json()) as T;
}

export const getStatus = () => json<Status>("/api/status");

export const logout = () =>
  json<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" });

export const getPlaylists = async () =>
  PlaylistList.parse(await json<unknown>("/api/playlists")).playlists;

export const getPlaylist = async (id: string) =>
  PlaylistContentsSchema.parse(await json<unknown>(`/api/playlists/${encodeURIComponent(id)}/items`));

export const getLibrary = async (refresh = false) =>
  LibrarySchema.parse(await json<unknown>(`/api/library${refresh ? "?refresh=1" : ""}`));

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

export const searchTracks = async (q: string, signal: AbortSignal) =>
  SearchResults.parse(await json<unknown>(`/api/search?q=${encodeURIComponent(q)}`, { signal })).results;

export const playTrack = (request: PlayTrackRequest) =>
  json<{ ok: boolean }>("/api/play", { method: "POST", body: JSON.stringify(request) });

export const pauseWebPlayback = (deviceId: string, signal: AbortSignal) =>
  json<{ ok: boolean }>("/api/playback", { method: "POST", body: JSON.stringify({ action: "pause", deviceId }), signal });

export async function getWebPlaybackToken(signal: AbortSignal): Promise<string> {
  const response = await json<unknown>("/api/playback/token", {
    method: "POST", body: "{}", cache: "no-store", signal,
  });
  return WebPlaybackTokenSchema.parse(response).accessToken;
}

export const getHistory = async () =>
  HistoryList.parse(await json<unknown>("/api/history")).batches;

export const undoBatch = (batchId: string) =>
  json<{ undone: number }>("/api/history/undo", {
    method: "POST",
    body: JSON.stringify({ batchId }),
  });

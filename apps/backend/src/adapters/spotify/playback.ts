import type { PlaybackCommand, PlaybackState, PlayTrackRequest } from "@stm/shared";
import { z } from "zod";
import type { SpotifyApi } from "./api";

const Restrictions = z.object({
  pausing: z.boolean().optional(),
  resuming: z.boolean().optional(),
  skipping_prev: z.boolean().optional(),
  skipping_next: z.boolean().optional(),
  seeking: z.boolean().optional(),
});

const SpotifyPlayback = z.object({
  device: z.object({
    id: z.string().nullish(),
    name: z.string(),
    is_restricted: z.boolean().optional(),
    supports_volume: z.boolean().nullish(),
    volume_percent: z.number().int().min(0).max(100).nullish(),
  }).nullish(),
  item: z.object({
    id: z.string().nullish(),
    name: z.string(),
    artists: z.array(z.object({ name: z.string() })).optional(),
    duration_ms: z.number().int().nonnegative(),
  }).nullish(),
  is_playing: z.boolean(),
  progress_ms: z.number().int().nonnegative().nullish(),
  actions: Restrictions.extend({ disallows: Restrictions.optional() }).optional(),
});

export async function getPlayback(request: SpotifyApi["request"]): Promise<PlaybackState | null> {
  const response = await request("/me/player", undefined, { retries429: 0 });
  if (response.status === 204) return null;
  if (!response.ok) {
    throw Object.assign(new Error("無法讀取 Spotify 播放狀態。"), { statusCode: response.status });
  }
  const state = SpotifyPlayback.parse(await response.json());
  const device = state.device;
  if (!device) return null;
  const restrictions = state.actions?.disallows ?? state.actions;
  const canControl = !device.is_restricted;
  return {
    item: state.item ? {
      id: state.item.id ?? null,
      name: state.item.name,
      artists: state.item.artists?.map(({ name }) => name) ?? [],
      durationMs: state.item.duration_ms,
    } : null,
    device: {
      id: device.id || null,
      name: device.name,
      volumePercent: device.volume_percent ?? null,
      supportsVolume: canControl && (device.supports_volume ?? device.volume_percent != null),
    },
    isPlaying: state.is_playing,
    positionMs: state.progress_ms ?? 0,
    canPause: canControl && !restrictions?.pausing,
    canResume: canControl && !restrictions?.resuming,
    canSkipPrevious: canControl && !restrictions?.skipping_prev,
    canSkipNext: canControl && !restrictions?.skipping_next,
    canSeek: canControl && !restrictions?.seeking && (state.item?.duration_ms ?? 0) > 0,
  };
}

const ENDPOINTS = {
  pause: { path: "pause", method: "PUT" },
  resume: { path: "play", method: "PUT" },
  previous: { path: "previous", method: "POST" },
  next: { path: "next", method: "POST" },
  volume: { path: "volume", method: "PUT" },
  seek: { path: "seek", method: "PUT" },
} as const;

export async function controlPlayback(request: SpotifyApi["request"], command: PlaybackCommand): Promise<void> {
  const { path, method } = ENDPOINTS[command.action];
  const params = new URLSearchParams();
  if (command.deviceId) params.set("device_id", command.deviceId);
  if (command.action === "volume") params.set("volume_percent", String(command.volumePercent));
  if (command.action === "seek") {
    // Spotify requires a positive position. One millisecond also plays from the start.
    params.set("position_ms", String(Math.max(1, command.positionMs)));
  }
  const query = params.size > 0 ? `?${params}` : "";
  await sendPlaybackCommand(request, `/me/player/${path}${query}`, { method });
}

export async function playTrack(request: SpotifyApi["request"], { id, deviceId, context, positionMs }: PlayTrackRequest): Promise<void> {
  const path = deviceId ? `/me/player/play?${new URLSearchParams({ device_id: deviceId })}` : "/me/player/play";
  const body = context?.type === "playlist"
    ? { context_uri: `spotify:playlist:${context.playlistId}`, offset: { position: context.position - 1 } }
    : { uris: [id, ...(context?.following ?? [])].map((trackId) => `spotify:track:${trackId}`) };
  await sendPlaybackCommand(request, path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, position_ms: positionMs }),
  }, deviceId ? "找不到 Spotify 網頁播放器。請在頁面重新連線播放器。" : undefined);
}

async function sendPlaybackCommand(
  request: SpotifyApi["request"],
  path: string,
  init: RequestInit,
  missingDeviceMessage = "找不到使用中的 Spotify 播放裝置。請先在 Spotify 開始播放。",
) {
  const response = await request(path, init);
  if (response.ok) return;
  const message = response.status === 404
    ? missingDeviceMessage
    : `Spotify 無法執行播放操作（${response.status}）。`;
  throw Object.assign(new Error(message), { statusCode: response.status });
}

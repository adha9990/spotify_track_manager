import type { PlaybackCommand } from "@stm/shared";
import { expect, it, vi } from "vitest";
import { controlPlayback, getPlayback, playTrack } from "./playback";

it("normalizes Spotify playback, preserving zero volume and device restrictions", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({
      device: { id: "test-speaker", name: "Test speaker", supports_volume: true, volume_percent: 0 },
      item: { id: "current-track", name: "Song", artists: [{ name: "First" }, { name: "Second" }], duration_ms: 240_000 },
      is_playing: true,
      progress_ms: 62_000,
      actions: { disallows: { skipping_prev: true, resuming: true, seeking: true } },
    }))
    .mockResolvedValueOnce(Response.json({
      device: { id: null, name: "Restricted speaker", is_restricted: true, volume_percent: 40 },
      item: null,
      is_playing: false,
    }))
    .mockResolvedValueOnce(Response.json({
      device: { id: "test-speaker", name: "Test speaker" },
      item: { id: "current-track", name: "Song", duration_ms: 240_000 },
      is_playing: false,
      progress_ms: 20_000,
    }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));

  await expect(getPlayback(request)).resolves.toEqual({
    device: { id: "test-speaker", name: "Test speaker", supportsVolume: true, volumePercent: 0 },
    item: { id: "current-track", name: "Song", artists: ["First", "Second"], durationMs: 240_000 },
    isPlaying: true, positionMs: 62_000,
    canPause: true, canResume: false, canSkipPrevious: false, canSkipNext: true, canSeek: false,
  });
  await expect(getPlayback(request)).resolves.toMatchObject({
    device: { id: null, supportsVolume: false },
    item: null, positionMs: 0,
    canPause: false, canResume: false, canSkipPrevious: false, canSkipNext: false, canSeek: false,
  });
  await expect(getPlayback(request)).resolves.toMatchObject({ isPlaying: false, canSeek: true, positionMs: 20_000 });
  await expect(getPlayback(request)).resolves.toBeNull();
  expect(request).toHaveBeenCalledWith("/me/player", undefined, { retries429: 0 });
});

it("uses Spotify's transport endpoints and resumes the current queue without replacing it", async () => {
  const request = vi.fn(async () => new Response(null, { status: 204 }));
  const commands: PlaybackCommand[] = [
    { action: "pause", deviceId: "speaker/id" },
    { action: "resume", deviceId: "speaker/id" },
    { action: "previous", deviceId: "speaker/id" },
    { action: "next", deviceId: null },
    { action: "volume", deviceId: "speaker/id", volumePercent: 100 },
    { action: "seek", deviceId: "speaker/id", positionMs: 25_000 },
    { action: "seek", deviceId: null, positionMs: 0 },
  ];
  for (const command of commands) await controlPlayback(request, command);
  await playTrack(request, { id: "song1" });
  await playTrack(request, {
    id: "song1",
    deviceId: "browser/id",
    context: { type: "tracks", following: ["song2", "song3"] },
  });
  await playTrack(request, {
    id: "song2",
    deviceId: "browser/id",
    context: { type: "playlist", playlistId: "playlist", position: 4 },
  });
  await playTrack(request, { id: "song1", deviceId: "browser/id", positionMs: 91_250 });
  expect(request.mock.calls).toEqual([
    ["/me/player/pause?device_id=speaker%2Fid", { method: "PUT" }],
    ["/me/player/play?device_id=speaker%2Fid", { method: "PUT" }],
    ["/me/player/previous?device_id=speaker%2Fid", { method: "POST" }],
    ["/me/player/next", { method: "POST" }],
    ["/me/player/volume?device_id=speaker%2Fid&volume_percent=100", { method: "PUT" }],
    ["/me/player/seek?device_id=speaker%2Fid&position_ms=25000", { method: "PUT" }],
    ["/me/player/seek?position_ms=1", { method: "PUT" }],
    ["/me/player/play", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: ["spotify:track:song1"] }),
    }],
    ["/me/player/play?device_id=browser%2Fid", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: ["spotify:track:song1", "spotify:track:song2", "spotify:track:song3"] }),
    }],
    ["/me/player/play?device_id=browser%2Fid", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context_uri: "spotify:playlist:playlist", offset: { position: 3 } }),
    }],
    ["/me/player/play?device_id=browser%2Fid", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: ["spotify:track:song1"], position_ms: 91_250 }),
    }],
  ]);
});

import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, delMany, setMany } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackCommandSchema, PlayTrackSchema, type PlaybackCommand, type PlayTrackRequest, type Track } from "@stm/shared";
import App from "../App";
import { compareSongs, createTrackVector, groupSimilarPairs, type IndexedSong } from "../lib/similar-tracks";
import type { SimilarityCommand, SimilarityResponse } from "../lib/similarity.worker";
import type { SpotifySdkState } from "../lib/spotify-sdk";
import { useUi } from "../store/ui";

const saved: Track = {
  id: "saved", name: "收藏歌曲", artists: ["測試藝人"], album: "專輯", albumId: "album",
  popularity: 0, durationMs: 120_000, isrc: null, isPlayable: true, releaseDate: null, addedAt: null,
};

interface TestSdkEvents {
  ready: { device_id: string };
  playback_error: { message: string };
  player_state_changed: SpotifySdkState | null;
}

type TestSdkListeners = { [K in keyof TestSdkEvents]?: (data: TestSdkEvents[K]) => void };

class TestSpotifyPlayer {
  static deviceId = "browser-device";
  static current: TestSpotifyPlayer;
  static authenticate = false;
  private listeners: TestSdkListeners = {};
  private queue: Track[] = [];
  private index = 0;
  private paused = true;
  private volume = 0.5;
  position = 0;
  disallowSeeking = false;
  commands: [string, number?][] = [];

  constructor(private options: { getOAuthToken: (deliver: (token: string) => void) => void }) {
    TestSpotifyPlayer.current = this;
  }

  addListener<K extends keyof TestSdkEvents>(event: K, listener: TestSdkListeners[K]) {
    this.listeners[event] = listener;
    return true;
  }
  async connect() {
    if (TestSpotifyPlayer.authenticate) {
      await new Promise<void>((resolve) => this.options.getOAuthToken(() => resolve()));
    }
    this.listeners.ready?.({ device_id: TestSpotifyPlayer.deviceId });
    return true;
  }
  disconnect() {}
  async activateElement() { this.commands.push(["activate"]); }
  async getVolume() { return this.volume; }
  async setVolume(volume: number) { this.commands.push(["volume", volume]); this.volume = volume; }
  async pause() { this.commands.push(["pause"]); this.paused = true; }
  async resume() { this.commands.push(["resume"]); this.paused = false; }
  async seek(ms: number) { this.commands.push(["seek", ms]); this.position = ms; }
  async nextTrack() {
    this.commands.push(["next"]);
    this.index = Math.min(this.queue.length - 1, this.index + 1);
    this.position = 0;
  }
  async previousTrack() {
    this.commands.push(["previous"]);
    this.index = Math.max(0, this.index - 1);
    this.position = 0;
  }
  start(tracks: Track[]) {
    this.queue = tracks;
    this.index = 0;
    this.position = 0;
    this.paused = false;
  }
  async getCurrentState(): Promise<SpotifySdkState | null> {
    const track = this.queue[this.index];
    if (!track) return null;
    return {
      position: this.position, duration: track.durationMs, paused: this.paused,
      disallows: { seeking: this.disallowSeeking },
      track_window: {
        current_track: { id: track.id, name: track.name, artists: track.artists.map((name) => ({ name })) },
      },
    };
  }
  async emitState() {
    this.listeners.player_state_changed?.(await this.getCurrentState());
  }
  failPlayback() {
    this.listeners.playback_error?.({ message: "Playback error" });
  }
}

beforeEach(() => {
  TestSpotifyPlayer.authenticate = false;
  vi.stubGlobal("Spotify", { Player: TestSpotifyPlayer });
});
afterEach(() => vi.unstubAllGlobals());

it("starts and controls playback on the browser device from the footer", async () => {
  const fetchedAt = "2026-11-18T10:10:00Z";
  const original = { ...saved, id: "originalTrack", name: "原本歌曲", durationMs: 244_000 };
  const next = { ...saved, id: "queuedNext", name: "新歌曲" };
  const starts: PlayTrackRequest[] = [];
  TestSpotifyPlayer.authenticate = true;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: "premium" });
    if (path === "/api/library") return Response.json({
      tracks: [original, { ...saved, id: "blocked", isPlayable: false }, next], fetchedAt,
    });
    if (path === "/api/playlists") return Response.json({ playlists: [] });
    if (path === "/api/playback/token" && init?.method === "POST") return Response.json({ accessToken: "test-access" });
    if (path === "/api/play" && init?.method === "POST") {
      const start = PlayTrackSchema.parse(JSON.parse(String(init.body)));
      starts.push(start);
      TestSpotifyPlayer.current.start([original, next]);
      return Response.json({ ok: true });
    }
    return new Response(null, { status: 404 });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

  const displayedTime = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "short", timeStyle: "short", hourCycle: "h23",
  }).format(new Date(fetchedAt));
  const timestamp = await screen.findByText((_, element) =>
    element?.tagName === "TIME" && element.textContent === displayedTime);
  expect(timestamp).toHaveAttribute("datetime", fetchedAt);
  const player = within(await screen.findByRole("region", { name: "Spotify 播放器" }));
  expect(await player.findByText("按播放，或從列表選一首歌。")).toBeVisible();
  expect(starts).toHaveLength(0);
  await user.click(player.getByRole("button", { name: "播放" }));
  expect(await player.findByText("原本歌曲")).toBeVisible();
  expect(starts).toEqual([{
    id: original.id, deviceId: TestSpotifyPlayer.deviceId, context: { type: "tracks", following: [next.id] },
  }]);
  const sdk = TestSpotifyPlayer.current;
  expect(sdk.commands).toEqual([["activate"]]);
  expect(player.getByText("測試藝人 · 收藏年鑑網頁播放器")).toBeVisible();
  expect(player.getByRole("slider", { name: "播放進度" })).toHaveAttribute("max", "244");
  expect(player.getByText("4:04")).toBeVisible();

  await user.click(player.getByRole("button", { name: "暫停" }));
  const resume = await player.findByRole("button", { name: "繼續播放" });
  await waitFor(() => expect(resume).toBeEnabled());

  const progress = player.getByRole("slider", { name: "播放進度" });
  Object.assign(progress, { setPointerCapture: vi.fn() });
  const pointerEvent = (type: string) => Object.assign(new MouseEvent(type, { bubbles: true, button: 0 }), {
    pointerId: 1, isPrimary: true,
  });
  fireEvent(progress, pointerEvent("pointerdown"));
  fireEvent.input(progress, { target: { value: "125" } });
  fireEvent.input(progress, { target: { value: "157" } });
  expect(progress).toHaveAttribute("aria-valuetext", "2:37 / 4:04");
  expect(sdk.commands).toEqual([["activate"], ["pause"]]);
  fireEvent(progress, pointerEvent("pointerup"));
  await user.click(resume);
  await waitFor(() => expect(sdk.position).toBe(157_000));
  const pause = await player.findByRole("button", { name: "暫停" });
  await waitFor(() => expect(pause).toBeEnabled());
  await user.click(pause);
  await waitFor(() => expect(player.getByRole("button", { name: "繼續播放" })).toBeEnabled());

  fireEvent.change(progress, { target: { value: "244" } });
  await waitFor(() => expect(sdk.position).toBe(243_999));
  expect(progress).toHaveAttribute("aria-valuetext", "4:04 / 4:04");
  expect(resume).toBeEnabled();

  await user.click(resume);
  await waitFor(() => expect(player.getByRole("button", { name: "暫停" })).toBeEnabled());
  await user.click(player.getByRole("button", { name: "下一首" }));
  expect(await player.findByText("新歌曲")).toBeVisible();
  const previous = player.getByRole("button", { name: "上一首" });
  await waitFor(() => expect(previous).toBeEnabled());
  await user.click(previous);
  expect(await player.findByText("原本歌曲")).toBeVisible();

  const volume = player.getByRole("slider", { name: "音量" });
  expect(volume).toHaveValue("50");
  fireEvent.change(volume, { target: { value: "31" } });
  fireEvent.change(volume, { target: { value: "25" } });
  expect(volume).toHaveAttribute("aria-valuetext", "25%");
  await waitFor(() => expect(sdk.commands.filter(([action]) => action !== "activate")).toEqual([
    ["pause"], ["seek", 157_000], ["resume"], ["pause"], ["seek", 243_999],
    ["resume"], ["next"], ["previous"], ["volume", 0.25],
  ]));
  sdk.disallowSeeking = true;
  await client.invalidateQueries({ queryKey: ["playback"] });
  await waitFor(() => expect(player.getByRole("slider", { name: "播放進度" })).toBeDisabled());
});

it("prompts for renewed authorization when the browser playback token is unavailable", async () => {
  TestSpotifyPlayer.authenticate = true;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: "premium" });
    if (path === "/api/library") return Response.json({ tracks: [saved], fetchedAt: "2026-11-18T10:10:00Z" });
    if (path === "/api/playlists") return Response.json({ playlists: [] });
    return new Response(null, { status: 403 });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
  const player = within(await screen.findByRole("region", { name: "Spotify 播放器" }));
  expect(await player.findByRole("link", { name: "重新授權 Spotify" })).toHaveAttribute("href", "/api/auth/login");
  expect(player.getByRole("button", { name: "播放" })).toBeDisabled();
});

it("holds the interrupted track and retries its last reported position after a late SDK skip", async () => {
  const selected = { ...saved, id: "originalSong", name: "原本的歌" };
  const skippedTo = { ...saved, id: "queuedSong", name: "佇列下一首" };
  const starts: PlayTrackRequest[] = [];
  const stops: PlaybackCommand[] = [];
  const acknowledgePause: (() => void)[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: "premium" });
    if (path === "/api/library") return Response.json({
      tracks: [selected, skippedTo], fetchedAt: "2026-11-19T02:00:00Z",
    });
    if (path === "/api/playlists") return Response.json({ playlists: [] });
    if (path === "/api/playback" && init?.method === "POST") {
      stops.push(PlaybackCommandSchema.parse(JSON.parse(String(init.body))));
      return new Promise<Response>((resolve) => {
        acknowledgePause.push(() => resolve(Response.json({ ok: true })));
      });
    }
    if (path === "/api/play" && init?.method === "POST") {
      const start = PlayTrackSchema.parse(JSON.parse(String(init.body)));
      starts.push(start);
      TestSpotifyPlayer.current.start([selected, skippedTo]);
      TestSpotifyPlayer.current.position = start.positionMs ?? 0;
      return Response.json({ ok: true });
    }
    return new Response(null, { status: 404 });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
  const player = within(await screen.findByRole("region", { name: "Spotify 播放器" }));
  const start = player.getByRole("button", { name: "播放" });
  await waitFor(() => expect(start).toBeEnabled());
  await user.click(start);
  expect(await player.findByText(selected.name)).toBeVisible();

  const sdk = TestSpotifyPlayer.current;
  await act(async () => {
    sdk.position = 91_250;
    await sdk.emitState();
    sdk.failPlayback();
  });
  const retry = await player.findByRole("button", { name: "重試播放" });
  expect(player.getByRole("alert")).toHaveTextContent("Spotify 串流中斷");
  expect(player.getByRole("slider", { name: "播放進度" })).toHaveAttribute("aria-valuetext", "1:31 / 2:00");
  await user.click(retry);
  await waitFor(() => expect(retry).toBeDisabled());
  await act(async () => {
    sdk.start([skippedTo]);
    await sdk.emitState();
  });
  expect(player.getByText(selected.name)).toBeVisible();
  expect(player.queryByText(skippedTo.name)).not.toBeInTheDocument();
  expect(starts).toHaveLength(1);
  expect(stops).toHaveLength(1);

  await act(async () => { acknowledgePause.shift()?.(); });
  await waitFor(() => expect(stops).toHaveLength(2));
  expect(await sdk.getCurrentState()).toMatchObject({ paused: true });
  expect(starts).toHaveLength(1);
  expect(stops).toEqual([
    { action: "pause", deviceId: TestSpotifyPlayer.deviceId },
    { action: "pause", deviceId: TestSpotifyPlayer.deviceId },
  ]);

  await act(async () => { acknowledgePause.shift()?.(); });
  await waitFor(() => expect(starts.at(-1)).toEqual({
    id: selected.id, deviceId: TestSpotifyPlayer.deviceId, positionMs: 91_250,
  }));
  await waitFor(() => expect(player.queryByRole("alert")).not.toBeInTheDocument());
});

it("requires confirmation for a single library track and removes the selection controls", async () => {
  const edition = { ...saved, id: "other", album: "精選輯", durationMs: 121_000 };
  let tracks = [saved, edition];
  const requests: string[] = [];
  vi.stubGlobal("Worker", TestWorker);
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: null });
    if (path === "/api/library") return Response.json({ tracks, fetchedAt: "2026-11-18T10:10:00Z" });
    if (path === "/api/playlists") return Response.json({ playlists: [] });
    if (path === "/api/playback") return Response.json({ playback: null });
    if (path === "/api/tracks/delete" && init?.method === "POST") {
      requests.push(String(init.body));
      if (init.body === JSON.stringify({ ids: [edition.id] })) {
        tracks = tracks.filter(({ id }) => id !== edition.id);
        return Response.json({ deleted: 1 });
      }
    }
    return new Response(null, { status: 404 });
  }));
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(380);
  const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1024);
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

    const remove = await screen.findByRole("button", { name: "從收藏刪除 收藏歌曲，精選輯" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /取消選取|刪除選取/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新整理" })).toBeVisible();
    expect(screen.getByRole("button", { name: "尋找相似歌曲" })).toBeVisible();
    await user.click(remove);

    const confirmation = within(await screen.findByRole("dialog", { name: "從收藏刪除歌曲？" }));
    expect(confirmation.getByText("收藏歌曲")).toBeVisible();
    expect(confirmation.getByText("測試藝人 · 精選輯 · 2:01")).toBeVisible();
    const cancel = confirmation.getByRole("button", { name: "取消" });
    expect(cancel).toHaveFocus();
    expect(requests).toEqual([]);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(remove).toHaveFocus());
    expect(requests).toEqual([]);

    await user.click(remove);
    await user.click(await screen.findByRole("button", { name: "確認刪除" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "從收藏刪除歌曲？" })).not.toBeInTheDocument());
    expect(requests).toEqual([JSON.stringify({ ids: [edition.id] })]);
    expect(screen.queryByRole("button", { name: "從收藏刪除 收藏歌曲，精選輯" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "從收藏刪除 收藏歌曲，專輯" })).toBeVisible();
  } finally {
    height.mockRestore();
    width.mockRestore();
  }
});

class TestWorker {
  onmessage: ((event: MessageEvent<SimilarityResponse>) => void) | null = null;
  private indexed: IndexedSong[] = [];

  postMessage(message: SimilarityCommand) {
    if (message.kind === "index") {
      const tracks = new Map<string, IndexedSong>();
      for (const { track } of message.entries) {
        const existing = tracks.get(track.id);
        if (existing) existing.durationsMs.push(track.durationMs);
        else tracks.set(track.id, { id: track.id, durationsMs: [track.durationMs], vector: createTrackVector(track) });
      }
      this.indexed = [...tracks.values()];
      this.respond({ kind: "indexed", coverage: { indexed: this.indexed.length, reused: 0, audio: 0 } });
    } else {
      this.respond({ kind: "results", groups: groupSimilarPairs(compareSongs(this.indexed), message.threshold), threshold: message.threshold });
    }
  }

  private respond(data: SimilarityResponse) {
    queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data })));
  }

  terminate() {
    this.onmessage = null;
  }
}

describe("songs source selector", () => {
  it("switches between saved tracks and playlist entries from the same tab", async () => {
    const track = { ...saved, id: "playlistTrack", name: "歌單歌曲" };
    const version = { ...track, id: "liveTrack", name: "歌單歌曲 (Live)", durationMs: 130_000 };
    const playbackRequests: string[] = [];
    vi.stubGlobal("Worker", TestWorker);
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: null });
      if (path === "/api/library") return Response.json({ tracks: [saved], fetchedAt: "2026-11-18T00:00:00Z" });
      if (path === "/api/playlists") return Response.json({
        playlists: [{ id: "ktv", name: "KTV", itemCount: 3 }],
      });
      if (path === "/api/playlists/ktv/items") return Response.json({
        entries: [{ position: 1, track }, { position: 2, track }, { position: 3, track: version }],
        skipped: 0,
      });
      if (path === "/api/play" && init?.method === "POST" && typeof init.body === "string") {
        playbackRequests.push(init.body);
        if (init.body === JSON.stringify({ id: version.id, deviceId: TestSpotifyPlayer.deviceId })) {
          return Response.json({ error: "找不到使用中的播放裝置" }, { status: 404 });
        }
        return Response.json({ ok: true });
      }
      return new Response(null, { status: 404 });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

    const source = await screen.findByLabelText("歌曲來源");
    expect(source).toHaveValue("");
    expect(await screen.findByPlaceholderText("搜尋歌曲、歌手、專輯…")).toBeInTheDocument();
    await screen.findByRole("option", { name: "KTV" });
    await user.selectOptions(source, "ktv");

    const table = await screen.findByRole("table", { name: "KTV的歌曲" });
    expect(within(table).getAllByRole("link", { name: "歌單歌曲" })).toHaveLength(2);
    await user.click(within(table).getByRole("button", { name: "播放 歌單歌曲，第 2 首" }));
    await waitFor(() => expect(playbackRequests[0]).toBe(JSON.stringify({
      id: track.id, deviceId: TestSpotifyPlayer.deviceId, context: { type: "playlist", playlistId: "ktv", position: 2 },
    })));
    expect(screen.queryByRole("button", { name: "只看重複" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清理建議" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^重複歌曲$/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /尋找相似歌曲/ })).not.toBeInTheDocument();
    const findSimilar = screen.getByRole("button", { name: "尋找相似歌曲" });
    expect(screen.getByRole("button", { name: "重新整理" }).parentElement).toContainElement(findSimilar);
    await user.click(findSimilar);
    const dialog = await screen.findByRole("dialog", { name: "相似歌曲" });
    expect(await within(dialog).findByText("門檻 70% · 找到 1 組")).toBeInTheDocument();
    expect(within(dialog).getByText("第 3 首")).toBeInTheDocument();
    const threshold = within(dialog).getByRole("spinbutton", { name: "相似度門檻 (%)" });
    expect(threshold).toHaveValue(70);
    await user.clear(threshold);
    await user.type(threshold, "90");
    await user.click(within(dialog).getByRole("button", { name: "套用門檻" }));
    expect(await within(dialog).findByText("門檻 90% · 找到 1 組")).toBeInTheDocument();
    expect(within(dialog).getByText("第 2 首")).toBeInTheDocument();
    expect(within(dialog).getByText("第 1 首")).toBeInTheDocument();
    expect(within(dialog).queryByText("第 3 首")).not.toBeInTheDocument();
    expect(within(dialog).getByText("相似度 100%")).toBeInTheDocument();
    expect(within(dialog).getByText("同一 Spotify 曲目")).toBeInTheDocument();
    await user.clear(threshold);
    await user.type(threshold, "80");
    await user.click(within(dialog).getByRole("button", { name: "套用門檻" }));
    expect(await within(dialog).findByText("第 3 首")).toBeInTheDocument();
    expect(within(dialog).getByText("門檻 80% · 找到 1 組")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "播放 歌單歌曲 (Live)，專輯，第 3 首" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("無法播放「歌單歌曲 (Live)」");
    await user.click(within(dialog).getByRole("button", { name: "播放 歌單歌曲，專輯，第 2 首" }));
    expect(await within(dialog).findByText("已將「歌單歌曲」送至網頁播放器。")).toBeInTheDocument();
    expect(playbackRequests.slice(1)).toEqual([version.id, track.id].map((id) =>
      JSON.stringify({ id, deviceId: TestSpotifyPlayer.deviceId })));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(findSimilar).toHaveFocus());
    await user.selectOptions(source, "");
    expect(screen.getByPlaceholderText("搜尋歌曲、歌手、專輯…")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "KTV的歌曲" })).not.toBeInTheDocument();
  });

  it("removes the selected edition from Liked Songs after Spotify accepts deletion", async () => {
    const first = { ...saved, id: "first", name: "收藏歌曲", isrc: "TWABC2000001", durationMs: 255_000 };
    const second = { ...first, id: "second", album: "精選輯", durationMs: 256_000 };
    let tracks = [first, second, { ...saved, name: "其他收藏" }];
    const attempts: string[] = [];
    vi.stubGlobal("Worker", TestWorker);
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: null });
      if (path === "/api/library") return Response.json({ tracks, fetchedAt: "2026-11-18T00:00:00Z" });
      if (path === "/api/playlists") return Response.json({ playlists: [] });
      if (path === "/api/tracks/delete" && init?.method === "POST" && typeof init.body === "string") {
        attempts.push(init.body);
        if (attempts.length === 1) return Response.json({ error: "Spotify 暫時無法移除曲目" }, { status: 502 });
        if (init.body === JSON.stringify({ ids: [second.id] })) {
          tracks = tracks.filter(({ id }) => id !== second.id);
          return Response.json({ deleted: 1 });
        }
      }
      return new Response(null, { status: 404 });
    }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

    await user.click(await screen.findByRole("button", { name: "尋找相似歌曲" }));
    const dialog = within(await screen.findByRole("dialog", { name: "相似歌曲" }));
    expect(await dialog.findByText("相似度 100%")).toBeInTheDocument();
    expect(dialog.getByText("ISRC 相同")).toBeInTheDocument();
    expect(dialog.getByText("時長相差 1 秒")).toBeInTheDocument();
    const remove = dialog.getByRole("button", { name: "從收藏刪除 收藏歌曲，精選輯" });
    await user.click(remove);
    const confirmation = within(await screen.findByRole("dialog", { name: "從收藏刪除歌曲？" }));
    expect(confirmation.getByText("測試藝人 · 精選輯 · 4:16")).toBeVisible();
    expect(attempts).toEqual([]);
    await user.click(confirmation.getByRole("button", { name: "確認刪除" }));
    expect(await confirmation.findByRole("alert")).toHaveTextContent("無法從收藏移除「收藏歌曲」");
    expect(dialog.getByText("相似度 100%")).toBeInTheDocument();
    await user.click(confirmation.getByRole("button", { name: "確認刪除" }));
    expect(await dialog.findByText("已從收藏移除「收藏歌曲」（精選輯 · 4:16）。可從「歷史」復原。")).toBeInTheDocument();
    expect(await dialog.findByText("門檻 70% · 找到 0 組")).toBeInTheDocument();
    const retained = within(dialog.getByRole("list", { name: "仍在收藏的其他版本" }));
    expect(retained.getByRole("link", { name: "收藏歌曲" })).toHaveAttribute("href", "https://open.spotify.com/track/first");
    expect(retained.getByRole("listitem")).toHaveTextContent("專輯 · 4:15");
    expect(attempts).toEqual([JSON.stringify({ ids: ["second"] }), JSON.stringify({ ids: ["second"] })]);
    expect(tracks.map(({ id }) => id)).toEqual(["first", "saved"]);
  });
});

it("shows each affected track and edition in a history batch", async () => {
  const first = { id: "original", name: "同名歌曲", artists: ["歌手甲", "歌手乙"], album: "單曲" };
  const second = { ...first, id: "alternate", album: "精選輯" };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: null });
    if (path === "/api/library") return Response.json({ tracks: [], fetchedAt: "2026-11-18T00:00:00Z" });
    if (path === "/api/playlists") return Response.json({ playlists: [] });
    if (path === "/api/history") return Response.json({ batches: [
      { batchId: "removed", action: "delete", ts: "2026-11-18T00:00:00Z", count: 2, undone: false, tracks: [first, second] },
      { batchId: "added", action: "add", ts: "2026-11-17T00:00:00Z", count: 1, undone: true,
        tracks: [{ id: "unknown", name: null, artists: [], album: "" }] },
    ] });
    return new Response(null, { status: 404 });
  }));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

  await user.click(await screen.findByRole("button", { name: "歷史" }));
  const dialog = within(await screen.findByRole("dialog", { name: "操作歷史" }));
  const versions = await dialog.findAllByRole("link", { name: "同名歌曲" });
  expect(versions.map((version) => version.getAttribute("href")))
    .toEqual(["https://open.spotify.com/track/original", "https://open.spotify.com/track/alternate"]);
  expect(dialog.getByText("歌手甲, 歌手乙 · 單曲")).toBeInTheDocument();
  expect(dialog.getByText("歌手甲, 歌手乙 · 精選輯")).toBeInTheDocument();
  expect(dialog.getByRole("link", { name: "曲目名稱暫無資料" })).toHaveAttribute("href", "https://open.spotify.com/track/unknown");
  expect(dialog.getByRole("button", { name: "復原" })).toBeInTheDocument();
  expect(dialog.getByText("已復原")).toBeInTheDocument();
});

describe("unplayable songs", () => {
  afterEach(() => {
    cleanup();
    useUi.getState().setTab("songs");
  });

  it("counts only unavailable tracks with no saved playable candidate", async () => {
    const cover = { ...saved, id: "cover", name: "紙舟旅行", isPlayable: false, durationMs: 160_000 };
    const recording = { ...saved, id: "recording", name: "舊名稱", isrc: "TW-ABC-20-00001", isPlayable: false };
    const live = { ...saved, id: "live", name: "星河（現場版）", isPlayable: false };
    const lone = { ...saved, id: "lone", name: "待替換曲目", isPlayable: false };
    const tracks = [cover, recording, live, lone, { ...lone, id: "unplayableTwin" },
      { ...saved, id: "original", name: "纸舟旅行", artists: ["另一位藝人"], durationMs: 280_000 },
      { ...saved, id: "sameRecording", name: "新名稱", isrc: "twabc2000001" },
      { ...saved, id: "studio", name: "星河" },
    ];
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: null });
      if (path === "/api/library") return Response.json({ tracks, fetchedAt: "2026-11-18T00:00:00Z" });
      if (path === "/api/playlists") return Response.json({ playlists: [] });
      return new Response(null, { status: 404 });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

    await user.click(await screen.findByRole("button", { name: "失效歌曲 2" }));
    const pending = within(screen.getByRole("list", { name: "待處理的失效歌曲" }));
    expect(pending.getAllByText("待替換曲目")).toHaveLength(2);
    expect(pending.queryByText("紙舟旅行")).toBeNull();
    const summary = screen.getByText("收藏中已有可播放候選 · 3 首");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await user.click(summary);
    const candidates = within(screen.getByRole("list", { name: "已有收藏候選的失效歌曲" }));
    expect(candidates.getByRole("link", { name: "纸舟旅行" })).toHaveAttribute("href", "https://open.spotify.com/track/original");
    expect(candidates.getByText("同名候選")).toBeInTheDocument();
    expect(candidates.getByRole("link", { name: "新名稱" })).toBeInTheDocument();
    expect(candidates.getByRole("link", { name: "星河" })).toBeInTheDocument();
  });

  it("retries a failed replacement and closes as soon as the removal succeeds", async () => {
    const original = { ...saved, id: "old", name: "紙舟旅行", isPlayable: false };
    const replacement = { ...saved, id: "new", name: "纸舟旅行" };
    let tracks = [original];
    let removals = 0;
    let refreshStarted = false;
    let finishRefresh = () => {};
    const pendingRefresh = new Promise<void>((resolve) => { finishRefresh = resolve; });
    const mutations: Array<{ path: string; ids: string[] }> = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: null });
      if (path === "/api/library") {
        if (removals === 2) {
          refreshStarted = true;
          await pendingRefresh;
        }
        return Response.json({ tracks, fetchedAt: "2026-11-18T00:00:00Z" });
      }
      if (path === "/api/playlists") return Response.json({ playlists: [] });
      if (path.startsWith("/api/search?")) return Response.json({ results: [replacement] });
      if (init?.method === "POST" && typeof init.body === "string") {
        mutations.push({ path, ids: JSON.parse(init.body).ids });
        if (path === "/api/tracks/add") {
          tracks = [original, replacement];
          return Response.json({ added: 1 });
        }
        if (path === "/api/tracks/delete" && ++removals > 1) {
          tracks = [replacement];
          return Response.json({ deleted: 1 });
        }
        return Response.json({ error: "暫時無法移除" }, { status: 502 });
      }
      return new Response(null, { status: 404 });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

    await user.click(await screen.findByRole("button", { name: "失效歌曲 1" }));
    await user.click(screen.getByRole("button", { name: "尋找替代" }));
    const dialog = within(await screen.findByRole("dialog", { name: "尋找替代版本" }));
    await user.click(await dialog.findByRole("button", { name: "替換" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("替代版本已在收藏。移除失效歌曲失敗");
    try {
      await user.click(await dialog.findByRole("button", { name: "替換" }));
      await waitFor(() => expect(refreshStarted).toBe(true));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "尋找替代版本" })).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "失效歌曲 0" })).toBeInTheDocument();
      expect(screen.queryByText(/收藏中已有可播放候選/)).toBeNull();
      expect(mutations).toEqual([
        { path: "/api/tracks/add", ids: ["new"] },
        { path: "/api/tracks/delete", ids: ["old"] },
        { path: "/api/tracks/delete", ids: ["old"] },
      ]);
    } finally {
      finishRefresh();
    }
  });

  it("offers only playable versions of the original song from the catalog and saved collection", async () => {
    const original = { ...saved, id: "old", name: "走過雨季 (Revisit)", primaryArtistId: "performer", isrc: "TWABC2000001", isPlayable: false };
    const savedVersion = { ...original, id: "kept", name: "走過雨季", isrc: null, isPlayable: true };
    const exactRecording = { ...savedVersion, id: "sameIsrc", name: "After the Rain", isrc: "tw-abc-20-00001" };
    const sameTitle = { ...savedVersion, id: "exact", name: "走过雨季 (Revisit)", artists: ["Artist alias"] };
    const reissue = { ...sameTitle, id: "reissue", artists: ["测试艺人"], primaryArtistId: "reissued", isrc: "TWABC2000002" };
    const results = [
      { ...original, isPlayable: true },
      { ...sameTitle, id: "otherArtist", artists: original.artists, primaryArtistId: "namesake" },
      { ...reissue, id: "otherAlbum", album: "不相符的專輯" },
      { ...reissue, id: "otherDuration", durationMs: 180_000 },
      { ...sameTitle, id: "unrelated", name: "另一首歌" },
      { ...sameTitle, id: "backing", name: "走過雨季 - 伴奏" },
      exactRecording, sameTitle, reissue,
    ];
    const queries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: null });
      if (path === "/api/library") return Response.json({ tracks: [original, savedVersion], fetchedAt: "2026-11-18T00:00:00Z" });
      if (path === "/api/playlists") return Response.json({ playlists: [] });
      if (path.startsWith("/api/search?")) {
        queries.push(new URL(path, "http://localhost").searchParams.get("q") ?? "");
        return Response.json({ results });
      }
      return new Response(null, { status: 404 });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

    await user.click(await screen.findByRole("button", { name: "失效歌曲 0" }));
    await user.click(screen.getByText("收藏中已有可播放候選 · 1 首"));
    await user.click(screen.getByRole("button", { name: "尋找替代" }));
    const dialog = within(await screen.findByRole("dialog", { name: "尋找替代版本" }));
    expect(await dialog.findByText("相同 ISRC")).toBeInTheDocument();
    const verified = dialog.getByRole("list", { name: "達門檻的替代版本" });
    const pending = await dialog.findByRole("list", { name: "待試聽的替代版本" });
    const versions = [...within(verified).getAllByRole("listitem"), ...within(pending).getAllByRole("listitem")];
    expect(versions).toHaveLength(4);
    expect(versions[0]).toHaveTextContent("After the Rain");
    expect(versions[1]).toHaveTextContent("走过雨季 (Revisit)");
    expect(versions[2]).toHaveTextContent("發行資料相符");
    expect(versions[2]).toHaveTextContent("曲目資料 98%");
    expect(versions[3]).toHaveTextContent("已收藏");
    expect(dialog.queryByText(/不相符的專輯/)).toBeNull();
    expect(dialog.queryByText("另一首歌")).toBeNull();
    expect(dialog.queryByText("走過雨季 - 伴奏")).toBeNull();
    expect(queries).toContain("isrc:TWABC2000001");
    expect(queries).toContain('track:"走過雨季" artist:"測試藝人"');
  });

  it("filters same-title replacements by the shared audio score and labels candidates without vectors", async () => {
    const original = { ...saved, id: "audioSource", name: "深夜漫步", isrc: "TWABC2000100", isPlayable: false };
    const high = { ...original, id: "audioHigh", album: "高分測試版", isrc: "TWABC2000101", isPlayable: true };
    const low = { ...high, id: "audioLow", album: "低分測試版", isrc: "TWABC2000102" };
    const missing = { ...high, id: "audioMissing", album: "缺少向量測試版", isrc: "TWABC2000103" };
    const exact = { ...high, id: "audioIsrc", album: "相同 ISRC 測試版", isrc: original.isrc };
    const store = createStore("stm-audio-index", "recordings");
    const cached = [original, high, low].map((track, i): [string, unknown] => {
      const cosine = [1, 0.99, 0.75][i]!;
      const vector = new Float32Array(1280);
      vector[0] = cosine;
      vector[1] = Math.sqrt(1 - cosine * cosine);
      return [`discogs-multi-bs64-1/audio-v1/${track.id}`, {
        title: track.name, artist: track.artists[0], durationMs: track.durationMs, isrcs: [track.isrc], vector,
      }];
    });
    await setMany(cached, store);
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path === "/api/status") return Response.json({ connected: true, user: "Tester", product: null });
      if (path === "/api/library") return Response.json({ tracks: [original], fetchedAt: "2026-11-18T00:00:00Z" });
      if (path === "/api/playlists") return Response.json({ playlists: [] });
      if (path.startsWith("/api/search?")) return Response.json({ results: [high, low, missing, exact] });
      return new Response(null, { status: 404 });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);

    try {
      await user.click(await screen.findByRole("button", { name: "失效歌曲 1" }));
      await user.click(screen.getByRole("button", { name: "尋找替代" }));
      const dialog = within(await screen.findByRole("dialog", { name: "尋找替代版本" }));
      expect(await dialog.findByText("1 個音訊比對結果低於 90% 門檻。")).toBeInTheDocument();
      const recommended = within(dialog.getByRole("list", { name: "達門檻的替代版本" }));
      expect(recommended.getAllByRole("listitem")).toHaveLength(2);
      expect(recommended.getByText("相似度 100%")).toBeInTheDocument();
      expect(recommended.getByText("相似度 98.7%")).toBeInTheDocument();
      expect(recommended.getByText("Discogs Multi")).toBeInTheDocument();
      const pending = within(dialog.getByRole("list", { name: "待試聽的替代版本" }));
      expect(pending.getByText("曲目資料 96%")).toBeInTheDocument();
      expect(pending.getByRole("listitem")).toHaveTextContent("缺少向量測試版");
      expect(dialog.queryByText(/低分測試版/)).toBeNull();

      const threshold = dialog.getByRole("spinbutton", { name: "相似度門檻 (%)" });
      await user.clear(threshold);
      await user.type(threshold, "75");
      await user.click(dialog.getByRole("button", { name: "套用門檻" }));
      expect(recommended.getByText("相似度 77.1%")).toBeInTheDocument();
    } finally {
      await delMany(cached.map(([key]) => key), store);
    }
  });
});

import type { PlaybackState } from "@stm/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getWebPlaybackToken, pauseWebPlayback, RequestError } from "../api/client";
import { getSdkItem, loadSpotifySdk, type SpotifySdkPlayer, WEB_PLAYER_NAME } from "../lib/spotify-sdk";

export const PLAYBACK_KEY = ["playback"] as const;

interface BrowserDevice {
  id: string;
  player: SpotifySdkPlayer;
}

type Connection =
  | { kind: "connecting" }
  | { kind: "ready"; deviceId: string }
  | { kind: "error"; message: string; reauthorize?: boolean };

interface PlaybackInterruption {
  trackId: string | null;
  item: PlaybackState["item"];
  positionMs: number;
}

interface PlaybackSample {
  item: NonNullable<PlaybackState["item"]>;
  positionMs: number;
  at: number;
}

interface BrowserPlayback {
  connection: Connection;
  playbackIssue: string | null;
  interruption: PlaybackInterruption | null;
  getDevice(): BrowserDevice | null;
  beginTrack(id: string): Promise<void>;
  retry(): void;
}

const BrowserPlaybackContext = createContext<BrowserPlayback | null>(null);

export function BrowserPlaybackProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<Connection>({ kind: "connecting" });
  const [playbackIssue, setPlaybackIssue] = useState<string | null>(null);
  const [interruption, setInterruption] = useState<PlaybackInterruption | null>(null);
  const [attempt, setAttempt] = useState(0);
  const device = useRef<BrowserDevice | null>(null);
  const starting = useRef<{ id: string; at: number } | null>(null);
  const lastSample = useRef<PlaybackSample | null>(null);
  const failure = useRef<PlaybackInterruption | null>(null);
  const pendingPause = useRef<Promise<void> | null>(null);
  const pausedTracks = useRef(new Set<string | null>());
  const getDevice = useCallback(() => device.current, []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const beginTrack = useCallback(async (id: string) => {
    // A late skip can add another pause while the previous one is still in flight.
    while (pendingPause.current) await pendingPause.current;
    starting.current = { id, at: Date.now() };
    lastSample.current = null;
    failure.current = null;
    pausedTracks.current.clear();
    setInterruption(null);
    setPlaybackIssue(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setConnection({ kind: "connecting" });
    setPlaybackIssue(null);
    setInterruption(null);
    starting.current = null;
    lastSample.current = null;
    failure.current = null;
    pausedTracks.current.clear();
    const controller = new AbortController();
    const { signal } = controller;
    let player: SpotifySdkPlayer | undefined;
    let connectionTimeout: number | undefined;

    function stop() {
      controller.abort();
      window.clearTimeout(connectionTimeout);
      device.current = null;
      player?.disconnect();
      player = undefined;
      pendingPause.current = null;
    }
    function fail(message: string, reauthorize = false) {
      if (signal.aborted) return;
      stop();
      setConnection({ kind: "error", message, reauthorize });
    }
    function refresh() {
      void queryClient.invalidateQueries({ queryKey: PLAYBACK_KEY, exact: false });
    }

    function stopFailedStream(current: BrowserDevice, trackId: string | null) {
      if (pausedTracks.current.has(trackId)) return;
      pausedTracks.current.add(trackId);
      const previousPause = pendingPause.current;
      const pause = (async () => {
        await previousPause;
        if (signal.aborted || device.current !== current) return;
        // The SDK can lose the stream while Spotify Connect continues advancing the queue.
        await Promise.allSettled([current.player.pause(), pauseWebPlayback(current.id, signal)]);
      })();
      pendingPause.current = pause;
      void pause.then(() => {
        if (pendingPause.current === pause) pendingPause.current = null;
      });
    }

    function captureInterruption(deviceId: string): PlaybackInterruption {
      const requested = starting.current;
      const cached = queryClient.getQueryState<PlaybackState>([...PLAYBACK_KEY, deviceId]);
      const data = cached?.data;
      const cachedAt = cached?.dataUpdatedAt ?? 0;
      const samples: PlaybackSample[] = [];
      if (lastSample.current) samples.push(lastSample.current);
      if (data?.item && (!requested || cachedAt >= requested.at)) {
        samples.push({ item: data.item, positionMs: data.positionMs, at: cachedAt });
      }
      samples.sort((a, b) => b.at - a.at);
      const startingFailed = requested && !samples.some(({ item, positionMs }) =>
        item.id === requested.id && positionMs >= 1_000);
      const trackId = startingFailed ? requested.id : samples[0]?.item.id ?? requested?.id ?? null;
      const sample = samples.find(({ item }) => item.id === trackId);
      const positionMs = sample
        ? Math.min(sample.positionMs, Math.max(0, sample.item.durationMs - 1))
        : 0;
      return { trackId, item: sample?.item ?? null, positionMs };
    }

    async function connect() {
      const Player = await loadSpotifySdk();
      if (signal.aborted) return;
      player = new Player({
        name: WEB_PLAYER_NAME,
        volume: 0.5,
        getOAuthToken: (deliver) => {
          void getWebPlaybackToken(signal).then((token) => {
            if (!signal.aborted) deliver(token);
          }).catch((error: unknown) => {
            const reauthorize = error instanceof RequestError && (error.status === 401 || error.status === 403);
            fail(reauthorize ? "請重新授權 Spotify 網頁播放。" : "無法取得 Spotify 網頁播放授權。", reauthorize);
          });
        },
      });
      const instance = player;
      instance.addListener("ready", ({ device_id }) => {
        if (signal.aborted) return;
        window.clearTimeout(connectionTimeout);
        device.current = { id: device_id, player: instance };
        setConnection({ kind: "ready", deviceId: device_id });
        setPlaybackIssue(null);
        refresh();
      });
      instance.addListener("not_ready", () => {
        if (signal.aborted) return;
        device.current = null;
        setConnection({ kind: "error", message: "Spotify 網頁播放器已離線。" });
        setPlaybackIssue(null);
      });
      instance.addListener("player_state_changed", (state) => {
        if (signal.aborted) return;
        const item = getSdkItem(state);
        if (failure.current) {
          // Spotify can emit a late skip after an error. Keep the original track and stop that stream too.
          const current = device.current;
          if (current && state && !state.paused) stopFailedStream(current, item?.id ?? null);
        } else if (state && item) {
          const expected = starting.current;
          if (!expected || item.id === expected.id) {
            lastSample.current = { item, positionMs: state.position, at: Date.now() };
            if (state.position >= 1_000) starting.current = null;
          }
          if (!state.paused) setPlaybackIssue(null);
        }
        refresh();
      });
      instance.addListener("autoplay_failed", () => {
        if (!signal.aborted) setPlaybackIssue("瀏覽器已暫停播放。請按「繼續播放」。");
      });
      instance.addListener("playback_error", () => {
        const current = device.current;
        if (signal.aborted || !current || failure.current) return;
        const snapshot = captureInterruption(current.id);
        failure.current = snapshot;
        setInterruption(snapshot);
        setPlaybackIssue(null);
        stopFailedStream(current, snapshot.trackId);
      });
      instance.addListener("authentication_error", () => fail("請重新授權 Spotify 網頁播放。", true));
      instance.addListener("account_error", () => fail("Spotify 網頁播放需要 Premium 帳號。"));
      instance.addListener("initialization_error", () => fail("無法啟動 Spotify 網頁播放器。請確認瀏覽器允許播放受保護的內容。"));

      connectionTimeout = window.setTimeout(() => fail("連線至 Spotify 網頁播放器逾時。"), 20_000);
      if (!(await instance.connect())) fail("無法連線至 Spotify 網頁播放器。");
    }

    void connect().catch(() => fail("無法開啟 Spotify 網頁播放器。"));
    return stop;
  }, [attempt, enabled, queryClient]);

  const value = useMemo(() => ({ connection, playbackIssue, interruption, getDevice, beginTrack, retry }),
    [connection, playbackIssue, interruption, getDevice, beginTrack, retry]);
  return <BrowserPlaybackContext.Provider value={value}>{children}</BrowserPlaybackContext.Provider>;
}

export function useBrowserPlayback(): BrowserPlayback {
  const value = useContext(BrowserPlaybackContext);
  if (!value) throw new Error("BrowserPlaybackProvider is missing");
  return value;
}

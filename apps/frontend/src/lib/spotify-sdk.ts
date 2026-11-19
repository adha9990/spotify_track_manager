import type { PlaybackState } from "@stm/shared";

interface SpotifySdkTrack {
  id: string | null;
  name: string;
  duration_ms?: number;
  artists?: { name: string }[];
}

export interface SpotifySdkState {
  position: number;
  duration?: number;
  paused: boolean;
  track_window: { current_track: SpotifySdkTrack | null };
  disallows?: Partial<Record<"pausing" | "resuming" | "skipping_prev" | "skipping_next" | "seeking", boolean>>;
}

interface SpotifySdkEvents {
  ready: { device_id: string };
  not_ready: { device_id: string };
  player_state_changed: SpotifySdkState | null;
  autoplay_failed: null;
  initialization_error: { message: string };
  authentication_error: { message: string };
  account_error: { message: string };
  playback_error: { message: string };
}

export interface SpotifySdkPlayer {
  addListener<K extends keyof SpotifySdkEvents>(event: K, listener: (data: SpotifySdkEvents[K]) => void): boolean;
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement(): Promise<void>;
  getCurrentState(): Promise<SpotifySdkState | null>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
}

type SpotifyPlayerConstructor = new (options: {
  name: string;
  getOAuthToken: (deliver: (token: string) => void) => void;
  volume: number;
}) => SpotifySdkPlayer;

declare global {
  interface Window {
    Spotify?: { Player: SpotifyPlayerConstructor };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export const WEB_PLAYER_NAME = "收藏年鑑網頁播放器";
let sdkLoading: Promise<SpotifyPlayerConstructor> | undefined;

export function loadSpotifySdk(): Promise<SpotifyPlayerConstructor> {
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify.Player);
  sdkLoading ??= new Promise<SpotifyPlayerConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(onError, 15_000);

    function cleanup() {
      window.clearTimeout(timeout);
      window.onSpotifyWebPlaybackSDKReady = undefined;
      script.onerror = null;
    }
    function onReady() {
      const Player = window.Spotify?.Player;
      if (!Player) return onError();
      cleanup();
      resolve(Player);
    }
    function onError() {
      cleanup();
      script.remove();
      reject(new Error("無法載入 Spotify 網頁播放器。"));
    }

    window.onSpotifyWebPlaybackSDKReady = onReady;
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = onError;
    document.head.append(script);
  }).catch((error: unknown) => {
    sdkLoading = undefined;
    throw error;
  });
  return sdkLoading;
}

export function getSdkItem(state: SpotifySdkState | null): PlaybackState["item"] {
  const track = state?.track_window?.current_track;
  return track ? {
    id: track.id,
    name: track.name,
    artists: track.artists?.map(({ name }) => name) ?? [],
    durationMs: state?.duration ?? track.duration_ms ?? 0,
  } : null;
}

export async function getSdkPlayback(player: SpotifySdkPlayer, deviceId: string): Promise<PlaybackState> {
  const [state, volume] = await Promise.all([player.getCurrentState(), player.getVolume()]);
  const item = getSdkItem(state);
  return {
    item,
    device: { id: deviceId, name: WEB_PLAYER_NAME, supportsVolume: true, volumePercent: Math.round(volume * 100) },
    isPlaying: Boolean(item && !state?.paused),
    positionMs: state?.position ?? 0,
    canPause: Boolean(item && !state?.disallows?.pausing),
    canResume: Boolean(item && !state?.disallows?.resuming),
    canSkipPrevious: Boolean(item && !state?.disallows?.skipping_prev),
    canSkipNext: Boolean(item && !state?.disallows?.skipping_next),
    canSeek: Boolean(item && item.durationMs > 0 && !state?.disallows?.seeking),
  };
}

import { MAX_UPCOMING_TRACKS, type PlaybackCommand, type PlayTrackContext, type PlayTrackRequest, type Track } from "@stm/shared";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { playTrack } from "../api/client";
import { getSdkPlayback, type SpotifySdkPlayer } from "../lib/spotify-sdk";
import { PLAYBACK_KEY, useBrowserPlayback } from "./BrowserPlaybackProvider";

const START_TRACK_KEY = ["start-track"] as const;

export function usePlayback() {
  const { connection, getDevice } = useBrowserPlayback();
  const deviceId = connection.kind === "ready" ? connection.deviceId : null;
  return useQuery({
    queryKey: [...PLAYBACK_KEY, deviceId],
    queryFn: () => {
      const device = getDevice();
      if (!device || device.id !== deviceId) return null;
      return getSdkPlayback(device.player, device.id);
    },
    enabled: deviceId !== null,
    refetchInterval: ({ state }) => {
      if (state.status === "error") return 20_000;
      return state.data?.isPlaying ? 3_000 : 6_000;
    },
    retry: false,
  });
}

function usePlaybackMutation<T>(mutationFn: (args: T) => Promise<void>, mutationKey?: readonly string[]) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    mutationKey,
    scope: { id: "spotify-playback" },
    onSettled: () => client.invalidateQueries({ queryKey: PLAYBACK_KEY }),
  });
}

function activate(player?: SpotifySdkPlayer) {
  return player?.activateElement().then(() => true, () => false);
}

export function usePlayTrack() {
  const { connection, getDevice, beginTrack } = useBrowserPlayback();
  const start = usePlaybackMutation(async ({ request, activation }: {
    request: PlayTrackRequest;
    activation: Promise<boolean> | undefined;
  }) => {
    const device = getDevice();
    if (!device || device.id !== request.deviceId) throw new Error("Spotify 網頁播放器尚未就緒。");
    if (!(await activation)) throw new Error("瀏覽器無法啟用音訊。請再按一次播放。");
    await beginTrack(request.id);
    if (getDevice()?.player !== device.player) throw new Error("Spotify 網頁播放器需要重新連線。");
    await playTrack(request);
  }, START_TRACK_KEY);
  return {
    ...start,
    canPlay: connection.kind === "ready",
    variables: start.variables?.request.id,
    mutate(id: string, context?: PlayTrackContext, positionMs?: number) {
      const device = getDevice();
      start.mutate({ request: { id, deviceId: device?.id, context, positionMs }, activation: activate(device?.player) });
    },
  };
}

export function useStartTrackStatus() {
  const states = useMutationState({ filters: { mutationKey: START_TRACK_KEY }, select: (mutation) => mutation.state });
  return states.at(-1);
}

export function usePlaybackCommand() {
  const { getDevice } = useBrowserPlayback();
  const mutation = usePlaybackMutation(async ({ command, activation }: {
    command: PlaybackCommand;
    activation: Promise<boolean> | undefined;
  }) => {
    const device = getDevice();
    if (!device || device.id !== command.deviceId) throw new Error("Spotify 網頁播放器尚未就緒。");
    if (activation && !(await activation)) throw new Error("瀏覽器無法啟用音訊。請再按一次播放。");
    const { player } = device;
    switch (command.action) {
      case "pause": return player.pause();
      case "resume": return player.resume();
      case "previous": return player.previousTrack();
      case "next": return player.nextTrack();
      case "seek": return player.seek(command.positionMs);
      case "volume": return player.setVolume(command.volumePercent / 100);
    }
  });
  return {
    ...mutation,
    mutate(command: PlaybackCommand, options?: Parameters<typeof mutation.mutate>[1]) {
      const activation = command.action === "resume" ? activate(getDevice()?.player) : undefined;
      mutation.mutate({ command, activation }, options);
    },
  };
}

export function followingTracks(tracks: Track[], index: number): PlayTrackContext {
  return {
    type: "tracks",
    following: tracks.slice(index + 1)
      .filter(({ isPlayable }) => isPlayable)
      .slice(0, MAX_UPCOMING_TRACKS)
      .map(({ id }) => id),
  };
}

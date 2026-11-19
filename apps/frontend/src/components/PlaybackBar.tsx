import type { PlaybackCommand, PlayTrackRequest } from "@stm/shared";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useBrowserPlayback } from "../hooks/BrowserPlaybackProvider";
import { usePlayback, usePlaybackCommand, usePlayTrack, useStartTrackStatus } from "../hooks/usePlayback";
import { formatDuration } from "../lib/format";
import { Button, Icon } from "./primitives";

type TransportAction = Exclude<PlaybackCommand["action"], "volume" | "seek">;

export function PlaybackBar({ firstTrack }: { firstTrack?: PlayTrackRequest }) {
  const { connection, playbackIssue, interruption, retry } = useBrowserPlayback();
  const query = usePlayback();
  const playback = query.data;
  const item = interruption ? interruption.item : playback?.item;
  const device = playback?.device;
  const transport = usePlaybackCommand();
  const start = usePlayTrack();
  const startStatus = useStartTrackStatus();
  const playing = !interruption && Boolean(playback?.isPlaying);
  const busy = !start.canPlay || transport.isPending || startStatus?.status === "pending";
  const blocked = busy || query.isError;
  const canSeek = !interruption && !blocked && Boolean(playback?.canSeek);
  const details = item?.artists.join(", ");
  const description = [details, device?.name].filter(Boolean).join(" · ");
  const playLabel = interruption ? "重試播放" : playing ? "暫停" : item ? "繼續播放" : "播放";
  const canToggle = interruption ? !busy && Boolean(interruption.trackId)
    : !blocked && Boolean(item ? (playing ? playback?.canPause : playback?.canResume) : firstTrack);

  function send(action: TransportAction) {
    transport.mutate({ action, deviceId: device?.id ?? null });
  }
  function togglePlayback() {
    if (interruption) {
      if (interruption.trackId) start.mutate(interruption.trackId, undefined, interruption.positionMs);
    } else if (item) send(playing ? "pause" : "resume");
    else if (firstTrack) start.mutate(firstTrack.id, firstTrack.context);
  }

  return (
    <section
      aria-label="Spotify 播放器"
      className="mt-3 grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(6rem,0.65fr)] items-center gap-x-4 gap-y-1.5 rounded-lg border border-stone-200 bg-white/65 px-3 py-2.5 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(7rem,0.85fr)] sm:px-4"
    >
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <p className="truncate text-sm font-semibold" title={item?.name}>
          {item?.name ?? "Spotify 網頁播放器"}
        </p>
        {description && <p className="mt-0.5 truncate text-xs text-stone-600" title={description}>{description}</p>}
        {connection.kind === "connecting" && (
          <p role="status" className="mt-0.5 text-xs text-stone-600">正在連線網頁播放器…</p>
        )}
        {connection.kind === "error" && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <p role="alert" className="text-red-700">{connection.message}</p>
            {connection.reauthorize ? (
              <a href="/api/auth/login" className="text-accent underline underline-offset-2">重新授權 Spotify</a>
            ) : (
              <Button size="sm" variant="ghost" onClick={retry}>重新連線</Button>
            )}
          </div>
        )}
        {connection.kind === "ready" && !interruption && !item && !query.isError && (
          <p className="mt-0.5 text-xs text-stone-600">{firstTrack ? "按播放，或從列表選一首歌。" : "請從列表選一首歌。"}</p>
        )}
        {query.isError && <p role="alert" className="mt-0.5 text-xs text-red-700">無法讀取 Spotify 播放狀態。</p>}
        {interruption && (
          <p role="alert" className="mt-0.5 text-xs text-red-700">
            Spotify 串流中斷。可重試原曲，若持續失敗可用 Edge 開啟此頁。
          </p>
        )}
        {!interruption && (playbackIssue || startStatus?.error) && (
          <p role="alert" className="mt-0.5 text-xs text-red-700">{playbackIssue ?? startStatus?.error?.message}</p>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex justify-center gap-1">
          <Button variant="ghost" size="icon" aria-label="上一首" title="上一首"
            disabled={blocked || !!interruption || !playback?.canSkipPrevious} onClick={() => send("previous")}>
            <Icon name="previous" />
          </Button>
          <Button variant="primary" size="icon" className="rounded-full!" aria-label={playLabel}
            title={playLabel}
            disabled={!canToggle}
            onClick={togglePlayback}>
            <Icon name={playing ? "pause" : "play"} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="下一首" title="下一首"
            disabled={blocked || !!interruption || !playback?.canSkipNext} onClick={() => send("next")}>
            <Icon name="next" />
          </Button>
        </div>
        {playback && item && item.durationMs > 0 && (
          <PlaybackProgress
            key={JSON.stringify([playback.device.id ?? playback.device.name, item.id ?? item.name, item.durationMs])}
            durationMs={item.durationMs}
            positionMs={interruption?.positionMs ?? playback.positionMs}
            deviceId={playback.device.id}
            playing={playing && !query.isError}
            sampledAt={query.dataUpdatedAt}
            canSeek={canSeek}
          />
        )}
        {transport.isError && <p role="alert" className="mt-1 text-center text-xs text-red-700">{transport.error.message}</p>}
      </div>

      {device && device.volumePercent !== null && !query.isError && (
        <VolumeControl key={device.id ?? device.name} deviceId={device.id} volumePercent={device.volumePercent} />
      )}
    </section>
  );
}

function PlaybackProgress({ durationMs, positionMs, deviceId, playing, sampledAt, canSeek }: {
  durationMs: number;
  positionMs: number;
  deviceId: string | null;
  playing: boolean;
  sampledAt: number;
  canSeek: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const [draft, setDraft] = useState<number | null>(null);
  const pointerId = useRef<number | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const seek = usePlaybackCommand();
  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [playing]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const elapsed = Math.min(durationMs, positionMs + (playing ? Math.max(0, now - sampledAt) : 0));
  const durationSeconds = Math.round(durationMs / 1000);
  const currentSecond = elapsed >= durationMs - 1 ? durationSeconds : Math.floor(elapsed / 1000);
  const shown = draft ?? currentSecond;
  const elapsedText = formatDuration(shown * 1000);
  const durationText = formatDuration(durationMs);
  const enabled = canSeek && durationSeconds > 0;

  function commitSeek(seconds: number) {
    setDraft(seconds);
    window.clearTimeout(timer.current);
    timer.current = undefined;
    // Stay within the current track when the slider is moved to its end.
    const targetMs = Math.min(seconds * 1000, durationMs - 1);
    seek.mutate({ action: "seek", deviceId, positionMs: targetMs }, {
      onSettled: () => {
        if (timer.current === undefined && pointerId.current === undefined) setDraft(null);
      },
    });
  }

  function scheduleSeek(seconds: number) {
    setDraft(seconds);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commitSeek(seconds), 150);
  }

  function startScrubbing(event: PointerEvent<HTMLInputElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    pointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setDraft(event.currentTarget.valueAsNumber);
  }

  function finishScrubbing(event: PointerEvent<HTMLInputElement>) {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = undefined;
    commitSeek(event.currentTarget.valueAsNumber);
  }

  function cancelScrubbing(event: PointerEvent<HTMLInputElement>) {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = undefined;
    setDraft(null);
  }

  return (
    <>
      <div className="nums mt-1 flex items-center gap-2 text-[11px] text-stone-600">
        <span>{elapsedText}</span>
        <input
          type="range"
          min="0"
          max={durationSeconds}
          step="1"
          value={shown}
          disabled={!enabled}
          aria-label="播放進度"
          aria-valuetext={`${elapsedText} / ${durationText}`}
          title={enabled ? "點擊或拖曳跳到指定時間" : "目前無法跳轉播放進度"}
          className="h-6 min-w-0 flex-1 touch-pan-y cursor-pointer accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default"
          onChange={(event) => {
            const seconds = event.currentTarget.valueAsNumber;
            if (pointerId.current === undefined) scheduleSeek(seconds);
            else setDraft(seconds);
          }}
          onPointerDown={startScrubbing}
          onPointerUp={finishScrubbing}
          onPointerCancel={cancelScrubbing}
          onLostPointerCapture={cancelScrubbing}
        />
        <span>{durationText}</span>
      </div>
      {seek.isError && <p role="alert" className="text-center text-xs text-red-700">無法跳到指定時間。請重試。</p>}
    </>
  );
}

function VolumeControl({ deviceId, volumePercent }: { deviceId: string | null; volumePercent: number }) {
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const volume = usePlaybackCommand();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const shown = draft ?? volumePercent;

  function changeVolume(value: number) {
    setDraft(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      volume.mutate({ action: "volume", deviceId, volumePercent: value }, {
        onSettled: () => {
          if (timer.current === undefined) setDraft(null);
        },
      });
    }, 250);
  }

  return (
    <div className="w-full max-w-40 justify-self-end">
      <label className="flex items-center gap-1.5 text-stone-600">
        <Icon name="volume" className="hidden h-4 w-4 shrink-0 md:block" />
        <span className="sr-only">音量</span>
        <input type="range" min="0" max="100" step="1" value={shown} aria-valuetext={`${shown}%`}
          className="h-10 min-w-0 flex-1 cursor-pointer accent-accent focus-visible:outline-2 focus-visible:outline-accent"
          onChange={(event) => changeVolume(event.currentTarget.valueAsNumber)} />
        <span className="nums w-8 text-right text-xs" aria-hidden>{shown}%</span>
      </label>
      {volume.isError && <p role="alert" className="text-xs text-red-700">{volume.error.message}</p>}
    </div>
  );
}

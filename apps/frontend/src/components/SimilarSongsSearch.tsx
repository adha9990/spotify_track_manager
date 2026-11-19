import type { Track } from "@stm/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayTrack } from "../hooks/usePlayback";
import { formatDuration } from "../lib/format";
import type { SimilarGroup, SimilarPair, SongEntry } from "../lib/similar-tracks";
import type { SimilarityCommand, SimilarityResponse } from "../lib/similarity.worker";
import { Dialog } from "./Dialog";
import { Badge, Button, Icon } from "./primitives";
import { SimilarityThreshold } from "./SimilarityThreshold";
import { TrackRemovalDialog, type TrackRemovalTarget } from "./TrackRemovalDialog";

const defaultThreshold = 70;
const pageSize = 20;
const percent = (score: number) => `${score}%`;
const nameOf = (track: Track) => track.name || "未命名曲目";
const describeEdition = (track: Track) => [track.album, track.durationMs > 0 ? formatDuration(track.durationMs) : ""]
  .filter(Boolean).join(" · ");

export function SimilarSongsSearch({
  entries, source, removable = false,
}: {
  entries: SongEntry[];
  source: string;
  removable?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const removalStatus = useRef<HTMLDivElement>(null);
  const play = usePlayTrack();
  const [removal, setRemoval] = useState<(TrackRemovalTarget & { relatedIds: string[] }) | null>(null);
  const [removed, setRemoved] = useState<{ track: Track; relatedIds: string[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<{ entries: SongEntry[]; response: SimilarityResponse } | null>(null);
  const [coverage, setCoverage] = useState<{
    entries: SongEntry[];
    response: Extract<SimilarityResponse, { kind: "indexed" }>;
  } | null>(null);
  const [draft, setDraft] = useState(String(defaultThreshold));
  const [request, setRequest] = useState({ threshold: defaultThreshold });
  const [visibleGroups, setVisibleGroups] = useState(pageSize);

  useEffect(() => {
    if (entries.length === 0) return;
    setStatus(null);
    setCoverage(null);
    const fail = () => {
      setCoverage(null);
      setStatus({ entries, response: { kind: "error", stage: "index" } });
    };
    let worker: Worker;
    try {
      worker = new Worker(new URL("../lib/similarity.worker.ts", import.meta.url), { type: "module" });
    } catch {
      fail();
      return;
    }
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<SimilarityResponse>) => {
      if (data.kind === "indexed") setCoverage({ entries, response: data });
      setStatus({ entries, response: data });
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    const command: SimilarityCommand = { kind: "index", entries };
    worker.postMessage(command);
    return () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      workerRef.current = null;
    };
  }, [entries, attempt]);

  const ready = coverage?.entries === entries ? coverage.response.coverage : null;
  useEffect(() => {
    if (!open || !ready) return;
    setStatus(null);
    const command: SimilarityCommand = { kind: "query", threshold: request.threshold };
    workerRef.current?.postMessage(command);
  }, [open, ready, request]);

  const entryById = useMemo(() => {
    const map = new Map<string, SongEntry[]>();
    for (const entry of entries) {
      const sameTrack = map.get(entry.track.id);
      if (sameTrack) sameTrack.push(entry);
      else map.set(entry.track.id, [entry]);
    }
    return map;
  }, [entries]);

  const response = status?.entries === entries ? status.response : null;
  const failure = response?.kind === "error" ? response.stage : null;
  const result = response?.kind === "results" && response.threshold === request.threshold ? response : null;
  const playbackTitle = play.variables ? entryById.get(play.variables)?.[0]?.track.name : undefined;
  const retained = removed ? removed.relatedIds.flatMap((id) => entryById.get(id) ?? []) : [];
  function requestRemoval(target: TrackRemovalTarget, groupIds: string[]) {
    setRemoval({ ...target, relatedIds: groupIds.filter((id) => id !== target.track.id) });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 whitespace-nowrap"
        aria-haspopup="dialog"
        disabled={entries.length < 2}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          if (!play.isPending) play.reset();
          setRemoved(null);
          setVisibleGroups(pageSize);
          setOpen(true);
        }}
      >
        <Icon name="search" className="h-3.5 w-3.5" />
        尋找相似歌曲
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          if (!trigger.current?.isConnected) return;
          event.preventDefault();
          trigger.current.focus();
        }}
        title="相似歌曲"
        description={`比對「${source}」的全部曲目。`}
        width="max-w-2xl"
      >
        {ready && (
          <p className="mb-3 text-sm text-stone-600" aria-live="polite">
            曲目資料向量 {ready.indexed} 首 · Discogs Multi 音訊向量 {ready.audio} 首
            {ready.reused > 0 && ` · 沿用 ${ready.reused} 首曲目向量`}
          </p>
        )}
        <SimilarityThreshold
          value={draft}
          onChange={setDraft}
          disabled={!ready || (!result && !failure)}
          onApply={(threshold) => {
            setVisibleGroups(pageSize);
            setRequest({ threshold });
          }}
        />
        {play.isError && (
          <p role="alert" className="pb-3 text-sm text-red-700">
            無法播放「{playbackTitle ?? "這首歌"}」。{play.error.message}
          </p>
        )}
        {play.isSuccess && (
          <p role="status" className="pb-3 text-sm text-stone-600">
            已將「{playbackTitle ?? "這首歌"}」送至網頁播放器。
          </p>
        )}
        {removed && (
          <div ref={removalStatus} tabIndex={-1} role="status" className="mb-3 rounded-md border border-stone-200 bg-white/60 px-3 py-2 text-sm text-stone-600">
            <p>
              {entryById.has(removed.track.id) ? "目前收藏仍有" : "已從收藏移除"}「{nameOf(removed.track)}」
              {describeEdition(removed.track) && `（${describeEdition(removed.track)}）`}。
              {!entryById.has(removed.track.id) && "可從「歷史」復原。"}
            </p>
            {retained.length > 0 ? (
              <>
                <p className="mt-1 font-medium text-ink">仍在收藏的其他版本</p>
                <ul aria-label="仍在收藏的其他版本" className="max-h-24 overflow-y-auto">
                  {retained.map(({ track }) => (
                    <li key={track.id} className="break-words">
                      <SpotifyTrackLink track={track} />
                      {describeEdition(track) && ` · ${describeEdition(track)}`}
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="mt-1">目前收藏清單中找不到這組的其他版本。</p>}
          </div>
        )}
        {entries.length < 2 ? (
          <p className="py-3 text-sm text-stone-600">至少需要兩筆曲目才能比對。</p>
        ) : failure ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 py-3 text-sm text-red-700">
            {failure === "index" ? "無法讀寫本機曲目向量資料庫。" : "無法完成相似歌曲比對。"}
            <Button type="button" size="sm" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>重試</Button>
          </div>
        ) : !result ? (
          <p role="status" className="py-3 text-sm text-stone-600">
            {ready ? "正在比對相似度…" : "正在準備曲目向量…"}
          </p>
        ) : (
          <>
            <p role="status" className="pb-2 text-sm text-stone-600">
              門檻 {percent(result.threshold)} · 找到 {result.groups.length} 組
            </p>
            {result.groups.length === 0 ? (
              <p className="rounded-md border border-stone-200 p-4 text-sm text-stone-600">沒有歌曲組合達到目前的相似度門檻。</p>
            ) : (
              <div className="max-h-[50dvh] space-y-3 overflow-y-auto overscroll-contain pr-1">
                <ol className="space-y-3">
                  {result.groups.slice(0, visibleGroups).map((group, index) => (
                    <GroupCard
                      key={group.ids[0]}
                      group={group}
                      position={index + 1}
                      entries={entryById}
                      canPlay={play.canPlay}
                      pendingTrackId={play.isPending ? play.variables : undefined}
                      onPlay={play.mutate}
                      onRemove={removable ? requestRemoval : undefined}
                    />
                  ))}
                </ol>
                {visibleGroups < result.groups.length && (
                  <Button type="button" onClick={() => setVisibleGroups((count) => count + pageSize)}>顯示更多組</Button>
                )}
              </div>
            )}
          </>
        )}
        {removal && (
          <TrackRemovalDialog
            target={removal}
            fallbackFocus={removalStatus}
            onClose={() => setRemoval(null)}
            onRemoved={() => setRemoved({ track: removal.track, relatedIds: removal.relatedIds })}
          />
        )}
      </Dialog>
    </>
  );
}

function GroupCard({
  group, position, entries, canPlay, pendingTrackId, onPlay, onRemove,
}: {
  group: SimilarGroup;
  position: number;
  entries: Map<string, SongEntry[]>;
  canPlay: boolean;
  pendingTrackId?: string;
  onPlay: (trackId: string) => void;
  onRemove?: (target: TrackRemovalTarget, groupIds: string[]) => void;
}) {
  const best = group.pairs[0]!;
  return (
    <li className="rounded-md border border-stone-200 bg-white/60 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">第 {position} 組</h3>
        <Badge tone="accent">{group.pairs.length > 1 ? "最高相似度" : "相似度"} {percent(best.similarity)}</Badge>
      </div>
      <ul className="mt-2 divide-y divide-stone-200/80">
        {group.ids.flatMap((id) => entries.get(id) ?? []).map(({ track, position }) => (
          <li key={position ?? track.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0 break-words">
              <p className="text-sm font-semibold">
                {position !== undefined && <span className="mr-2 text-xs font-medium text-stone-500">第 {position} 首</span>}
                <SpotifyTrackLink track={track} />
              </p>
              <p className="text-xs text-stone-600">
                {[track.artists.join(", "), describeEdition(track)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 whitespace-nowrap">
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={[`播放 ${nameOf(track)}`, track.album, position === undefined ? "" : `第 ${position} 首`].filter(Boolean).join("，")}
                disabled={!canPlay || !track.isPlayable || pendingTrackId !== undefined}
                onClick={() => onPlay(track.id)}
              >
                <Icon name="play" className="h-3.5 w-3.5" />
                {!track.isPlayable ? "無法播放" : pendingTrackId === track.id ? "連線中…" : "播放"}
              </Button>
              {onRemove && (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  aria-label={[`從收藏刪除 ${nameOf(track)}`, track.album].filter(Boolean).join("，")}
                  aria-haspopup="dialog"
                  onClick={(event) => onRemove({ track, trigger: event.currentTarget }, group.ids)}
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                  刪除
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {group.pairs.length === 1 ? (
        <MatchEvidence pair={best} />
      ) : (
        <details className="mt-1 border-t border-stone-200 pt-2 text-xs text-stone-600">
          <summary className="cursor-pointer font-medium">各配對相似度 ({group.pairs.length})</summary>
          <ul className="mt-2 divide-y divide-stone-200">
            {group.pairs.map((pair) => {
              const left = entries.get(pair.left)?.[0]?.track.name;
              const right = entries.get(pair.right)?.[0]?.track.name;
              return (
                <li key={`${pair.left}:${pair.right}`} className="break-words py-2">
                  <p className="font-medium text-ink">
                    {left}{pair.left !== pair.right && ` ↔ ${right}`} · {percent(pair.similarity)}
                  </p>
                  <MatchEvidence pair={pair} />
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </li>
  );
}

function SpotifyTrackLink({ track }: { track: Track }) {
  return (
    <a
      href={`https://open.spotify.com/track/${encodeURIComponent(track.id)}`}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline decoration-stone-300 underline-offset-4"
    >
      {nameOf(track)}
    </a>
  );
}

function MatchEvidence({ pair }: { pair: SimilarPair }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {pair.audioSimilarity === null
        ? <Badge>曲目資料</Badge>
        : <Badge tone="accent">Discogs Multi ＋ 曲目資料</Badge>}
      {pair.hints.map((hint) => <Badge key={hint}>{hint}</Badge>)}
    </div>
  );
}

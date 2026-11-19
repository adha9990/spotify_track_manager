import type { Track } from "@stm/shared";
import { useMemo, useState } from "react";
import { useLibrary, useReplacementScores, useReplacementSearch, useReplaceTrack } from "../hooks/useLibrary";
import { usePlayTrack } from "../hooks/usePlayback";
import { formatDuration } from "../lib/format";
import { matchingReplacements, type ReplacementMatch } from "../lib/replacements";
import { Badge, Button, Icon } from "./primitives";
import { Dialog } from "./Dialog";
import { SimilarityThreshold } from "./SimilarityThreshold";

const defaultThreshold = 90;
const matchLabels: Record<ReplacementMatch, string> = {
  isrc: "相同 ISRC",
  title: "同歌名與藝人",
  release: "發行資料相符",
  version: "同曲其他版本",
};

type RankedReplacement = ReturnType<typeof matchingReplacements>[number] & {
  score: number | null;
  evidence: "isrc" | "audio" | "metadata";
};

export function ReplaceDialog({
  track,
  onClose,
}: {
  track: Track;
  onClose: () => void;
}) {
  const replacement = useReplaceTrack();
  const play = usePlayTrack();
  const results = useReplacementSearch(track);
  const saved = useLibrary(true).data?.tracks;
  const catalog = results.data?.tracks;
  const versions = useMemo(() => matchingReplacements(track, saved ?? [], catalog ?? []), [track, saved, catalog]);
  const comparable = useMemo(() => versions.filter(({ match }) => match !== "isrc").map(({ track }) => track), [versions]);
  const scores = useReplacementScores(track, comparable, !results.isPending);
  const [thresholdDraft, setThresholdDraft] = useState(String(defaultThreshold));
  const [threshold, setThreshold] = useState(defaultThreshold);
  const scoringPending = comparable.length > 0 && (scores.isPending || scores.isFetching);
  const searchFailed = results.isError || results.data?.incomplete;
  const recommended: RankedReplacement[] = [];
  const needsListening: RankedReplacement[] = [];
  let audioCompared = 0;
  let belowThreshold = 0;
  for (const version of versions) {
    const pair = scores.data?.get(version.track.id);
    if (version.match === "isrc") {
      recommended.push({ ...version, score: 100, evidence: "isrc" });
    } else if (pair?.audioSimilarity != null) {
      audioCompared++;
      if (pair.similarity >= threshold) recommended.push({ ...version, score: pair.similarity, evidence: "audio" });
      else belowThreshold++;
    } else if (!scoringPending) {
      needsListening.push({ ...version, score: pair?.similarity ?? null, evidence: "metadata" });
    }
  }
  recommended.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  needsListening.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const actions = {
    playing: play.isPending || !play.canPlay,
    replacing: replacement.isPending,
    onPlay: play.mutate,
    onReplace: (id: string) => replacement.mutate({ originalId: track.id, replacementId: id }, { onSuccess: onClose }),
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      width="max-w-lg"
      title="尋找替代版本"
      description={`尋找「${track.name}」的可播放版本，並比對相同 ISRC 或音訊相似度。`}
    >
      {results.isPending && <p role="status" className="py-2 text-sm text-stone-600">正在核對可播放的版本…</p>}
      {searchFailed && (
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <p role="alert" className="text-sm text-red-700">{results.isError ? "無法搜尋 Spotify 曲目。" : "部分搜尋無法完成。"}</p>
          <Button size="sm" variant="outline" disabled={results.isFetching} onClick={() => void results.refetch()}>重試</Button>
        </div>
      )}
      {!results.isPending && !searchFailed && versions.length === 0 && (
        <p className="rounded-md border border-stone-200 p-4 text-sm text-stone-600">找不到能核對為同一首歌的可播放版本。</p>
      )}
      {!results.isPending && scoringPending && (
        <p role="status" className="py-2 text-sm text-stone-600">正在比對曲目向量…</p>
      )}
      {audioCompared > 0 && (
        <>
          <SimilarityThreshold value={thresholdDraft} onChange={setThresholdDraft} onApply={setThreshold} />
          {belowThreshold > 0 && <p role="status" className="pb-2 text-sm text-stone-600">{belowThreshold} 個音訊比對結果低於 {threshold}% 門檻。</p>}
        </>
      )}
      <div className="max-h-[min(24rem,52dvh)] space-y-3 overflow-y-auto overscroll-contain">
        {recommended.length > 0 && <ReplacementList label="達門檻的替代版本" versions={recommended} {...actions} />}
        {needsListening.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold">待試聽確認 · {needsListening.length} 首</h3>
            <p className="pb-2 text-xs text-stone-600">
              {scores.isError ? "無法讀取本機音訊向量。" : "原曲與這些版本缺少可配對的音訊向量。"}
            </p>
            <ReplacementList label="待試聽的替代版本" versions={needsListening} {...actions} />
          </section>
        )}
      </div>

      {replacement.isError && <p role="alert" className="mt-2 text-sm text-red-700">{replacement.error.message}</p>}
      {play.isError && (
        <p role="alert" className="mt-2 text-xs text-red-700">無法試聽。{play.error.message}</p>
      )}
    </Dialog>
  );
}

function ReplacementList({ label, versions, playing, replacing, onPlay, onReplace }: {
  label: string;
  versions: RankedReplacement[];
  playing: boolean;
  replacing: boolean;
  onPlay: (id: string) => void;
  onReplace: (id: string) => void;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-stone-100 rounded-md border border-stone-200">
      {versions.map(({ track, match, saved, score, evidence }) => {
        const edition = [track.artists.join(", "), track.album, track.durationMs > 0 ? formatDuration(track.durationMs) : ""]
          .filter(Boolean).join(" · ");
        return (
          <li key={track.id} className="flex items-center gap-3 px-3 py-2">
            <button
              type="button"
              onClick={() => onPlay(track.id)}
              aria-label={`試聽 ${track.name}`}
              disabled={playing}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-accent hover:text-white"
            >
              <Icon name="play" className="h-3.5 w-3.5" />
            </button>
            <div className="min-w-0 flex-1 break-words">
              <div className="text-sm font-medium">{track.name}</div>
              <div className="text-xs text-stone-500">{edition}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {score !== null && <Badge tone={evidence === "metadata" ? "neutral" : "accent"}>
                  {evidence === "metadata" ? "曲目資料" : "相似度"} {score}%
                </Badge>}
                {evidence === "audio" && <Badge>Discogs Multi</Badge>}
                <Badge>{matchLabels[match]}</Badge>
                {saved && <Badge tone="accent">已收藏</Badge>}
              </div>
            </div>
            <Button size="sm" variant="primary" className="shrink-0" disabled={replacing} onClick={() => onReplace(track.id)}>
              <Icon name="swap" className="h-3.5 w-3.5" />
              替換
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

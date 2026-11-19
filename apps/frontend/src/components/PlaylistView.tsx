import type { PlaylistContents, PlaylistEntry, PlaylistSummary } from "@stm/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { useId } from "react";
import { usePlayTrack } from "../hooks/usePlayback";
import { formatDuration } from "../lib/format";
import { Button, Icon } from "./primitives";
import { SimilarSongsSearch } from "./SimilarSongsSearch";

export function PlaylistView({ playlist, contents }: {
  playlist: PlaylistSummary;
  contents: UseQueryResult<PlaylistContents>;
}) {
  const play = usePlayTrack();
  const captionId = useId();
  if (contents.isPending) return <p role="status" className="pt-4 text-stone-500">正在載入曲目…</p>;
  if (contents.isError) {
    const denied = "status" in contents.error && contents.error.status === 403;
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 pt-4 text-sm text-red-700">
        {denied ? "Spotify 只開放你擁有或協作的歌單。請選擇另一張歌單。" : "無法載入這張歌單。"}
        {!denied && <Button size="sm" variant="ghost" onClick={() => void contents.refetch()}>重試</Button>}
      </div>
    );
  }

  const { entries, skipped } = contents.data;
  return (
    <section aria-label={playlist.name} className="flex min-h-0 flex-1 flex-col gap-3 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-stone-600">
          {entries.length} 首歌曲{skipped > 0 && ` · 略過 ${skipped} 筆非曲目或無法取得的項目`}
        </p>
        <Button size="sm" variant="ghost" disabled={contents.isFetching} onClick={() => void contents.refetch()}>
          重新整理
        </Button>
        <SimilarSongsSearch entries={entries} source={playlist.name} />
        <a
          href={`https://open.spotify.com/playlist/${encodeURIComponent(playlist.id)}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-accent underline underline-offset-4"
        >
          在 Spotify 開啟歌單
        </a>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-white/60 p-8 text-center text-stone-600">
          這張歌單沒有可顯示的歌曲。
        </p>
      ) : (
        <div
          role="region"
          aria-labelledby={captionId}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto rounded-lg border border-stone-200 bg-white/60 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-sm">
            <caption id={captionId} className="sr-only">{playlist.name}的歌曲</caption>
            <thead className="sticky top-0 bg-stone-100 text-left text-stone-600">
              <tr>
                <th scope="col" className="px-3 py-2">位置</th>
                <th scope="col" className="px-3 py-2">歌曲</th>
                <th scope="col" className="px-3 py-2">藝人</th>
                <th scope="col" className="px-3 py-2">專輯</th>
                <th scope="col" className="px-3 py-2 text-right">時長</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <EntryRow
                  key={entry.position}
                  entry={entry}
                  canPlay={play.canPlay && !play.isPending}
                  onPlay={() => play.mutate(entry.track.id, {
                    type: "playlist", playlistId: playlist.id, position: entry.position,
                  })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EntryRow({ entry: { position, track }, canPlay, onPlay }: {
  entry: PlaylistEntry;
  canPlay: boolean;
  onPlay: () => void;
}) {
  const cell = "border-b border-stone-200/70 px-3 py-3";
  return (
    <tr>
      <td className={`${cell} nums text-stone-500`}>{position}</td>
      <td className={`${cell} font-medium`}>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="shrink-0"
            disabled={!canPlay || !track.isPlayable}
            aria-label={`播放 ${track.name || "未命名曲目"}，第 ${position} 首`}
            onClick={onPlay}>
            <Icon name="play" className="h-3.5 w-3.5" />
          </Button>
          <a
            href={`https://open.spotify.com/track/${encodeURIComponent(track.id)}`}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-stone-300 underline-offset-4 hover:text-accent"
          >
            {track.name || "未命名曲目"}
          </a>
        </div>
      </td>
      <td className={cell}>{track.artists.join(", ")}</td>
      <td className={cell}>{track.album}</td>
      <td className={`${cell} nums text-right`}>{track.durationMs > 0 ? formatDuration(track.durationMs) : "—"}</td>
    </tr>
  );
}

import type { Track } from "@stm/shared";
import { useState } from "react";
import { useAddTracks, useDeleteTracks, usePlayTrack, useSearchTracks } from "../hooks/useLibrary";
import { formatDuration } from "../lib/format";
import { Button, Icon } from "./primitives";
import { Dialog } from "./Dialog";

// Find a live replacement for a dead track: search the catalog (seeded with the
// track's own name + artist), and on pick, add the replacement and remove the dead
// one in one gesture.
export function ReplaceDialog({
  track,
  open,
  onOpenChange,
}: {
  track: Track | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const seed = track ? `${track.name} ${track.artists[0] ?? ""}`.trim() : "";
  const [query, setQuery] = useState(seed);
  const add = useAddTracks();
  const del = useDeleteTracks();
  const play = usePlayTrack();

  // Reset the query to the seed whenever a different dead track is opened.
  const [lastSeed, setLastSeed] = useState(seed);
  if (seed !== lastSeed) {
    setLastSeed(seed);
    setQuery(seed);
  }

  const results = useSearchTracks(query, open);

  const replace = (replacementId: string) => {
    if (!track) return;
    add.mutate([replacementId], {
      onSuccess: () => del.mutate([track.id], { onSuccess: () => onOpenChange(false) }),
    });
  };

  const busy = add.isPending || del.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="max-w-lg"
      title="尋找替代版本"
      description={track ? `為失效的「${track.name}」找一個可播放的版本。` : undefined}
    >
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋歌曲…"
          className="h-9 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div className="mt-3 max-h-72 overflow-auto rounded-md border border-stone-200">
        {results.isPending && query.trim() && <p className="p-4 text-sm text-stone-400">搜尋中…</p>}
        {results.data?.length === 0 && (
          <p className="p-4 text-sm text-stone-400">沒有結果(已濾除不可播放的版本)</p>
        )}
        {results.data?.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-3 border-b border-stone-100 px-3 py-2 last:border-0 hover:bg-stone-50"
          >
            <button
              onClick={() => play.mutate(r.id)}
              title="試聽"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-accent hover:text-white"
            >
              <Icon name="play" className="h-3.5 w-3.5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.name}</div>
              <div className="truncate text-xs text-stone-500">
                {r.artist} · {r.album} · {formatDuration(r.durationMs)}
              </div>
            </div>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => replace(r.id)}>
              <Icon name="swap" className="h-3.5 w-3.5" />
              替換
            </Button>
          </div>
        ))}
      </div>

      {play.isError && (
        <p className="mt-2 text-xs text-red-700">無法播放:請先開啟 Spotify 播放器(需 Premium)。</p>
      )}
    </Dialog>
  );
}

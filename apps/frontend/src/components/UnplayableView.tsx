import type { Track } from "@stm/shared";
import { useState } from "react";
import { useDeleteTracks } from "../hooks/useLibrary";
import { Button, Icon } from "./primitives";
import { ReplaceDialog } from "./ReplaceDialog";

// Dead (unplayable) tracks, with two ways out: swap in a working version, or just
// remove the dead entry.
export function UnplayableView({ tracks }: { tracks: Track[] }) {
  const [replacing, setReplacing] = useState<Track | null>(null);
  const del = useDeleteTracks();

  if (tracks.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-stone-400">
        <Icon name="check" className="h-10 w-10 text-emerald-500" />
        <p className="text-lg">沒有失效歌曲,收藏全部可播放。</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
        這些歌曲在你所在的地區已無法播放(下架或版權變動)。可以尋找可播放的替代版本,或直接移除。
      </p>

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-stone-200 bg-white/60">
        {tracks.map((track) => (
          <div
            key={track.id}
            className="grid items-center gap-3 border-b border-stone-200/70 px-4 py-2.5 text-sm"
            style={{ gridTemplateColumns: "minmax(180px,1.8fr) minmax(120px,1.2fr) minmax(120px,1fr) auto" }}
          >
            <span className="truncate font-medium">{track.name}</span>
            <span className="truncate text-stone-500">{track.artists.join(", ")}</span>
            <span className="truncate text-stone-400">{track.album}</span>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="primary" onClick={() => setReplacing(track)}>
                <Icon name="swap" className="h-3.5 w-3.5" />
                尋找替代
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={del.isPending}
                onClick={() => del.mutate([track.id])}
              >
                移除
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ReplaceDialog track={replacing} open={replacing !== null} onOpenChange={(o) => !o && setReplacing(null)} />
    </div>
  );
}

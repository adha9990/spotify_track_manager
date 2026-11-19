import type { Track } from "@stm/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";
import { followingTracks, usePlayTrack } from "../hooks/usePlayback";
import { formatDate, formatDuration } from "../lib/format";
import { useUi, type SortKey } from "../store/ui";
import { Badge, cx, Icon } from "./primitives";
import { TrackRemovalDialog, type TrackRemovalTarget } from "./TrackRemovalDialog";

// The header and virtualized rows share one grid template.
const GRID =
  "32px minmax(200px,2.4fr) minmax(130px,1.6fr) minmax(120px,1.4fr) 84px 112px 60px 36px";
const ROW_HEIGHT = 44;

const COLUMNS: { key: SortKey | null; label: string; align?: "right" }[] = [
  { key: null, label: "" },
  { key: "name", label: "歌曲" },
  { key: "artist", label: "歌手" },
  { key: null, label: "專輯" },
  { key: "popularity", label: "人氣", align: "right" },
  { key: "added", label: "加入日期", align: "right" },
  { key: null, label: "時長", align: "right" },
  { key: null, label: "" },
];

function HeaderCell({ col }: { col: (typeof COLUMNS)[number] }) {
  const { sortKey, sortDir, toggleSort } = useUi();
  const active = col.key && sortKey === col.key;
  if (!col.label) return <div />;
  return (
    <button
      disabled={!col.key}
      onClick={() => col.key && toggleSort(col.key)}
      className={cx(
        "flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider",
        col.align === "right" ? "justify-end" : "justify-start",
        col.key ? "text-stone-500 hover:text-ink" : "text-stone-400 cursor-default",
        active && "text-accent",
      )}
    >
      {col.label}
      {active && <span className="text-[9px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

function Row({ track, canPlay, onPlay, onRemove }: {
  track: Track;
  canPlay: boolean;
  onPlay: () => void;
  onRemove: (target: TrackRemovalTarget) => void;
}) {
  return (
    <div
      className={cx(
        "grid items-center gap-3 border-b border-stone-200/70 px-4 text-sm hover:bg-stone-100/80",
        !track.isPlayable && "opacity-60",
      )}
      style={{ gridTemplateColumns: GRID, height: ROW_HEIGHT }}
    >
      <button
        type="button"
        disabled={!track.isPlayable || !canPlay}
        onClick={onPlay}
        aria-label={`播放 ${track.name || "未命名曲目"}`}
        title="播放"
        className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 enabled:hover:bg-accent enabled:hover:text-white disabled:opacity-40"
      >
        <Icon name="play" className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{track.name}</span>
          {!track.isPlayable && <Badge tone="warn">失效</Badge>}
        </div>
      </div>
      <div className="truncate text-stone-600">{track.artists.join(", ")}</div>
      <div className="truncate text-stone-500">{track.album}</div>
      <div className="nums text-right text-stone-500">{track.popularity}</div>
      <div className="nums text-right text-stone-500">{formatDate(track.addedAt)}</div>
      <div className="nums text-right text-stone-500">{formatDuration(track.durationMs)}</div>
      <button
        type="button"
        onClick={(event) => onRemove({ track, trigger: event.currentTarget })}
        aria-label={[`從收藏刪除 ${track.name || "未命名曲目"}`, track.album].filter(Boolean).join("，")}
        aria-haspopup="dialog"
        title="從收藏刪除"
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-red-50 hover:text-red-700"
      >
        <Icon name="trash" className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TrackTable({ tracks }: { tracks: Track[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [removal, setRemoval] = useState<TrackRemovalTarget | null>(null);
  const play = usePlayTrack();

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-stone-200 bg-white/60 shadow-sm">
      {/* Sticky header */}
      <div
        className="grid items-center gap-3 border-b border-stone-300 px-4 py-2.5"
        style={{ gridTemplateColumns: GRID }}
      >
        {COLUMNS.map((col, i) => (
          <HeaderCell key={i} col={col} />
        ))}
      </div>

      {/* Virtualized body */}
      <div ref={parentRef} tabIndex={-1} className="min-h-0 flex-1 overflow-auto">
        {tracks.length === 0 ? (
          <p className="p-10 text-center text-stone-400">沒有符合的歌曲</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => (
              <div
                key={tracks[vi.index]!.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <Row
                  track={tracks[vi.index]!}
                  canPlay={play.canPlay && !play.isPending}
                  onPlay={() => play.mutate(tracks[vi.index]!.id, followingTracks(tracks, vi.index))}
                  onRemove={setRemoval}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      {removal && (
        <TrackRemovalDialog target={removal} fallbackFocus={parentRef} onClose={() => setRemoval(null)} />
      )}
    </div>
  );
}

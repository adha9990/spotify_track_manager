import type { Track } from "@stm/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { useDeleteTracks, usePlayTrack } from "../hooks/useLibrary";
import { formatDate, formatDuration } from "../lib/format";
import { useUi, type SortKey } from "../store/ui";
import { Badge, Button, cx, Icon } from "./primitives";

// Virtualized library table. Only ~30 rows are mounted at a time, so toggling
// selection (which re-renders the table) stays cheap even at 1700+ rows. The grid
// template is shared between header and rows so columns line up exactly.
const GRID =
  "36px 32px minmax(200px,2.4fr) minmax(130px,1.6fr) minmax(120px,1.4fr) 84px 112px 60px 36px";
const ROW_HEIGHT = 44;

const COLUMNS: { key: SortKey | null; label: string; align?: "right" }[] = [
  { key: null, label: "" },
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

function Row({ track }: { track: Track }) {
  const selected = useUi((s) => s.selected.has(track.id));
  const toggleSelect = useUi((s) => s.toggleSelect);
  const play = usePlayTrack();
  const del = useDeleteTracks();

  return (
    <div
      className={cx(
        "grid items-center gap-3 border-b border-stone-200/70 px-4 text-sm",
        selected ? "bg-accent/8" : "hover:bg-stone-100/80",
        !track.isPlayable && "opacity-60",
      )}
      style={{ gridTemplateColumns: GRID, height: ROW_HEIGHT }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => toggleSelect(track.id)}
        className="h-4 w-4 accent-[var(--color-accent)]"
        aria-label="選取"
      />
      <button
        onClick={() => play.mutate(track.id)}
        title="播放"
        className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 hover:bg-accent hover:text-white"
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
        onClick={() => del.mutate([track.id])}
        disabled={del.isPending}
        title="刪除"
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-red-50 hover:text-red-700"
      >
        <Icon name="trash" className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TrackTable({ tracks }: { tracks: Track[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const selectMany = useUi((s) => s.selectMany);
  const selectedCount = useUi((s) => s.selected.size);

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const allVisibleSelected = tracks.length > 0 && selectedCount >= tracks.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-stone-200 bg-white/60 shadow-sm">
      {/* Sticky header */}
      <div
        className="grid items-center gap-3 border-b border-stone-300 px-4 py-2.5"
        style={{ gridTemplateColumns: GRID }}
      >
        <input
          type="checkbox"
          checked={allVisibleSelected}
          onChange={(e) => selectMany(tracks.map((t) => t.id), e.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
          aria-label="全選"
        />
        {COLUMNS.slice(1).map((col, i) => (
          <HeaderCell key={i} col={col} />
        ))}
      </div>

      {/* Virtualized body */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
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
                <Row track={tracks[vi.index]!} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import type { Track } from "@stm/shared";
import { useMemo } from "react";
import { useRefreshLibrary } from "../hooks/useLibrary";
import { useUi } from "../store/ui";
import { Button, Icon } from "./primitives";
import { SimilarSongsSearch } from "./SimilarSongsSearch";

export function Toolbar({ visibleCount, tracks }: { visibleCount: number; tracks: Track[] }) {
  const search = useUi((s) => s.search);
  const setSearch = useUi((s) => s.setSearch);
  const refresh = useRefreshLibrary();
  const entries = useMemo(() => tracks.map((track) => ({ track })), [tracks]);

  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="relative min-w-48 flex-1 max-w-md">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋歌曲、歌手、專輯…"
          className="h-9 w-full rounded-md border border-stone-300 bg-white/70 pl-9 pr-3 text-sm outline-none placeholder:text-stone-400 focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <span className="nums text-sm text-stone-400">{visibleCount} 首</span>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          <Icon name="refresh" className={refresh.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {refresh.isPending ? "重新整理中…" : "重新整理"}
        </Button>
        <SimilarSongsSearch entries={entries} source="全部收藏" removable />
      </div>
    </div>
  );
}

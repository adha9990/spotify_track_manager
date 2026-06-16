import type { CleanupItem } from "@stm/shared";
import { useState } from "react";
import { useDeleteTracks } from "../hooks/useLibrary";
import { Badge, Button, Icon } from "./primitives";
import { Dialog } from "./Dialog";

// The one-click cleanup tab: every confident-duplicate / stale copy the backend
// flagged, each with its reason. The big action removes them all behind a confirm.
export function CleanupView({ items }: { items: CleanupItem[] }) {
  const [confirming, setConfirming] = useState(false);
  const del = useDeleteTracks();

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-stone-400">
        <Icon name="check" className="h-10 w-10 text-emerald-500" />
        <p className="text-lg">收藏很乾淨,沒有發現重複或可安全移除的歌曲。</p>
      </div>
    );
  }

  const runCleanup = () =>
    del.mutate(
      items.map((i) => i.id),
      { onSuccess: () => setConfirming(false) },
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
        <p className="text-sm text-amber-900">
          找到 <span className="font-semibold nums">{items.length}</span> 首可安全移除的歌曲
          ——每首都已保留一個同名同歌手(或同 ISRC)的版本。
        </p>
        <Button variant="primary" onClick={() => setConfirming(true)}>
          <Icon name="trash" className="h-4 w-4" />
          一鍵清理 ({items.length})
        </Button>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-stone-200 bg-white/60">
        {items.map((item) => (
          <div
            key={item.id}
            className="grid items-center gap-3 border-b border-stone-200/70 px-4 py-2.5 text-sm"
            style={{ gridTemplateColumns: "minmax(180px,1.6fr) minmax(120px,1fr) auto" }}
          >
            <span className="truncate font-medium">{item.name}</span>
            <span className="truncate text-stone-500">{item.artist}</span>
            <Badge tone={item.reason.includes("失效") ? "warn" : "neutral"}>{item.reason}</Badge>
          </div>
        ))}
      </div>

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="確認清理"
        description={`即將從收藏移除 ${items.length} 首歌曲。每首都已保留同組的另一個版本,此動作可在「歷史」中復原。`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            取消
          </Button>
          <Button variant="primary" disabled={del.isPending} onClick={runCleanup}>
            {del.isPending ? "清理中…" : `確認移除 ${items.length} 首`}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

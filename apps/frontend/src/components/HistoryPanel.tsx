import type { HistoryBatch } from "@stm/shared";
import { useId } from "react";
import { useHistory, useUndo } from "../hooks/useLibrary";
import { formatDateTime } from "../lib/format";
import { Badge, Button } from "./primitives";
import { Dialog } from "./Dialog";

// The op-log: every delete / add the user made, each reversible until undone. Opened
// from the masthead. Queries lazily (only while the dialog is open).
export function HistoryPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const history = useHistory(open);
  const undo = useUndo();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="max-w-lg"
      title="操作歷史"
      description="查看移除或加入收藏的歌曲，也可以復原操作。"
    >
      <div className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain rounded-md border border-stone-200">
        {history.isPending && <p className="p-4 text-sm text-stone-400">載入中…</p>}
        {history.isError && (
          <div className="flex items-center justify-between gap-3 p-4">
            <p role="alert" className="text-sm text-red-700">無法載入操作歷史。</p>
            <Button size="sm" variant="outline" onClick={() => void history.refetch()}>重試</Button>
          </div>
        )}
        {history.data?.length === 0 && (
          <p className="p-6 text-center text-sm text-stone-400">還沒有任何操作紀錄。</p>
        )}
        {history.data && history.data.length > 0 && (
          <ol className="divide-y divide-stone-100">
            {history.data.map((b) => (
              <Row key={b.batchId} batch={b} onUndo={() => undo.mutate(b.batchId)} undoing={undo.isPending} />
            ))}
          </ol>
        )}
      </div>
    </Dialog>
  );
}

function Row({ batch, onUndo, undoing }: { batch: HistoryBatch; onUndo: () => void; undoing: boolean }) {
  const isDelete = batch.action === "delete";
  const trackListId = useId();
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Badge tone={isDelete ? "warn" : "accent"}>{isDelete ? "移除" : "加入"}</Badge>
      <div className="min-w-0 flex-1">
        <ul id={trackListId} className="space-y-1.5">
          {batch.tracks.map(({ id, name, artists, album }, index) => {
            const edition = [artists.join(", "), album].filter(Boolean).join(" · ");
            return (
              <li key={`${id}-${index}`} className="break-words">
                <a
                  href={`https://open.spotify.com/track/${encodeURIComponent(id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-accent hover:underline"
                >
                  {name || "曲目名稱暫無資料"}
                </a>
                {edition && <p className="text-xs text-stone-600">{edition}</p>}
              </li>
            );
          })}
        </ul>
        <time dateTime={batch.ts} className="nums mt-1 block text-xs text-stone-500">{formatDateTime(batch.ts)}</time>
      </div>
      {batch.undone ? (
        <span className="text-xs text-stone-400">已復原</span>
      ) : (
        <Button size="sm" variant="outline" aria-describedby={trackListId} disabled={undoing} onClick={onUndo}>
          復原
        </Button>
      )}
    </li>
  );
}

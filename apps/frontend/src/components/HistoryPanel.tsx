import type { HistoryBatch } from "@stm/shared";
import { useHistory, useUndo } from "../hooks/useLibrary";
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
      description="這裡記錄你的每一次刪除與新增,未復原的都可以還原。"
    >
      <div className="max-h-96 overflow-auto rounded-md border border-stone-200">
        {history.isPending && <p className="p-4 text-sm text-stone-400">載入中…</p>}
        {history.data?.length === 0 && (
          <p className="p-6 text-center text-sm text-stone-400">還沒有任何操作紀錄。</p>
        )}
        {history.data?.map((b) => (
          <Row key={b.batchId} batch={b} onUndo={() => undo.mutate(b.batchId)} undoing={undo.isPending} />
        ))}
      </div>
    </Dialog>
  );
}

function Row({ batch, onUndo, undoing }: { batch: HistoryBatch; onUndo: () => void; undoing: boolean }) {
  const isDelete = batch.action === "delete";
  return (
    <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-2.5 last:border-0">
      <Badge tone={isDelete ? "warn" : "accent"}>{isDelete ? "刪除" : "新增"}</Badge>
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          {isDelete ? "移除" : "加入"} <span className="font-semibold nums">{batch.count}</span> 首
        </div>
        <div className="nums text-xs text-stone-400">{batch.ts.slice(0, 16).replace("T", " ")}</div>
      </div>
      {batch.undone ? (
        <span className="text-xs text-stone-400">已復原</span>
      ) : (
        <Button size="sm" variant="outline" disabled={undoing} onClick={onUndo}>
          復原
        </Button>
      )}
    </div>
  );
}

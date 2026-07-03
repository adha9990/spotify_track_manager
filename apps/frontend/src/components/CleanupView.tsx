import type { CleanupGroup, Track } from "@stm/shared";
import type { ReactNode } from "react";
import { useState } from "react";
import { useDeleteTracks, usePlayTrack } from "../hooks/useLibrary";
import { formatDate, formatDuration } from "../lib/format";
import { useUi } from "../store/ui";
import { Badge, Button, cx, Icon } from "./primitives";
import { Dialog } from "./Dialog";

// 清理分頁:每組一張卡片,並列「保留」與「移除」雙方的完整資訊(專輯/人氣/加入
// 日期/時長/失效),每列可試聽 — 使用者能親自確認真的重複後才清理。組層級勾選
// (預設全勾)存 ui store 的排除集合(key = keep.id);重新整理收藏後,已不存在
// 的組在讀取時自然被忽略,不需主動清理狀態。

const ROW_GRID = "32px 88px minmax(160px,1.6fr) minmax(120px,1.2fr) 56px 96px 56px";

const shortReason = (reason: string) => (reason.includes("失效") ? "失效" : "重複");

function TrackRow({
  track,
  tag,
  onPlay,
}: {
  track: Track;
  tag: ReactNode;
  onPlay: (id: string) => void;
}) {
  return (
    <div
      className="grid items-center gap-3 px-3 py-2 text-sm"
      style={{ gridTemplateColumns: ROW_GRID }}
    >
      <button
        onClick={() => onPlay(track.id)}
        title="試聽"
        className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 hover:bg-accent hover:text-white"
      >
        <Icon name="play" className="h-3.5 w-3.5" />
      </button>
      <div>{tag}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{track.name}</span>
          {!track.isPlayable && <Badge tone="warn">失效</Badge>}
        </div>
        <div className="truncate text-xs text-stone-500">{track.artists.join(", ")}</div>
      </div>
      <div className="truncate text-stone-500">{track.album}</div>
      <div className="nums text-right text-stone-500">{track.popularity}</div>
      <div className="nums text-right text-stone-500">{formatDate(track.addedAt)}</div>
      <div className="nums text-right text-stone-500">{formatDuration(track.durationMs)}</div>
    </div>
  );
}

export function CleanupView({ groups }: { groups: CleanupGroup[] }) {
  const [confirming, setConfirming] = useState(false);
  const del = useDeleteTracks();
  const play = usePlayTrack();
  const excluded = useUi((s) => s.cleanupExcluded);
  const toggleGroup = useUi((s) => s.toggleCleanupGroup);

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-stone-400">
        <Icon name="check" className="h-10 w-10 text-emerald-500" />
        <p className="text-lg">收藏很乾淨,沒有發現重複或可安全移除的歌曲。</p>
      </div>
    );
  }

  const included = groups.filter((g) => !excluded.has(g.keep.id));
  const removalIds = included.flatMap((g) => g.removals.map((r) => r.track.id));

  const runCleanup = () =>
    del.mutate(removalIds, { onSuccess: () => setConfirming(false) });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
        <p className="text-sm text-amber-900">
          找到 <span className="font-semibold nums">{groups.length}</span> 組重複,已勾選{" "}
          <span className="font-semibold nums">{removalIds.length}</span>{" "}
          首可移除。請逐組核對雙方資訊(可按 ▶ 試聽),發現誤判請取消勾選該組。
        </p>
        <Button
          variant="primary"
          disabled={removalIds.length === 0}
          onClick={() => setConfirming(true)}
        >
          <Icon name="trash" className="h-4 w-4" />
          一鍵清理 ({removalIds.length})
        </Button>
      </div>

      {play.isError && (
        <p className="mt-2 text-xs text-red-700">無法播放:請先開啟 Spotify 播放器(需 Premium)。</p>
      )}

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {groups.map((g) => {
          const checked = !excluded.has(g.keep.id);
          return (
            <div
              key={g.keep.id}
              className={cx(
                "rounded-lg border border-stone-200 bg-white/60",
                !checked && "opacity-50",
              )}
            >
              <label className="flex cursor-pointer items-center gap-3 border-b border-stone-200/70 px-3 py-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleGroup(g.keep.id)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  aria-label="納入清理"
                />
                <span className="truncate text-sm font-semibold">
                  {g.keep.name} — {g.keep.artists.join(", ")}
                </span>
                <Badge tone="neutral">{g.removals.length + 1} 個版本</Badge>
              </label>
              <TrackRow track={g.keep} tag={<Badge tone="ok">保留</Badge>} onPlay={(id) => play.mutate(id)} />
              {g.removals.map((r) => (
                <div key={r.track.id} title={r.reason} className="border-t border-stone-100">
                  <TrackRow
                    track={r.track}
                    tag={<Badge tone="warn">移除·{shortReason(r.reason)}</Badge>}
                    onPlay={(id) => play.mutate(id)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="確認清理"
        description={`即將從收藏移除 ${included.length} 組共 ${removalIds.length} 首歌曲。每首都已保留同組的另一個版本,此動作可在「歷史」中復原。`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            取消
          </Button>
          <Button variant="primary" disabled={del.isPending} onClick={runCleanup}>
            {del.isPending ? "清理中…" : `確認移除 ${removalIds.length} 首`}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

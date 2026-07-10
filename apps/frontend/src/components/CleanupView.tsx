import type { CleanupGroup, SuspectPair, Track } from "@stm/shared";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useDeleteTracks, useDismissSuspect, usePlayTrack } from "../hooks/useLibrary";
import { formatDate, formatDuration } from "../lib/format";
import { useUi } from "../store/ui";
import { Badge, Button, cx, Icon } from "./primitives";
import { Dialog } from "./Dialog";

// 清理分頁分兩區:
// - 一鍵清理(確定同曲):每組並列「保留」與「移除」雙方的完整資訊(專輯/人氣/
//   加入日期/時長/失效),每列可試聽 — 使用者能親自確認真的重複後才清理。組層級
//   勾選(預設全勾)存 ui store 的排除集合(key = keep.id);重新整理收藏後,已不
//   存在的組在讀取時自然被忽略,不需主動清理狀態。
// - 疑似重複(需逐組確認):信心不足以自動歸類的配對,逐張卡片單獨確認移除或標記
//   「不是重複」,與一鍵清理的批次動作互不影響。

const ROW_GRID = "32px 88px minmax(160px,1.6fr) minmax(120px,1.2fr) 56px 96px 56px";

const shortReason = (reason: string) => (reason.includes("失效") ? "失效" : "重複");

/** Sanitize an arbitrary pairKey (e.g. "t20|t25") into a valid DOM id fragment. */
const domId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "-");

function TrackRow({
  track,
  tag,
  onPlay,
  action,
}: {
  track: Track;
  tag: ReactNode;
  onPlay: (id: string) => void;
  /** Optional trailing control rendered outside the fixed grid (e.g. a per-row remove button). */
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div
        className="grid flex-1 items-center gap-3 text-sm"
        style={{ gridTemplateColumns: ROW_GRID }}
      >
        <button
          onClick={() => onPlay(track.id)}
          title="試聽"
          className="flex h-7 w-7 scroll-mt-24 items-center justify-center rounded-full text-stone-500 hover:bg-accent hover:text-white"
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
      {action}
    </div>
  );
}

function SuspectCard({
  pair,
  onPlay,
  onResolved,
  onFocusSuspectsHeading,
}: {
  pair: SuspectPair;
  onPlay: (id: string) => void;
  /** Called after a dismiss or a confirmed removal succeeds, with the message to announce. */
  onResolved: (message: string) => void;
  /**
   * Moves focus to the suspects section heading. For the confirmed-removal path this must
   * run from the Dialog's onCloseAutoFocus, not from the mutation's onSuccess — see
   * closedByRemovalRef below for why.
   */
  onFocusSuspectsHeading: () => void;
}) {
  const [chosen, setChosen] = useState<Track | null>(null);
  const del = useDeleteTracks();
  const dismiss = useDismissSuspect();
  const headingId = `suspect-${domId(pair.pairKey)}-heading`;
  const other: Track | null = chosen ? (chosen.id === pair.keep.id ? pair.remove : pair.keep) : null;
  // Distinguishes why the confirm dialog is closing: a successful removal unmounts this
  // whole card (its trigger button included), so Radix's default onCloseAutoFocus — which
  // returns focus to that trigger — would find nothing and drop focus to <body>. Only
  // suppress it for that case; a user cancel/Escape keeps Radix's normal trigger-refocus.
  //
  // The replacement focus call must also live *inside* onCloseAutoFocus rather than in the
  // mutation's onSuccess: at onSuccess time the Dialog is still open and Radix's focus-scope
  // trap still has its synchronous document focusin listener attached, so a focus() call made
  // there gets yanked straight back into the (about to unmount) dialog content. onCloseAutoFocus
  // fires after the trap's listener has already been torn down, so the focus move sticks.
  const closedByRemovalRef = useRef(false);

  const removeAction = (track: Track) => (
    <Button
      size="sm"
      variant="danger"
      disabled={del.isPending}
      aria-label={`移除這首：${track.name} — ${track.artists.join(", ")}`}
      onClick={() => setChosen(track)}
    >
      移除這首
    </Button>
  );

  return (
    <div role="group" aria-labelledby={headingId} className="rounded-lg border border-stone-200 bg-white/60">
      <div className="border-b border-stone-200/70 px-3 py-2">
        <h3 id={headingId} className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span className="truncate">{pair.keep.name}</span>
          <Icon name="swap" className="h-3.5 w-3.5 shrink-0 text-stone-400" />
          <span className="truncate">{pair.remove.name}</span>
        </h3>
        {pair.hints.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {pair.hints.map((hint) => (
              <Badge key={hint} tone="neutral">
                {hint}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <TrackRow
        track={pair.keep}
        tag={null}
        onPlay={onPlay}
        action={removeAction(pair.keep)}
      />
      <div className="border-t border-stone-100">
        <TrackRow
          track={pair.remove}
          tag={null}
          onPlay={onPlay}
          action={removeAction(pair.remove)}
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-stone-100 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={dismiss.isPending}
          aria-label={`不是重複：${pair.keep.name} — ${pair.keep.artists[0]}／${pair.remove.name} — ${pair.remove.artists[0]}`}
          onClick={() =>
            dismiss.mutate(pair.pairKey, {
              onSuccess: () => {
                onResolved(`已標記「${pair.remove.name}」為不是重複`);
                onFocusSuspectsHeading();
              },
            })
          }
        >
          不是重複
        </Button>
      </div>

      <Dialog
        open={chosen !== null}
        onOpenChange={(open) => {
          if (!open) setChosen(null);
        }}
        title="確認移除"
        description={
          chosen && other
            ? `即將移除「${chosen.name} — ${chosen.artists.join(", ")}」,保留「${other.name} — ${other.artists.join(", ")}」。此動作可在「歷史」中復原。`
            : ""
        }
        onCloseAutoFocus={(e) => {
          if (closedByRemovalRef.current) {
            e.preventDefault();
            onFocusSuspectsHeading();
          }
          closedByRemovalRef.current = false;
        }}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setChosen(null)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={del.isPending || chosen === null}
            onClick={() => {
              if (!chosen) return;
              const removedName = chosen.name;
              del.mutate([chosen.id], {
                onSuccess: () => {
                  closedByRemovalRef.current = true;
                  setChosen(null);
                  onResolved(`已移除「${removedName}」,可在歷史中復原`);
                },
              });
            }}
          >
            {del.isPending ? "移除中…" : "確認移除"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

const GROUPS_HEADING_ID = "cleanup-groups-heading";
const SUSPECTS_HEADING_ID = "cleanup-suspects-heading";

export function CleanupView({ groups, suspects }: { groups: CleanupGroup[]; suspects: SuspectPair[] }) {
  const [confirming, setConfirming] = useState(false);
  const del = useDeleteTracks();
  const play = usePlayTrack();
  const excluded = useUi((s) => s.cleanupExcluded);
  const toggleGroup = useUi((s) => s.toggleCleanupGroup);
  const [liveMessage, setLiveMessage] = useState("");
  const suspectsHeadingRef = useRef<HTMLHeadingElement>(null);

  // Both resolution paths (dismiss, and confirmed removal via the Dialog) route through
  // here so the live region announces the outcome. Focus is a separate callback (see
  // focusSuspectsHeading) because the confirmed-removal path can only apply it once the
  // Dialog has actually finished unmounting — see the comment on SuspectCard's
  // closedByRemovalRef for why.
  const onSuspectResolved = (message: string) => {
    setLiveMessage(message);
  };
  const focusSuspectsHeading = () => {
    suspectsHeadingRef.current?.focus();
  };

  if (groups.length === 0 && suspects.length === 0) {
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

  const onPlay = (id: string) => play.mutate(id);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto pr-1">
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {play.isError && (
        <p className="text-xs text-red-700">無法播放:請先開啟 Spotify 播放器(需 Premium)。</p>
      )}

      <section aria-labelledby={GROUPS_HEADING_ID} className="flex flex-col gap-3">
        <h2
          id={GROUPS_HEADING_ID}
          className="text-xs font-semibold uppercase tracking-wide text-stone-400"
        >
          可一鍵清理(確定同曲) {groups.length} 組
        </h2>

        {groups.length === 0 ? (
          <p className="rounded-lg border border-stone-200 bg-white/60 px-4 py-3 text-sm text-stone-500">
            沒有可一鍵清理的重複。
          </p>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
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

            <div className="space-y-3">
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
                        className="h-4 w-4 scroll-mt-24 accent-[var(--color-accent)]"
                      />
                      <span className="truncate text-sm font-semibold">
                        {g.keep.name} — {g.keep.artists.join(", ")}
                      </span>
                      <Badge tone="neutral">{g.removals.length + 1} 個版本</Badge>
                    </label>
                    <TrackRow track={g.keep} tag={<Badge tone="ok">保留</Badge>} onPlay={onPlay} />
                    {g.removals.map((r) => (
                      <div key={r.track.id} title={r.reason} className="border-t border-stone-100">
                        <TrackRow
                          track={r.track}
                          tag={<Badge tone="warn">移除·{shortReason(r.reason)}</Badge>}
                          onPlay={onPlay}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section aria-labelledby={SUSPECTS_HEADING_ID} className="flex flex-col gap-3">
        <h2
          id={SUSPECTS_HEADING_ID}
          ref={suspectsHeadingRef}
          tabIndex={-1}
          className="text-xs font-semibold uppercase tracking-wide text-stone-400"
        >
          疑似重複(需逐組確認) {suspects.length} 組
        </h2>

        {suspects.length === 0 ? (
          <p className="rounded-lg border border-stone-200 bg-white/60 px-4 py-3 text-sm text-stone-500">
            沒有需要確認的疑似重複。
          </p>
        ) : (
          <div className="space-y-3">
            {suspects.map((pair) => (
              <SuspectCard
                key={pair.pairKey}
                pair={pair}
                onPlay={onPlay}
                onResolved={onSuspectResolved}
                onFocusSuspectsHeading={focusSuspectsHeading}
              />
            ))}
          </div>
        )}
      </section>

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

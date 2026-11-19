import type { Track } from "@stm/shared";
import { useRef, type RefObject } from "react";
import { useDeleteTrack } from "../hooks/useLibrary";
import { formatDuration } from "../lib/format";
import { Dialog } from "./Dialog";
import { Button } from "./primitives";

export interface TrackRemovalTarget {
  track: Track;
  trigger: HTMLButtonElement;
}

export function TrackRemovalDialog({ target, fallbackFocus, onClose, onRemoved }: {
  target: TrackRemovalTarget;
  fallbackFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const { track, trigger } = target;
  const remove = useDeleteTrack();
  const cancel = useRef<HTMLButtonElement>(null);
  const name = track.name || "未命名曲目";
  const edition = [track.artists.join(", "), track.album, track.durationMs > 0 && formatDuration(track.durationMs)]
    .filter(Boolean).join(" · ");

  function confirm() {
    if (remove.isPending) return;
    remove.mutate(track.id, {
      onSuccess: () => {
        onRemoved?.();
        onClose();
      },
    });
  }

  return (
    <Dialog
      open
      showClose={false}
      onOpenChange={(open) => { if (!open && !remove.isPending) onClose(); }}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        cancel.current?.focus();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        const element = trigger.isConnected ? trigger : fallbackFocus.current;
        element?.focus({ preventScroll: true });
      }}
      title="從收藏刪除歌曲？"
      description={(
        <>
          <span className="mt-3 block break-words text-base font-semibold text-ink">{name}</span>
          {edition && <span className="mt-1 block break-words text-stone-600">{edition}</span>}
          <span className="mt-3 block">可從「歷史」復原。</span>
        </>
      )}
    >
      {remove.isError && <p role="alert" className="mb-3 text-sm text-red-700">無法從收藏移除「{name}」。請重試。</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancel} type="button" disabled={remove.isPending} onClick={onClose}>取消</Button>
        <Button type="button" variant="danger" className="bg-red-50" disabled={remove.isPending} onClick={confirm}>
          {remove.isPending ? "刪除中…" : "確認刪除"}
        </Button>
      </div>
    </Dialog>
  );
}

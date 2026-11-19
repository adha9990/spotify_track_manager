import type { Track } from "@stm/shared";
import { lazy, Suspense, useRef, useState } from "react";
import type { SavedAlternative } from "../lib/unplayable-tracks";
import { Button, Icon } from "./primitives";
import { TrackRemovalDialog, type TrackRemovalTarget } from "./TrackRemovalDialog";

const ReplaceDialog = lazy(async () => ({ default: (await import("./ReplaceDialog")).ReplaceDialog }));

const alternativeLabels: Record<SavedAlternative["match"], string> = {
  isrc: "相同 ISRC",
  artist: "同藝人的版本",
  title: "同名候選",
};

export function UnplayableView({ unresolved, savedAlternatives }: {
  unresolved: Track[];
  savedAlternatives: SavedAlternative[];
}) {
  const [replacing, setReplacing] = useState<Track | null>(null);
  const [removal, setRemoval] = useState<TrackRemovalTarget | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowActions = { onRemove: setRemoval, onReplace: setReplacing };

  return (
    <div ref={listRef} tabIndex={-1} className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      {unresolved.length > 0 ? (
        <>
          <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
            這些失效歌曲在收藏中找不到可播放的候選版本。
          </p>
          <ul aria-label="待處理的失效歌曲" className="divide-y divide-stone-200/70 overflow-x-auto rounded-lg border border-stone-200 bg-white/60">
            {unresolved.map((track) => <UnplayableRow key={track.id} track={track} {...rowActions} />)}
          </ul>
        </>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white/60 px-4 py-3 text-sm text-stone-600">
          <Icon name="check" className="h-5 w-5 text-emerald-500" />
          沒有待處理的失效歌曲。
        </div>
      )}

      {savedAlternatives.length > 0 && (
        <details className="rounded-lg border border-stone-200 bg-white/60">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-stone-700">
            收藏中已有可播放候選 · {savedAlternatives.length} 首
          </summary>
          <ul aria-label="已有收藏候選的失效歌曲" className="divide-y divide-stone-200/70 overflow-x-auto border-t border-stone-200">
            {savedAlternatives.map((alternative) => (
              <UnplayableRow key={alternative.track.id} track={alternative.track} alternative={alternative} {...rowActions} />
            ))}
          </ul>
        </details>
      )}

      {replacing && (
        <Suspense fallback={<p role="status" className="text-sm text-stone-600">正在準備替代搜尋…</p>}>
          <ReplaceDialog key={replacing.id} track={replacing} onClose={() => setReplacing(null)} />
        </Suspense>
      )}
      {removal && (
        <TrackRemovalDialog target={removal} fallbackFocus={listRef} onClose={() => setRemoval(null)} />
      )}
    </div>
  );
}

function UnplayableRow({ track, alternative, onRemove, onReplace }: {
  track: Track;
  alternative?: SavedAlternative;
  onRemove: (target: TrackRemovalTarget) => void;
  onReplace: (track: Track) => void;
}) {
  return (
    <li className="grid items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm [grid-template-columns:minmax(0,1fr)_auto] sm:[grid-template-columns:minmax(0,1.8fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]">
      <span className="truncate font-medium">{track.name}</span>
      <span className="col-start-1 truncate text-stone-500 sm:col-start-auto">{track.artists.join(", ")}</span>
      <span className="col-start-1 truncate text-stone-400 sm:col-start-auto">{track.album}</span>
      <div className="col-start-2 row-start-1 row-span-3 flex justify-end gap-2 sm:col-start-4 sm:row-span-1">
        <Button size="sm" variant="primary" onClick={() => onReplace(track)}>
          <Icon name="swap" className="h-3.5 w-3.5" />
          尋找替代
        </Button>
        <Button
          type="button"
          size="sm"
          variant="danger"
          aria-label={[`從收藏移除 ${track.name || "未命名曲目"}`, track.album].filter(Boolean).join("，")}
          aria-haspopup="dialog"
          onClick={(event) => onRemove({ track, trigger: event.currentTarget })}
        >
          移除
        </Button>
      </div>
      {alternative && (
        <div className="col-span-full border-l-2 border-stone-200 pl-3 text-xs text-stone-600">
          <p className="font-medium">{alternativeLabels[alternative.match]}</p>
          <ul className="space-y-1 break-words">
            {alternative.versions.map((version) => {
              const edition = [version.artists.join(", "), version.album].filter(Boolean).join(" · ");
              return (
                <li key={version.id}>
                  <a href={`https://open.spotify.com/track/${encodeURIComponent(version.id)}`} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                    {version.name}
                  </a>
                  {edition && ` · ${edition}`}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

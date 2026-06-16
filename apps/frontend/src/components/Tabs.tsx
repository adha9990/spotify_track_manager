import { useUi, type Tab } from "../store/ui";
import { cx } from "./primitives";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "全部收藏" },
  { id: "cleanup", label: "清理建議" },
  { id: "unplayable", label: "失效歌曲" },
];

export function Tabs({ counts }: { counts: Record<Tab, number> }) {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);

  return (
    <div className="flex items-end gap-1 border-b border-stone-300">
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "relative -mb-px flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition",
              active ? "text-ink" : "text-stone-500 hover:text-ink",
            )}
          >
            {t.label}
            <span
              className={cx(
                "rounded-full px-1.5 py-0.5 text-[11px] font-semibold nums",
                active ? "bg-accent/15 text-accent" : "bg-stone-200/70 text-stone-500",
                t.id === "unplayable" && counts.unplayable > 0 && !active && "bg-amber-100 text-amber-700",
              )}
            >
              {counts[t.id]}
            </span>
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        );
      })}
    </div>
  );
}

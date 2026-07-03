import { create } from "zustand";

// Client-only UI state (which tab, the search box, current row selection, sort).
// Server data lives in TanStack Query; this store never holds tracks themselves —
// only ids and view preferences — so it stays small and the table reads from the
// query cache.

export type Tab = "all" | "cleanup" | "unplayable";
export type SortKey = "added" | "name" | "artist" | "popularity";
export type SortDir = "asc" | "desc";

interface UiState {
  tab: Tab;
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  selected: Set<string>;
  /** Cleanup groups the user unchecked (key = keep.id). Stale ids are ignored at read time. */
  cleanupExcluded: Set<string>;

  setTab: (tab: Tab) => void;
  setSearch: (search: string) => void;
  toggleSort: (key: SortKey) => void;
  toggleSelect: (id: string) => void;
  selectMany: (ids: string[], on: boolean) => void;
  clearSelection: () => void;
  toggleCleanupGroup: (keepId: string) => void;
}

export const useUi = create<UiState>((set) => ({
  tab: "all",
  search: "",
  sortKey: "added",
  sortDir: "desc",
  selected: new Set(),
  cleanupExcluded: new Set(),

  setTab: (tab) => set({ tab, search: "", selected: new Set() }),
  setSearch: (search) => set({ search }),
  toggleSort: (key) =>
    set((s) =>
      s.sortKey === key
        ? { sortDir: s.sortDir === "asc" ? "desc" : "asc" }
        : { sortKey: key, sortDir: key === "name" || key === "artist" ? "asc" : "desc" },
    ),
  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      next.has(id) ? next.delete(id) : next.add(id);
      return { selected: next };
    }),
  selectMany: (ids, on) =>
    set((s) => {
      const next = new Set(s.selected);
      for (const id of ids) (on ? next.add(id) : next.delete(id));
      return { selected: next };
    }),
  clearSelection: () => set({ selected: new Set() }),
  toggleCleanupGroup: (keepId) =>
    set((s) => {
      const next = new Set(s.cleanupExcluded);
      next.has(keepId) ? next.delete(keepId) : next.add(keepId);
      return { cleanupExcluded: next };
    }),
}));

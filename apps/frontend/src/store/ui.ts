import { create } from "zustand";

// Client-only view preferences. Server data lives in TanStack Query.

export type Tab = "songs" | "unplayable";
export type SortKey = "added" | "name" | "artist" | "popularity";
export type SortDir = "asc" | "desc";

interface UiState {
  tab: Tab;
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;

  setTab: (tab: Tab) => void;
  setSearch: (search: string) => void;
  toggleSort: (key: SortKey) => void;
}

export const useUi = create<UiState>((set) => ({
  tab: "songs",
  search: "",
  sortKey: "added",
  sortDir: "desc",

  setTab: (tab) => set({ tab, search: "" }),
  setSearch: (search) => set({ search }),
  toggleSort: (key) =>
    set((s) =>
      s.sortKey === key
        ? { sortDir: s.sortDir === "asc" ? "desc" : "asc" }
        : { sortKey: key, sortDir: key === "name" || key === "artist" ? "asc" : "desc" },
    ),
}));

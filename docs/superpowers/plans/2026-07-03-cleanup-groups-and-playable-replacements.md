# 清理群組並列檢視 + 可播放替代搜尋 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理分頁每組並列顯示「保留」與「移除」雙方完整資訊（可勾選排除、可試聽）；「尋找替代」只回傳可播放的曲目並可試聽。

**Architecture:** 共享 Zod 契約由平面 `CleanupItem` 改為群組 `CleanupGroup { keep, removals: [{ track, reason }] }`，後端 `buildCleanup` 停止丟棄 keep 方；`searchTracks` 超抓 20 筆過濾 `is_playable === false` 後回傳 10 筆並帶 `durationMs`。前端 `CleanupView` 重寫為群組卡片（組層級勾選存 Zustand 排除集合），`ReplaceDialog` 加試聽鍵與時長。

**Tech Stack:** Zod（`@stm/shared` 契約）、Fastify 後端（分層：domain 純邏輯 / adapters I/O）、Vitest（離線，注入假 fetcher）、React 19 + TanStack Query + Zustand、pnpm monorepo。

## Global Constraints

- spec：`docs/superpowers/specs/2026-07-03-cleanup-groups-and-playable-replacements-design.md`（已核可）。
- 測試全部離線，絕不觸網（CLAUDE.md 紀律）；I/O 一律走可注入 seam（比照 `collect` 的 `pager`）。
- 分層邊界由 `pnpm lint` 強制：domain 零 I/O；adapters 才能碰 `apiJson`。
- 理由字串逐字沿用（不得改字）：`"已失效,且已有可播放的同名同歌手版本"`、`"重複(已保留同組人氣最高者)"`。
- 播放失敗提示文案：`無法播放：請先開啟 Spotify 播放器（需 Premium）。`
- 搜尋空結果文案：`沒有結果（已濾除不可播放的版本）`。
- **Task 1、2 完成前後，root `pnpm typecheck` 會因前端尚未跟上契約而紅** — Task 1、2 只驗證 `@stm/shared`、`@stm/backend` 兩個套件；Task 3 起全 repo 恢復綠。
- Windows 環境；命令用 PowerShell 語法（無 `&&`，用 `;` 串接）。

---

### Task 1: 契約群組化 + `buildCleanup` 回傳群組（後端 TDD）

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/backend/src/domain/cleanup.ts`
- Test: `apps/backend/src/domain/cleanup.test.ts`

**Interfaces:**
- Consumes: `TrackSchema`／`Track`（既有）、`planDeletions`＋`findConfidentDuplicates`（既有，回傳 `{ keep: Track, remove: Track[] }`）。
- Produces: `CleanupRemovalSchema`／`CleanupRemoval = { track: Track, reason: string }`、`CleanupGroupSchema`／`CleanupGroup = { keep: Track, removals: CleanupRemoval[] }`、`LibrarySchema.cleanup: CleanupGroup[]`、`buildCleanup(tracks: Track[]): CleanupGroup[]`。**`CleanupItemSchema`／`CleanupItem` 自此刪除**，Task 3 之後全 repo 不得再引用。

- [ ] **Step 1: 改寫共享契約**

`packages/shared/src/index.ts` — 將現有的 `CleanupItemSchema` 區塊（`/** One row of ... */` 至 `export type CleanupItem = ...`）整段替換為：

```ts
/** One track slated for removal, with the reason it is safe to remove. */
export const CleanupRemovalSchema = z.object({
  track: TrackSchema,
  reason: z.string(),
});
export type CleanupRemoval = z.infer<typeof CleanupRemovalSchema>;

/**
 * One confident-duplicate group in the cleanup plan: the copy we keep, plus every
 * copy to remove. Full Track info on both sides so the UI can lay them out
 * side-by-side for human verification. `keep.id` doubles as the stable group key.
 */
export const CleanupGroupSchema = z.object({
  keep: TrackSchema,
  removals: z.array(CleanupRemovalSchema).min(1),
});
export type CleanupGroup = z.infer<typeof CleanupGroupSchema>;
```

同檔 `LibrarySchema` 改為：

```ts
export const LibrarySchema = z.object({
  tracks: z.array(TrackSchema),
  cleanup: z.array(CleanupGroupSchema),
});
```

- [ ] **Step 2: 改寫失敗測試**

`apps/backend/src/domain/cleanup.test.ts` 全檔替換為：

```ts
import { describe, expect, it } from "vitest";
import { makeTrack } from "./fixtures";
import { buildCleanup } from "./cleanup";

const song = (id: string, over: Partial<Parameters<typeof makeTrack>[0]> = {}) =>
  makeTrack({ id, name: "Song", artists: ["A"], ...over });

describe("buildCleanup", () => {
  it("returns nothing when there are no confident duplicates", () => {
    expect(
      buildCleanup([song("1", { name: "A" }), song("2", { name: "B" })]),
    ).toEqual([]);
  });

  it("returns one group per duplicate set, pairing keep with its removals", () => {
    const groups = buildCleanup([
      song("keep", { popularity: 90 }),
      song("drop1", { popularity: 10 }),
      song("drop2", { popularity: 20 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.id).toBe("keep");
    expect(groups[0]!.removals.map((r) => r.track.id).sort()).toEqual(["drop1", "drop2"]);
  });

  it("carries the keep side's full track info (the UI renders both sides)", () => {
    const groups = buildCleanup([
      song("keep", { popularity: 90, album: "首版" }),
      song("drop", { popularity: 10, album: "重發版" }),
    ]);
    expect(groups[0]!.keep.album).toBe("首版");
    expect(groups[0]!.removals[0]!.track.album).toBe("重發版");
  });

  it("flags a dead copy that has a playable twin with the stale reason", () => {
    const groups = buildCleanup([
      song("alive", { isPlayable: true, popularity: 10 }),
      song("dead", { isPlayable: false, popularity: 99 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.id).toBe("alive");
    expect(groups[0]!.removals[0]!.track.id).toBe("dead");
    expect(groups[0]!.removals[0]!.reason).toContain("已失效");
  });

  it("uses the duplicate reason when both copies are playable", () => {
    const groups = buildCleanup([
      song("keep", { popularity: 90 }),
      song("drop", { popularity: 10 }),
    ]);
    expect(groups[0]!.removals[0]!.reason).toContain("重複");
  });

  it("mixes reasons within one group (a dead copy and a low-popularity copy)", () => {
    const groups = buildCleanup([
      song("keep", { popularity: 90 }),
      song("dead", { isPlayable: false, popularity: 99 }),
      song("low", { popularity: 10 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.id).toBe("keep");
    const byId = Object.fromEntries(groups[0]!.removals.map((r) => [r.track.id, r.reason]));
    expect(byId["dead"]).toContain("已失效");
    expect(byId["low"]).toContain("重複");
  });
});
```

- [ ] **Step 3: 跑測試，確認紅**

Run: `pnpm --filter @stm/backend test -- src/domain/cleanup.test.ts`
Expected: FAIL — `buildCleanup` 仍回傳平面 `CleanupItem[]`（無 `keep`／`removals` 屬性），型別與斷言雙雙失敗。

- [ ] **Step 4: 改寫 `buildCleanup`**

`apps/backend/src/domain/cleanup.ts` 全檔替換為：

```ts
import type { CleanupGroup, Track } from "@stm/shared";
import { findConfidentDuplicates } from "./detect";
import { planDeletions } from "./dedupe";

// The one-click "cleanup" plan: a safe, explainable list of duplicate groups.
// It only touches *confident* duplicates (same name+artist or same ISRC), so every
// removal leaves an equivalent copy behind — nothing is lost. Both sides of each
// group carry full Track info so the UI can lay them out for human verification;
// the reason belongs to each removal (one group can mix stale + duplicate).

const REASON_STALE = "已失效,且已有可播放的同名同歌手版本";
const REASON_DUPLICATE = "重複(已保留同組人氣最高者)";

/**
 * Build the cleanup groups from a library snapshot. For every confident-duplicate
 * group we keep the best copy (playable, then most popular) and pair it with the
 * rest — flagging the ones that are removable *because* they are dead.
 */
export function buildCleanup(tracks: Track[]): CleanupGroup[] {
  const plan = planDeletions(findConfidentDuplicates(tracks), "popularity");
  return plan.resolutions.map(({ keep, remove }) => ({
    keep,
    removals: remove.map((t) => ({
      track: t,
      reason: !t.isPlayable && keep.isPlayable ? REASON_STALE : REASON_DUPLICATE,
    })),
  }));
}
```

（原 `displayArtists` 刪除 — 顯示用組合是前端的事。）

- [ ] **Step 5: 跑測試與後端型別檢查，確認綠**

Run: `pnpm --filter @stm/backend test; pnpm --filter @stm/shared typecheck; pnpm --filter @stm/backend typecheck`
Expected: 後端測試全 PASS（含既有 detect/dedupe/library-service 等），兩個套件 typecheck 無錯。root `pnpm typecheck` 此刻仍紅（前端尚未跟上），屬預期。

- [ ] **Step 6: Commit**

```powershell
git add packages/shared/src/index.ts apps/backend/src/domain/cleanup.ts apps/backend/src/domain/cleanup.test.ts
git commit -m "feat(shared,backend): cleanup plan carries keep+removals groups for side-by-side review"
```

---

### Task 2: `searchTracks` 過濾不可播放 + `durationMs` + 可注入 fetcher（後端 TDD）

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/backend/src/adapters/spotify/library.ts`
- Test: `apps/backend/src/adapters/spotify/library.test.ts`

**Interfaces:**
- Consumes: `apiJson`（`apps/backend/src/adapters/spotify/api.ts` 既有）。
- Produces: `SearchResultSchema` 增欄位 `durationMs: number`；`searchTracks(query: string, fetcher: typeof apiJson = apiJson): Promise<SearchResult[]>`（原第二參數 `limit = 10` 移除，改為內部常數）。`gateway.ts` 的 `searchTracks: (q) => searchTracks(q)` 不需改動。

- [ ] **Step 1: 契約加 `durationMs`**

`packages/shared/src/index.ts` 的 `SearchResultSchema` 改為：

```ts
/** A simplified search result for finding a replacement track. */
export const SearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  artist: z.string(),
  album: z.string(),
  durationMs: z.number().int(),
});
```

- [ ] **Step 2: 追加失敗測試**

`apps/backend/src/adapters/spotify/library.test.ts` — 檔頭 import 區改為：

```ts
import { describe, expect, it } from "vitest";
import { collect, fetchSavedTracks, searchTracks, type Pager } from "./library";
import type { apiJson } from "./api";
import type { RawSavedItem } from "./normalize";
```

檔尾追加：

```ts
/** Raw /search track item with sensible defaults; override per test. */
const rawResult = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Song ${id}`,
  artists: [{ name: "A" }],
  album: { name: "Al" },
  duration_ms: 210_000,
  is_playable: true,
  ...over,
});

/** Fake apiJson serving a fixed /search payload, recording requested paths. */
const fakeFetcher = (items: unknown[], seen: string[] = []) =>
  (async (path: string) => {
    seen.push(path);
    return { tracks: { items } };
  }) as unknown as typeof apiJson;

describe("searchTracks", () => {
  it("filters out unplayable results", async () => {
    const results = await searchTracks(
      "q",
      fakeFetcher([rawResult("ok"), rawResult("dead", { is_playable: false })]),
    );
    expect(results.map((r) => r.id)).toEqual(["ok"]);
  });

  it("treats a missing is_playable flag as playable", async () => {
    const results = await searchTracks(
      "q",
      fakeFetcher([rawResult("noflag", { is_playable: undefined })]),
    );
    expect(results.map((r) => r.id)).toEqual(["noflag"]);
  });

  it("caps results at 10 after filtering", async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      rawResult(`t${i}`, { is_playable: i % 4 !== 0 }), // t0,t4,... 5 首不可播放
    );
    const results = await searchTracks("q", fakeFetcher(items));
    expect(results).toHaveLength(10);
    expect(results.every((r) => !["t0", "t4", "t8", "t12", "t16"].includes(r.id))).toBe(true);
  });

  it("maps durationMs and defaults it to 0 when missing", async () => {
    const results = await searchTracks(
      "q",
      fakeFetcher([rawResult("a", { duration_ms: 187_000 }), rawResult("b", { duration_ms: undefined })]),
    );
    expect(results.map((r) => r.durationMs)).toEqual([187_000, 0]);
  });

  it("over-fetches 20 from the user's market so filtering can't starve the list", async () => {
    const seen: string[] = [];
    await searchTracks("周杰倫 晴天", fakeFetcher([], seen));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("limit=20");
    expect(seen[0]).toContain("market=from_token");
  });
});
```

- [ ] **Step 3: 跑測試，確認紅**

Run: `pnpm --filter @stm/backend test -- src/adapters/spotify/library.test.ts`
Expected: FAIL — `searchTracks` 第二參數還是 `limit: number`，把 fetcher 當數字用；且結果無 `durationMs`、不過濾。

- [ ] **Step 4: 改寫 `searchTracks`**

`apps/backend/src/adapters/spotify/library.ts` — 將 `RawSearchTrack` 與 `searchTracks` 整段替換為：

```ts
interface RawSearchTrack {
  id: string;
  name: string;
  artists?: { name?: string }[];
  album?: { name?: string };
  duration_ms?: number;
  is_playable?: boolean;
}

const SEARCH_LIMIT = 10;
// Over-fetch so dropping unplayable results doesn't starve the list.
const SEARCH_OVERFETCH = 20;

/**
 * Search the catalog for replacement candidates for a dead track. Only playable
 * results survive (a replacement that is itself dead is useless); `fetcher` is
 * injectable so tests stay offline, mirroring `collect`'s pager seam.
 */
export async function searchTracks(
  query: string,
  fetcher: typeof apiJson = apiJson,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    market: MARKET,
    limit: String(SEARCH_OVERFETCH),
  });
  const data = await fetcher<{ tracks?: { items?: RawSearchTrack[] } }>(`/search?${params}`);
  return (data.tracks?.items ?? [])
    .filter((t) => t.is_playable !== false)
    .slice(0, SEARCH_LIMIT)
    .map((t) => ({
      id: t.id,
      name: t.name,
      artist: (t.artists ?? []).map((a) => a.name ?? "").join(", "),
      album: t.album?.name ?? "",
      durationMs: t.duration_ms ?? 0,
    }));
}
```

- [ ] **Step 5: 跑測試與型別檢查，確認綠**

Run: `pnpm --filter @stm/backend test; pnpm --filter @stm/shared typecheck; pnpm --filter @stm/backend typecheck`
Expected: 全 PASS／無錯（root typecheck 仍因前端紅，Task 3 解）。

- [ ] **Step 6: Commit**

```powershell
git add packages/shared/src/index.ts apps/backend/src/adapters/spotify/library.ts apps/backend/src/adapters/spotify/library.test.ts
git commit -m "feat(backend): replacement search returns only playable tracks with durationMs"
```

---

### Task 3: 前端清理分頁群組化（client / store / primitives / App / CleanupView）

**Files:**
- Modify: `apps/frontend/src/api/client.ts`
- Modify: `apps/frontend/src/store/ui.ts`
- Modify: `apps/frontend/src/components/primitives.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/components/CleanupView.tsx`（重寫）

**Interfaces:**
- Consumes: `CleanupGroup`（Task 1）、`usePlayTrack`／`useDeleteTracks`（既有 hooks）、`formatDate`／`formatDuration`（既有 lib）、`Dialog`／`Badge`／`Button`／`Icon`／`cx`（既有元件）。
- Produces: `LibrarySnapshot.cleanup: CleanupGroup[]`；ui store 新增 `cleanupExcluded: Set<string>` 與 `toggleCleanupGroup(keepId: string): void`；`Badge` 新增 `tone="ok"`；`CleanupView` props 由 `{ items: CleanupItem[] }` 改為 `{ groups: CleanupGroup[] }`。

前端無測試基建（repo 現況）— 本 task 以 root `pnpm typecheck` + `pnpm lint` 為機械驗證，行為驗證在 Task 5 的 mock-server 手動流程。

- [ ] **Step 1: `client.ts` 換型別**

`apps/frontend/src/api/client.ts` — 首行 import 與 `LibrarySnapshot` 改為：

```ts
import type { CleanupGroup, HistoryBatch, SearchResult, Track } from "@stm/shared";
```

```ts
export interface LibrarySnapshot {
  tracks: Track[];
  cleanup: CleanupGroup[];
  fetchedAt: string;
}
```

- [ ] **Step 2: ui store 加排除集合**

`apps/frontend/src/store/ui.ts` — `UiState` interface 的 `selected: Set<string>;` 之後加：

```ts
  /** Cleanup groups the user unchecked (key = keep.id). Stale ids are ignored at read time. */
  cleanupExcluded: Set<string>;
```

`clearSelection: () => void;` 之後加：

```ts
  toggleCleanupGroup: (keepId: string) => void;
```

實作物件裡 `selected: new Set(),` 之後加 `cleanupExcluded: new Set(),`；`clearSelection` 之後加：

```ts
  toggleCleanupGroup: (keepId) =>
    set((s) => {
      const next = new Set(s.cleanupExcluded);
      next.has(keepId) ? next.delete(keepId) : next.add(keepId);
      return { cleanupExcluded: next };
    }),
```

（`setTab` 不清 `cleanupExcluded` — 切分頁保留勾選狀態正是需求。）

- [ ] **Step 3: `Badge` 加 `ok` tone**

`apps/frontend/src/components/primitives.tsx` — `Badge` 改為：

```tsx
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "ok" }) {
  const tones = {
    neutral: "bg-stone-200/70 text-stone-600",
    accent: "bg-accent/10 text-accent",
    warn: "bg-amber-100 text-amber-800",
    ok: "bg-emerald-100 text-emerald-700",
  } as const;
  return (
    <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold nums", tones[tone])}>
      {children}
    </span>
  );
}
```

- [ ] **Step 4: `App.tsx` 改 props 與計數**

`apps/frontend/src/App.tsx` — `counts` 一行改為（cleanup 徽章數維持「可移除首數」語意）：

```tsx
  const counts = {
    all: tracks.length,
    cleanup: cleanup.reduce((n, g) => n + g.removals.length, 0),
    unplayable: unplayable.length,
  };
```

`<CleanupView items={cleanup} />` 改為 `<CleanupView groups={cleanup} />`。

- [ ] **Step 5: 重寫 `CleanupView`**

`apps/frontend/src/components/CleanupView.tsx` 全檔替換為：

```tsx
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
```

- [ ] **Step 6: 全 repo 型別與 lint 檢查**

Run: `pnpm typecheck; pnpm lint`
Expected: 兩者全綠 — 全 repo 已無 `CleanupItem` 引用（`durationMs` 為加法變更，`ReplaceDialog` 未用不受影響）。

- [ ] **Step 7: Commit**

```powershell
git add apps/frontend/src/api/client.ts apps/frontend/src/store/ui.ts apps/frontend/src/components/primitives.tsx apps/frontend/src/App.tsx apps/frontend/src/components/CleanupView.tsx
git commit -m "feat(frontend): cleanup tab shows keep/remove side-by-side with per-group opt-out and audition"
```

---

### Task 4: `ReplaceDialog` 試聽鍵 + 時長 + 播放錯誤提示 + 空結果文案

**Files:**
- Modify: `apps/frontend/src/components/ReplaceDialog.tsx`

**Interfaces:**
- Consumes: `usePlayTrack`（既有）、`formatDuration`（既有）、`SearchResult.durationMs`（Task 2）。
- Produces: 無新介面 — 純 UI 變更。

- [ ] **Step 1: 修改 `ReplaceDialog`**

`apps/frontend/src/components/ReplaceDialog.tsx` — import 區改為：

```tsx
import type { Track } from "@stm/shared";
import { useState } from "react";
import { useAddTracks, useDeleteTracks, usePlayTrack, useSearchTracks } from "../hooks/useLibrary";
import { formatDuration } from "../lib/format";
import { Button, Icon } from "./primitives";
import { Dialog } from "./Dialog";
```

`const del = useDeleteTracks();` 之後加一行：

```tsx
  const play = usePlayTrack();
```

結果列表區塊（`<div className="mt-3 max-h-72 ...">` 整段）替換為：

```tsx
      <div className="mt-3 max-h-72 overflow-auto rounded-md border border-stone-200">
        {results.isPending && query.trim() && <p className="p-4 text-sm text-stone-400">搜尋中…</p>}
        {results.data?.length === 0 && (
          <p className="p-4 text-sm text-stone-400">沒有結果(已濾除不可播放的版本)</p>
        )}
        {results.data?.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-3 border-b border-stone-100 px-3 py-2 last:border-0 hover:bg-stone-50"
          >
            <button
              onClick={() => play.mutate(r.id)}
              title="試聽"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-accent hover:text-white"
            >
              <Icon name="play" className="h-3.5 w-3.5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.name}</div>
              <div className="truncate text-xs text-stone-500">
                {r.artist} · {r.album} · {formatDuration(r.durationMs)}
              </div>
            </div>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => replace(r.id)}>
              <Icon name="swap" className="h-3.5 w-3.5" />
              替換
            </Button>
          </div>
        ))}
      </div>

      {play.isError && (
        <p className="mt-2 text-xs text-red-700">無法播放:請先開啟 Spotify 播放器(需 Premium)。</p>
      )}
```

- [ ] **Step 2: 型別與 lint 檢查**

Run: `pnpm typecheck; pnpm lint`
Expected: 全綠。

- [ ] **Step 3: Commit**

```powershell
git add apps/frontend/src/components/ReplaceDialog.tsx
git commit -m "feat(frontend): replacement results are auditionable with duration and play-failure hint"
```

---

### Task 5: mock-server 更新 + 手動驗證 + 全綠總驗證

**Files:**
- Modify: `apps/frontend/mock-server.mjs`

**Interfaces:**
- Consumes: Task 1 的 `CleanupGroup` 形狀、Task 2 的 `SearchResult.durationMs`（mock 是純 JS,不吃型別 — 形狀必須與契約肉眼對齊）。
- Produces: 供手動驗證的假資料。

- [ ] **Step 1: 更新 mock 資料形狀**

`apps/frontend/mock-server.mjs` — `const cleanup = [...]` 整段替換為（沿用檔內既有 `tracks` 陣列的物件參照;`t01`=index 0）：

```js
// Cleanup groups the 清理 tab renders side-by-side (keep + removals with reasons).
const cleanup = [
  { keep: tracks[0], removals: [{ track: tracks[1], reason: "重複(已保留同組人氣最高者)" }] }, // 起風了
  { keep: tracks[2], removals: [{ track: tracks[3], reason: "重複(已保留同組人氣最高者)" }] }, // 我相信
  { keep: tracks[4], removals: [{ track: tracks[22], reason: "重複(已保留同組人氣最高者)" }] }, // 天后
];
```

`/api/search` 回應替換為（結果加 `durationMs`;模擬後端已濾除不可播放者）：

```js
  if (url.pathname === "/api/search")
    return res.end(JSON.stringify({ results: [
      { id: "r1", name: "她說 (2023 重新錄音)", artist: "林俊傑", album: "她說", durationMs: 254000 },
      { id: "r2", name: "她說 (Live)", artist: "林俊傑", album: "演唱會實況", durationMs: 271000 },
    ] }));
```

- [ ] **Step 2: 啟動 mock + 前端,手動驗證**

Run（兩個背景進程）: `node apps/frontend/mock-server.mjs`、`pnpm --filter @stm/frontend dev`,開 `http://localhost:5173`。

核對清單:
1. 「清理」分頁徽章數 = 3(可移除首數);頁面顯示 3 張群組卡片,各含「保留」(綠)與「移除·重複」(琥珀)兩列,欄位並列(專輯/人氣/日期/時長),每列有 ▶。
2. 取消勾選一組 → 卡片變半透明、頂欄「已勾選 2 首」、按鈕變「一鍵清理 (2)」;全取消 → 按鈕 disabled。
3. 切到「總覽」再切回「清理」→ 勾選狀態保留。
4. 「一鍵清理」確認對話框顯示「2 組共 2 首」字樣(依勾選數)。
5. 「失效」分頁 → 任一首「尋找替代」→ 結果列有 ▶、時長(4:14/4:31);清空搜尋字再輸入無結果關鍵字 → 顯示「沒有結果(已濾除不可播放的版本)」。
6. mock 環境按 ▶ 會 POST /api/play(mock 回 ok,不會真的出聲)— 錯誤提示路徑需在真後端環境驗證(關閉 Spotify 播放器按 ▶ 應出現紅字提示),留待真機驗收。

- [ ] **Step 3: 全綠總驗證**

Run: `pnpm -r build; pnpm typecheck; pnpm lint; pnpm test`
Expected: 四項全綠。

- [ ] **Step 4: Commit**

```powershell
git add apps/frontend/mock-server.mjs
git commit -m "chore(frontend): mock server serves cleanup groups and playable search results"
```

import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Track, SuspectPair, CleanupGroup } from "@stm/shared";
import { CleanupView } from "./CleanupView";
import { diffParts } from "../lib/titleDiff";

const H = vi.hoisted(() => ({
  del: vi.fn((_ids: string[], opts?: any) => opts?.onSuccess?.()),
  dismiss: vi.fn((_key: string, opts?: any) => opts?.onSuccess?.()),
  play: vi.fn(),
}));

vi.mock("../hooks/useLibrary", () => ({
  useDeleteTracks: () => ({ mutate: H.del, isPending: false }),
  useDismissSuspect: () => ({ mutate: H.dismiss, isPending: false }),
  usePlayTrack: () => ({ mutate: H.play, isPending: false, isError: false }),
}));

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeTrack(overrides: Partial<Track>): Track {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    name: "曲名",
    artists: ["歌手"],
    isrc: null,
    popularity: 50,
    isPlayable: true,
    addedAt: "2024-01-01T00:00:00.000Z",
    album: "專輯",
    albumId: "album-1",
    releaseDate: "2024-01-01",
    durationMs: 200000,
    ...overrides,
  };
}

function makePair(): SuspectPair {
  const keep = makeTrack({
    id: "keep-1",
    name: "曲名A",
    artists: ["歌手A", "客座B"],
  });
  const remove = makeTrack({
    id: "remove-1",
    name: "曲名B",
    artists: ["歌手C", "客座D"],
  });
  return {
    keep,
    remove,
    pairKey: "keep-1|remove-1",
    score: 0.9,
    hints: ["版本後綴"],
  };
}

function makeTitledPair(keepName: string, removeName: string): SuspectPair {
  const keep = makeTrack({
    id: "keep-titled-1",
    name: keepName,
    artists: ["同曲歌手"],
  });
  const remove = makeTrack({
    id: "remove-titled-1",
    name: removeName,
    artists: ["同曲歌手"],
  });
  return {
    keep,
    remove,
    pairKey: "keep-titled-1|remove-titled-1",
    score: 0.9,
    hints: ["版本後綴"],
  };
}

function makeGroup(): CleanupGroup {
  const keep = makeTrack({ id: "g-keep-1", name: "群組曲目", artists: ["群組歌手"] });
  const removedTrack = makeTrack({ id: "g-remove-1", name: "群組曲目重複", artists: ["群組歌手"] });
  return {
    keep,
    removals: [{ track: removedTrack, reason: "dead" }],
  };
}

async function openRemovalDialog(track: Track) {
  const user = userEvent.setup();
  const removeBtn = screen.getByRole("button", {
    name: new RegExp("移除這首.*" + escapeRegex(track.name)),
  });
  await user.click(removeBtn);
  const dialog = await screen.findByRole("dialog", { name: /確認移除/ });
  return { user, dialog, removeBtn };
}

async function confirmRemoval(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  const confirmBtn = within(dialog).getByRole("button", { name: /確認移除/ });
  await user.click(confirmBtn);
}

beforeEach(() => {
  H.del.mockClear();
  H.dismiss.mockClear();
  H.play.mockClear();
});

describe("CleanupView 疑似重複場景", () => {
  it("test_S1_不預選且每列各有移除這首按鈕", () => {
    const pair = makePair();
    render(<CleanupView groups={[]} suspects={[pair]} />);

    expect(screen.queryByText("建議保留")).not.toBeInTheDocument();
    expect(screen.queryByText("疑似多餘")).not.toBeInTheDocument();

    const keepBtn = screen.getByRole("button", {
      name: new RegExp(
        "移除這首.*" +
          escapeRegex(pair.keep.name) +
          ".*" +
          escapeRegex(pair.keep.artists.join(", ")),
      ),
    });
    const removeBtn = screen.getByRole("button", {
      name: new RegExp(
        "移除這首.*" +
          escapeRegex(pair.remove.name) +
          ".*" +
          escapeRegex(pair.remove.artists.join(", ")),
      ),
    });
    expect(keepBtn).toBeInTheDocument();
    expect(removeBtn).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /^不是重複/ }),
    ).toBeInTheDocument();

    expect(screen.getByText(pair.hints[0]!)).toBeInTheDocument();
  });

  it("test_S2_移除原keep那首會呼叫刪除且焦點回標題", async () => {
    const pair = makePair();
    render(<CleanupView groups={[]} suspects={[pair]} />);

    const heading = screen.getByRole("heading", { name: /疑似重複/ });

    const chosen = pair.keep;
    const other = pair.remove;
    const { user, dialog } = await openRemovalDialog(chosen);

    within(dialog).getByText(
      new RegExp("即將移除「" + escapeRegex(chosen.name)),
    );
    expect(dialog.textContent).toMatch(
      new RegExp("保留.*" + escapeRegex(other.name)),
    );
    expect(dialog.textContent).toMatch(/「歷史」中復原/);

    await confirmRemoval(user, dialog);

    expect(H.del).toHaveBeenCalledTimes(1);
    expect(H.del.mock.calls[0]![0]).toEqual([pair.keep.id]);

    await waitFor(() => expect(document.activeElement).toBe(heading));

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent ?? "").toMatch(
        new RegExp("已移除.*" + escapeRegex(chosen.name)),
      );
    });
  });

  it("test_S3_移除原remove那首會呼叫刪除", async () => {
    const pair = makePair();
    render(<CleanupView groups={[]} suspects={[pair]} />);

    const chosen = pair.remove;
    const other = pair.keep;
    const { user, dialog } = await openRemovalDialog(chosen);

    within(dialog).getByText(
      new RegExp("即將移除「" + escapeRegex(chosen.name)),
    );
    expect(dialog.textContent).toMatch(
      new RegExp("保留.*" + escapeRegex(other.name)),
    );
    expect(dialog.textContent).toMatch(/「歷史」中復原/);

    await confirmRemoval(user, dialog);

    expect(H.del).toHaveBeenCalledTimes(1);
    expect(H.del.mock.calls[0]![0]).toEqual([pair.remove.id]);

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent ?? "").toMatch(
        new RegExp("已移除.*" + escapeRegex(chosen.name)),
      );
    });
  });

  it("test_S4_不是重複會觸發dismiss並播報", async () => {
    const pair = makePair();
    render(<CleanupView groups={[]} suspects={[pair]} />);
    const user = userEvent.setup();

    const dismissBtn = screen.getByRole("button", { name: /^不是重複/ });
    await user.click(dismissBtn);

    expect(H.dismiss).toHaveBeenCalledTimes(1);
    expect(H.dismiss.mock.calls[0]![0]).toBe(pair.pairKey);

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent ?? "").not.toBe("");
    });
  });

  it("test_S5_取消移除為no-op", async () => {
    const pair = makePair();
    render(<CleanupView groups={[]} suspects={[pair]} />);
    const user = userEvent.setup();

    const removeBtn = screen.getByRole("button", {
      name: new RegExp("移除這首.*" + escapeRegex(pair.keep.name)),
    });
    await user.click(removeBtn);
    const dialog = await screen.findByRole("dialog", { name: /確認移除/ });
    const cancelBtn = within(dialog).getByRole("button", { name: /取消/ });
    await user.click(cancelBtn);

    expect(H.del).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // 取消後焦點回觸發鈕是 Radix Dialog 的預設 focus-restore（本元件無自訂邏輯），
    // jsdom 不忠實重現該行為、故不在此斷言；DoD 要求的「成功移除/忽略後焦點回『疑似重複』標題」由 test_S2 鎖住。
  });

  it("test_S6_confident群組區塊不受疑似重複改動影響", () => {
    const group = makeGroup();
    const pair = makePair();
    render(<CleanupView groups={[group]} suspects={[pair]} />);

    expect(screen.getByText(/可一鍵清理/)).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(1);
    void group;

    expect(
      screen.getByRole("button", { name: /一鍵清理/ }),
    ).toBeInTheDocument();
  });
});

describe("CleanupView 疑似對辨識度（相異段加粗、不截斷）", () => {
  it("test_highlight_相異段加粗且不截斷（S1）", () => {
    const pair = makeTitledPair("勇氣", "勇氣 (Live版)");
    const { container } = render(<CleanupView groups={[]} suspects={[pair]} />);

    // 完整曲名文字都要在（不截斷），用容器 textContent 比對，因文字可能被 <strong> 拆節點
    expect(container.textContent ?? "").toContain(pair.keep.name);
    expect(container.textContent ?? "").toContain(pair.remove.name);

    const { aMiddle, bMiddle } = diffParts(pair.keep.name, pair.remove.name);
    expect(aMiddle).toBe(""); // keep 相對 remove 無多出差異段
    const expectedMiddle = bMiddle.trim();
    expect(expectedMiddle.length).toBeGreaterThan(0);

    // 找出「文字內容恰好等於整個曲名」的最內層節點（不依賴實作標籤/class，只依賴渲染出的文字結構）
    function findTitleEl(name: string): HTMLElement | null {
      const candidates = Array.from(
        container.querySelectorAll<HTMLElement>("*"),
      ).filter((el) => (el.textContent ?? "").trim() === name);
      candidates.sort(
        (a, b) =>
          a.querySelectorAll("*").length - b.querySelectorAll("*").length,
      );
      return candidates[0] ?? null;
    }

    const keepTitleEl = findTitleEl(pair.keep.name);
    const removeTitleEl = findTitleEl(pair.remove.name);
    expect(keepTitleEl).not.toBeNull();
    expect(removeTitleEl).not.toBeNull();

    // keep 那列（無多出差異段）不應有任何加粗
    expect(keepTitleEl!.querySelectorAll("strong").length).toBe(0);

    // remove 那列的加粗文字須恰好等於相異中段（非只是「有包含」）
    const removeStrongs = Array.from(
      removeTitleEl!.querySelectorAll("strong"),
    );
    expect(removeStrongs.length).toBeGreaterThan(0);
    expect(
      removeStrongs.map((el) => (el.textContent ?? "").trim()).join(""),
    ).toBe(expectedMiddle);

    // 相同前綴「勇氣」不可被誤包進任何 <strong>
    const allStrongText = Array.from(container.querySelectorAll("strong"))
      .map((el) => el.textContent ?? "")
      .join("");
    expect(allStrongText).not.toContain(pair.keep.name);
  });

  it("test_highlight_跨語言零重疊不加粗（S2）", () => {
    const pair = makeTitledPair("告白氣球", "Bubble Love");
    const { commonPrefix, commonSuffix } = diffParts(pair.keep.name, pair.remove.name);
    expect(commonPrefix).toBe("");
    expect(commonSuffix).toBe("");

    const { container } = render(<CleanupView groups={[]} suspects={[pair]} />);

    expect(container.textContent ?? "").toContain(pair.keep.name);
    expect(container.textContent ?? "").toContain(pair.remove.name);
    expect(container.querySelectorAll("strong").length).toBe(0);
  });
});

describe("CleanupView 失敗回饋（mutation onError 不誤報成功）", () => {
  it("test_onError_移除失敗顯錯不誤報（S3）", async () => {
    const pair = makePair();
    H.del.mockImplementationOnce((_ids: string[], opts?: any) =>
      opts?.onError?.(new Error("boom")),
    );
    render(<CleanupView groups={[]} suspects={[pair]} />);

    const { user, dialog } = await openRemovalDialog(pair.keep);
    await confirmRemoval(user, dialog);

    expect(H.del).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/失敗/);

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent ?? "").not.toMatch(/已移除/);
    });
  });

  it("test_onError_dismiss失敗顯錯（S4）", async () => {
    const pair = makePair();
    H.dismiss.mockImplementationOnce((_key: string, opts?: any) =>
      opts?.onError?.(new Error("boom")),
    );
    render(<CleanupView groups={[]} suspects={[pair]} />);
    const user = userEvent.setup();

    const dismissBtn = screen.getByRole("button", { name: /^不是重複/ });
    await user.click(dismissBtn);

    expect(H.dismiss).toHaveBeenCalledTimes(1);
    const card = dismissBtn.closest('[role="group"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(within(card!).getByRole("alert")).toHaveTextContent(/失敗/);
    expect(screen.queryByText(/已標記.*不是重複/)).not.toBeInTheDocument();
  });

  it("test_onError_一鍵清理失敗顯錯不誤關（S5）", async () => {
    const group = makeGroup();
    render(<CleanupView groups={[group]} suspects={[]} />);
    const user = userEvent.setup();

    const cleanupBtn = screen.getByRole("button", { name: /一鍵清理/ });
    await user.click(cleanupBtn);
    const dialog = await screen.findByRole("dialog", { name: /確認清理/ });

    H.del.mockImplementationOnce((_ids: string[], opts?: any) =>
      opts?.onError?.(new Error("boom")),
    );
    const confirmBtn = within(dialog).getByRole("button", { name: /確認移除/ });
    await user.click(confirmBtn);

    expect(H.del).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/失敗/);
  });

  it("test_onError_移除重試後清除錯誤（F4）", async () => {
    const pair = makePair();
    H.del.mockImplementationOnce((_ids: string[], opts?: any) =>
      opts?.onError?.(new Error("boom")),
    );
    render(<CleanupView groups={[]} suspects={[pair]} />);

    const { user, dialog } = await openRemovalDialog(pair.remove);
    await confirmRemoval(user, dialog);

    expect(within(dialog).getByRole("alert")).toHaveTextContent(/失敗/);

    // 第二次點擊走預設成功 mock（未再被 mockImplementationOnce 蓋過）
    await confirmRemoval(user, dialog);

    expect(H.del).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

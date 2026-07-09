import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Track, SuspectPair, CleanupGroup } from "@stm/shared";
import { CleanupView } from "./CleanupView";

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
  const keep = makeTrack({ id: "keep-1", name: "曲名A", artists: ["歌手A"] });
  const remove = makeTrack({ id: "remove-1", name: "曲名B", artists: ["歌手B"] });
  return {
    keep,
    remove,
    pairKey: "keep-1|remove-1",
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

async function openAndConfirmRemoval(track: Track) {
  const user = userEvent.setup();
  const removeBtn = screen.getByRole("button", {
    name: new RegExp("移除這首.*" + escapeRegex(track.name)),
  });
  await user.click(removeBtn);
  const dialog = await screen.findByRole("dialog", { name: /確認移除/ });
  const confirmBtn = within(dialog).getByRole("button", { name: /確認移除/ });
  await user.click(confirmBtn);
  return user;
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
      name: new RegExp("移除這首.*" + escapeRegex(pair.keep.name)),
    });
    const removeBtn = screen.getByRole("button", {
      name: new RegExp("移除這首.*" + escapeRegex(pair.remove.name)),
    });
    expect(keepBtn).toBeInTheDocument();
    expect(removeBtn).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /^不是重複/ }),
    ).toBeInTheDocument();
  });

  it("test_S2_移除原keep那首會呼叫刪除且焦點回標題", async () => {
    const pair = makePair();
    render(<CleanupView groups={[]} suspects={[pair]} />);

    const heading = screen.getByRole("heading", { name: /疑似重複/ });

    await openAndConfirmRemoval(pair.keep);

    expect(H.del).toHaveBeenCalledTimes(1);
    expect(H.del.mock.calls[0]![0]).toEqual([pair.keep.id]);

    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("test_S3_移除原remove那首會呼叫刪除", async () => {
    const pair = makePair();
    render(<CleanupView groups={[]} suspects={[pair]} />);

    await openAndConfirmRemoval(pair.remove);

    expect(H.del).toHaveBeenCalledTimes(1);
    expect(H.del.mock.calls[0]![0]).toEqual([pair.remove.id]);
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

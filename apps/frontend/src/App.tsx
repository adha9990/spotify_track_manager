import { useMemo, useState } from "react";
import { CleanupView } from "./components/CleanupView";
import { HistoryPanel } from "./components/HistoryPanel";
import { Badge, Button, Icon } from "./components/primitives";
import { Tabs } from "./components/Tabs";
import { Toolbar } from "./components/Toolbar";
import { TrackTable } from "./components/TrackTable";
import { UnplayableView } from "./components/UnplayableView";
import { useLibrary, useStatus } from "./hooks/useLibrary";
import { prepareTracks, useVisibleTracks } from "./hooks/useVisibleTracks";
import { useUi } from "./store/ui";

export default function App() {
  const status = useStatus();
  const connected = Boolean(status.data?.connected);
  const library = useLibrary(connected);
  const tab = useUi((s) => s.tab);

  const tracks = useMemo(() => library.data?.tracks ?? [], [library.data]);
  const cleanup = library.data?.cleanup ?? [];
  const prepared = useMemo(() => prepareTracks(tracks), [tracks]);
  const unplayable = useMemo(() => tracks.filter((t) => !t.isPlayable), [tracks]);
  const visible = useVisibleTracks(prepared); // hook — must run every render

  const counts = {
    all: tracks.length,
    cleanup: cleanup.reduce((n, g) => n + g.removals.length, 0),
    unplayable: unplayable.length,
  };
  const snap = library.data;
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col px-8 pb-6 pt-8">
      <header className="flex items-end justify-between gap-6 border-b-2 border-ink/80 pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-accent">
            Spotify · Library Almanac
          </p>
          <h1 className="font-display text-5xl font-black tracking-tight text-ink">收藏年鑑</h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConnectionPill
            loading={status.isPending}
            connected={connected}
            user={status.data?.user ?? null}
            product={status.data?.product ?? null}
          />
          {connected && (
            <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
              <Icon name="refresh" className="h-3.5 w-3.5" />
              歷史
            </Button>
          )}
        </div>
      </header>

      <HistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} />

      <main className="flex min-h-0 flex-1 flex-col">
        {!connected ? (
          <NotConnected loading={status.isPending} error={status.data?.error} />
        ) : library.isPending ? (
          <Centered>正在載入你的收藏…</Centered>
        ) : library.isError ? (
          <Centered tone="error">
            載入失敗:{String((library.error as Error).message)}
          </Centered>
        ) : (
          <>
            <div className="pt-4">
              <Tabs counts={counts} />
            </div>
            {tab === "all" && (
              <>
                <Toolbar visibleCount={visible.length} />
                <TrackTable tracks={visible} />
              </>
            )}
            {tab === "cleanup" && (
              <div className="flex min-h-0 flex-1 flex-col pt-4">
                <CleanupView groups={cleanup} />
              </div>
            )}
            {tab === "unplayable" && (
              <div className="flex min-h-0 flex-1 flex-col pt-4">
                <UnplayableView tracks={unplayable} />
              </div>
            )}
            {snap && <Footer snap={snap} />}
          </>
        )}
      </main>
    </div>
  );
}

function ConnectionPill({
  loading,
  connected,
  user,
  product,
}: {
  loading: boolean;
  connected: boolean;
  user: string | null;
  product: string | null;
}) {
  if (loading) return <span className="text-sm text-stone-400">連線中…</span>;
  if (!connected) return <span className="text-sm text-accent">尚未連線</span>;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      <span className="font-medium">{user ?? "Spotify 使用者"}</span>
      {product && <Badge tone={product === "premium" ? "accent" : "neutral"}>{product}</Badge>}
    </div>
  );
}

function NotConnected({ loading, error }: { loading: boolean; error?: string }) {
  return (
    <Centered>
      <div className="max-w-md text-center">
        <p className="font-display text-2xl font-semibold text-ink">尚未連線 Spotify</p>
        <p className="mt-2 text-stone-500">
          {loading
            ? "正在嘗試連線…"
            : "請在桌面 App 的登入視窗登入你的 Spotify 帳號,即可開始整理收藏。"}
        </p>
        {error && <p className="mt-3 text-xs text-stone-400">{error}</p>}
      </div>
    </Centered>
  );
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      className={`flex flex-1 items-center justify-center text-center ${
        tone === "error" ? "text-red-700" : "text-stone-500"
      }`}
    >
      {children}
    </div>
  );
}

function Footer({ snap }: { snap: { fetchedAt: string } }) {
  return (
    <footer className="mt-2 flex items-center gap-4 pt-2 text-xs text-stone-400">
      <span>更新於 {snap.fetchedAt.slice(0, 16).replace("T", " ")}</span>
    </footer>
  );
}

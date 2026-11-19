import type { PlayTrackRequest } from "@stm/shared";
import { useMemo, useState } from "react";
import { HistoryPanel } from "./components/HistoryPanel";
import { PlaybackBar } from "./components/PlaybackBar";
import { PlaylistView } from "./components/PlaylistView";
import { Badge, Button, Icon } from "./components/primitives";
import { Tabs } from "./components/Tabs";
import { Toolbar } from "./components/Toolbar";
import { TrackTable } from "./components/TrackTable";
import { UnplayableView } from "./components/UnplayableView";
import { useLibrary, useLogout, useStatus } from "./hooks/useLibrary";
import { BrowserPlaybackProvider } from "./hooks/BrowserPlaybackProvider";
import { followingTracks } from "./hooks/usePlayback";
import { usePlaylist, usePlaylists } from "./hooks/usePlaylists";
import { prepareTracks, useVisibleTracks } from "./hooks/useVisibleTracks";
import { formatDateTime } from "./lib/format";
import { findUnplayableTracks } from "./lib/unplayable-tracks";
import { useUi } from "./store/ui";

export default function App() {
  const status = useStatus();
  const connected = Boolean(status.data?.connected);
  const logout = useLogout();
  const tab = useUi((s) => s.tab);
  const [playlistId, setPlaylistId] = useState("");
  const showSource = connected && tab === "songs";
  const playlists = usePlaylists(showSource);
  const playlist = playlists.data?.find(({ id }) => id === playlistId);
  const viewingPlaylist = tab === "songs" && playlist !== undefined;
  const contents = usePlaylist(viewingPlaylist ? playlist.id : null);
  const library = useLibrary(connected && !viewingPlaylist);

  const tracks = useMemo(() => library.data?.tracks ?? [], [library.data]);
  const prepared = useMemo(() => prepareTracks(tracks), [tracks]);
  const unplayable = useMemo(() => findUnplayableTracks(tracks), [tracks]);
  const visible = useVisibleTracks(prepared); // hook — must run every render

  const snap = library.data;
  const [historyOpen, setHistoryOpen] = useState(false);
  const firstTrack = useMemo<PlayTrackRequest | undefined>(() => {
    if (viewingPlaylist) {
      const entry = contents.data?.entries.find(({ track }) => track.isPlayable);
      return entry && {
        id: entry.track.id, context: { type: "playlist", playlistId: playlist.id, position: entry.position },
      };
    }
    const index = visible.findIndex(({ isPlayable }) => isPlayable);
    const track = visible[index];
    return track && { id: track.id, context: followingTracks(visible, index) };
  }, [contents.data, playlist, viewingPlaylist, visible]);

  const layout = (
    <div className="mx-auto flex h-dvh max-w-6xl flex-col px-4 pb-6 pt-6 sm:px-8 sm:pt-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink/80 pb-4">
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
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
                <Icon name="refresh" className="h-3.5 w-3.5" />
                歷史
              </Button>
              <Button size="sm" variant="ghost" disabled={logout.isPending} onClick={() => logout.mutate()}>
                登出
              </Button>
            </div>
          )}
          {logout.isError && <p role="alert" className="text-sm text-red-700">登出失敗，請重試。</p>}
        </div>
      </header>

      <HistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} />

      <main className="flex min-h-0 flex-1 flex-col">
        {connected && (
          <div className="pt-4">
            <Tabs unplayableCount={library.data ? unplayable.unresolved.length : undefined} />
          </div>
        )}
        {showSource && (
          <div className="flex flex-wrap items-center gap-3 pt-4">
            <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm font-medium">
              <span>歌曲來源</span>
              <select
                value={playlist?.id ?? ""}
                onChange={(event) => setPlaylistId(event.target.value)}
                className="max-w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-ink"
              >
                <option value="">全部收藏</option>
                {playlists.data?.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
              </select>
            </label>
            {playlists.isPending && <span role="status" className="text-sm text-stone-500">正在載入歌單…</span>}
            {playlists.isError && (
              <div className="flex items-center gap-2 text-sm">
                <span role="alert" className="text-red-700">無法載入 Spotify 歌單。</span>
                <Button size="sm" variant="ghost" onClick={() => void playlists.refetch()}>重試</Button>
              </div>
            )}
          </div>
        )}
        {!connected ? (
          <NotConnected loading={status.isPending} statusFailed={status.isError} />
        ) : viewingPlaylist ? (
          <PlaylistView key={playlist.id} playlist={playlist} contents={contents} />
        ) : library.isPending ? (
          <Centered>正在載入你的收藏…</Centered>
        ) : library.isError ? (
          <Centered tone="error">
            <div role="alert">
              <p>載入收藏失敗。{library.error.message}</p>
              <Button size="sm" variant="ghost" onClick={() => void library.refetch()}>重試</Button>
            </div>
          </Centered>
        ) : (
          <>
            {tab === "songs" && (
              <>
                <Toolbar visibleCount={visible.length} tracks={tracks} />
                <TrackTable tracks={visible} />
              </>
            )}
            {tab === "unplayable" && (
              <div className="flex min-h-0 flex-1 flex-col pt-4">
                <UnplayableView {...unplayable} />
              </div>
            )}
            {snap && <Footer snap={snap} />}
          </>
        )}
      </main>
      {connected && <PlaybackBar firstTrack={firstTrack} />}
    </div>
  );
  return <BrowserPlaybackProvider enabled={connected}>{layout}</BrowserPlaybackProvider>;
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

function NotConnected({ loading, statusFailed }: { loading: boolean; statusFailed: boolean }) {
  const loginFailed = new URLSearchParams(window.location.search).get("login") === "failed";
  return (
    <Centered>
      <div className="max-w-md text-center">
        <p className="font-display text-2xl font-semibold text-ink">尚未連線 Spotify</p>
        {loading ? (
          <p role="status" className="mt-2 text-stone-500">正在檢查連線…</p>
        ) : (
          <>
            {(loginFailed || statusFailed) && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {loginFailed ? "Spotify 授權未完成。請重新連線。" : "無法連到本機服務。請確認 Node.js 服務正在執行。"}
              </p>
            )}
            <a
              href="/api/auth/login"
              className="mt-4 inline-flex rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90"
            >
              連線 Spotify
            </a>
          </>
        )}
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
      <span>更新於 <time dateTime={snap.fetchedAt}>{formatDateTime(snap.fetchedAt)}</time></span>
    </footer>
  );
}

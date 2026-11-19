// Mock backend for driving / screenshotting the frontend without a Spotify login.
// Serves the same /api/* shape the real Fastify backend does, with sample data that
// exercises the source selector, playlist positions, and unplayable tracks.
// Saved-track deletions mutate the fixtures in memory.
// Run: `node mock-server.mjs [port]`  (default 8765).

import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 8765);

const track = (over) => ({
  id: over.id,
  name: over.name,
  artists: over.artists,
  isrc: over.isrc ?? null,
  popularity: over.popularity ?? 50,
  isPlayable: over.isPlayable ?? true,
  addedAt: over.addedAt ?? "2023-01-01T00:00:00Z",
  album: over.album ?? "精選輯",
  albumId: over.albumId ?? "alb",
  releaseDate: over.releaseDate ?? "2020-01-01",
  durationMs: over.durationMs ?? 215000,
});

const tracks = [
  track({ id: "t01", name: "起風了", artists: ["買辣椒也用券"], album: "起風了", popularity: 78, addedAt: "2024-11-02T10:00:00Z" }),
  track({ id: "t02", name: "起風了", artists: ["買辣椒也用券"], album: "起風了 (Live)", popularity: 41, addedAt: "2022-03-12T10:00:00Z" }),
  track({ id: "t03", name: "我相信", artists: ["張杰"], album: "我相信", popularity: 69, addedAt: "2024-01-20T10:00:00Z" }),
  track({ id: "t04", name: "我相信", artists: ["張杰"], album: "勵志金曲合輯", popularity: 33, addedAt: "2021-07-01T10:00:00Z" }),
  track({ id: "t05", name: "天后", artists: ["陳勢安"], album: "親愛的偏執狂", popularity: 71, addedAt: "2023-09-15T10:00:00Z" }),
  track({ id: "t06", name: "派對動物", artists: ["五月天"], album: "自傳", popularity: 64, addedAt: "2023-05-05T10:00:00Z" }),
  track({ id: "t07", name: "突然好想你", artists: ["五月天"], album: "後青春期的詩", popularity: 75, addedAt: "2022-12-25T10:00:00Z" }),
  track({ id: "t08", name: "光年之外", artists: ["鄧紫棋"], album: "光年之外", popularity: 80, addedAt: "2024-02-14T10:00:00Z" }),
  track({ id: "t09", name: "倒數", artists: ["鄧紫棋"], album: "倒數", popularity: 66, addedAt: "2023-08-08T10:00:00Z" }),
  track({ id: "t10", name: "刻在我心底的名字", artists: ["盧廣仲"], album: "刻在我心底的名字", popularity: 73, addedAt: "2023-02-10T10:00:00Z" }),
  track({ id: "t11", name: "魚仔", artists: ["盧廣仲"], album: "魚仔", popularity: 60, addedAt: "2022-06-18T10:00:00Z" }),
  track({ id: "t12", name: "小幸運", artists: ["田馥甄"], album: "小幸運", popularity: 77, addedAt: "2024-04-01T10:00:00Z" }),
  track({ id: "t13", name: "達爾文", artists: ["周杰倫"], album: "依然范特西", popularity: 55, isPlayable: false, addedAt: "2021-01-01T10:00:00Z" }),
  track({ id: "t14", name: "稻香", artists: ["周杰倫"], album: "魔杰座", popularity: 79, addedAt: "2024-03-03T10:00:00Z" }),
  track({ id: "t15", name: "晴天", artists: ["周杰倫"], album: "葉惠美", popularity: 83, addedAt: "2024-05-20T10:00:00Z" }),
  track({ id: "t16", name: "告白氣球", artists: ["周杰倫"], album: "周杰倫的床邊故事", popularity: 81, addedAt: "2024-06-01T10:00:00Z" }),
  track({ id: "t17", name: "她說", artists: ["林俊傑"], album: "100天", popularity: 58, isPlayable: false, addedAt: "2020-10-10T10:00:00Z" }),
  track({ id: "t18", name: "江南", artists: ["林俊傑"], album: "第二天堂", popularity: 70, addedAt: "2023-11-11T10:00:00Z" }),
  track({ id: "t19", name: "修煉愛情", artists: ["林俊傑"], album: "因你而在", popularity: 72, addedAt: "2023-07-07T10:00:00Z" }),
  track({ id: "t20", name: "Lemon", artists: ["米津玄師"], album: "BOOTLEG", popularity: 74, addedAt: "2024-01-01T10:00:00Z" }),
  track({ id: "t21", name: "ただ君に晴れ", artists: ["ヨルシカ"], album: "負け犬にアンコールはいらない", popularity: 62, isPlayable: false, addedAt: "2021-09-09T10:00:00Z" }),
  track({ id: "t22", name: "夜に駆ける", artists: ["YOASOBI"], album: "THE BOOK", popularity: 85, addedAt: "2024-02-02T10:00:00Z" }),
  track({ id: "t23", name: "天后", artists: ["陳勢安"], album: "天后 (重製版)", popularity: 38, addedAt: "2021-04-04T10:00:00Z" }),
  track({ id: "t24", name: "成全", artists: ["劉若英"], album: "我等你", popularity: 57, addedAt: "2022-02-22T10:00:00Z" }),
  track({ id: "t25", name: "Lemon - Live", artists: ["米津玄師"], album: "Lemon (Live at Budokan)", popularity: 52, durationMs: 218000, addedAt: "2023-06-15T10:00:00Z" }),
  track({ id: "t26", name: "晴天 (加長版)", artists: ["周杰倫"], album: "葉惠美 (紀念版)", popularity: 40, isPlayable: false, addedAt: "2021-05-05T10:00:00Z" }),
  track({ id: "t27", name: "演員", artists: ["薛之謙"], album: "绅士", popularity: 65, addedAt: "2024-08-08T10:00:00Z" }),
  track({ id: "t28", name: "演员", artists: ["薛之谦"], album: "演员", popularity: 45, addedAt: "2021-12-12T10:00:00Z" }),
];

const historyBatch = (batchId, action, ts, songs, undone = false) => ({
  batchId, action, ts, undone, count: songs.length,
  tracks: songs.map(({ id, name, artists, album }) => ({ id, name, artists, album })),
});
const historyBatches = [
  historyBatch("h1", "delete", "2026-06-06T09:31:00Z", [tracks[1], tracks[3]]),
  historyBatch("h2", "add", "2026-06-05T20:15:00Z", [tracks[4]]),
  historyBatch("h3", "delete", "2026-06-04T11:02:00Z", [tracks[12]], true),
];

const playlistTracks = [tracks[0], tracks[4], tracks[0], tracks[2], tracks[3]];
const demoPlaylists = [
  { id: "demoKtv", name: "KTV 範例", itemCount: playlistTracks.length },
  { id: "demoSolo", name: "通勤範例", itemCount: 1 },
];

const playbackQueue = tracks.filter(({ isPlayable }) => isPlayable);
let playbackIndex = 1;
let playbackPosition = 28_000;
let playingSince = Date.now();
let volumePercent = 55;

const positionMs = () => Math.min(playbackQueue[playbackIndex].durationMs,
  playbackPosition + (playingSince ? Date.now() - playingSince : 0));

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const routes = {
  "GET /api/status": () => ({ connected: true, user: "示範使用者", product: "premium" }),
  "GET /api/library": () => ({
    tracks,
    fetchedAt: "2026-06-08T10:00:00Z",
  }),
  "GET /api/playlists": () => ({ playlists: demoPlaylists }),
  "GET /api/playlists/demoKtv/items": () => ({
    entries: playlistTracks.map((track, index) => ({ track, position: index + 1 })),
    skipped: 0,
  }),
  "GET /api/playlists/demoSolo/items": () => ({
    entries: [{ track: playlistTracks[1], position: 1 }],
    skipped: 0,
  }),
  "GET /health": () => ({ ok: true }),
  "GET /api/history": () => ({ batches: historyBatches }),
  "GET /api/playback": () => {
    const { id, name, artists, durationMs } = playbackQueue[playbackIndex];
    return { playback: {
      device: { id: "demoSpeaker", name: "示範喇叭", supportsVolume: true, volumePercent },
      item: { id, name, artists, durationMs },
      isPlaying: playingSince > 0,
      positionMs: positionMs(),
      canPause: true, canResume: true, canSeek: true,
      canSkipPrevious: playbackIndex > 0, canSkipNext: playbackIndex < playbackQueue.length - 1,
    } };
  },
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const key = `${req.method} ${url.pathname}`;
  res.setHeader("Content-Type", "application/json");

  if (routes[key]) return res.end(JSON.stringify(routes[key]()));

  if (url.pathname === "/api/search")
    return res.end(JSON.stringify({ results: [
      { id: "r1", name: "她說", artists: ["林俊傑"], isrc: null, album: "她說", durationMs: 254000 },
      { id: "r2", name: "她說 (Live)", artists: ["林俊傑"], isrc: null, album: "演唱會實況", durationMs: 271000 },
    ] }));

  if (req.method === "POST" && url.pathname === "/api/tracks/delete") {
    const body = await readBody(req);
    const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
    const removed = tracks.filter(({ id }) => ids.has(id));

    for (let i = tracks.length - 1; i >= 0; i--) {
      if (ids.has(tracks[i].id)) tracks.splice(i, 1);
    }
    if (removed.length > 0) {
      historyBatches.unshift(historyBatch(`h${Date.now()}`, "delete", new Date().toISOString(), removed));
    }
    return res.end(JSON.stringify({ deleted: removed.length }));
  }

  if (key === "POST /api/playback") {
    const command = await readBody(req);
    switch (command.action) {
      case "pause":
        playbackPosition = positionMs();
        playingSince = 0;
        break;
      case "resume":
        if (!playingSince) playingSince = Date.now();
        break;
      case "previous":
      case "next":
        playbackIndex = Math.max(0, Math.min(playbackQueue.length - 1,
          playbackIndex + (command.action === "next" ? 1 : -1)));
        playbackPosition = 0;
        playingSince = Date.now();
        break;
      case "volume":
        volumePercent = command.volumePercent;
        break;
      case "seek":
        playbackPosition = command.positionMs;
        if (playingSince) playingSince = Date.now();
        break;
    }
    return res.end(JSON.stringify({ ok: true }));
  }

  if (key === "POST /api/play") {
    const { id } = await readBody(req);
    const index = playbackQueue.findIndex((track) => track.id === id);
    if (index === -1) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "找不到曲目" }));
    }
    playbackIndex = index;
    playbackPosition = 0;
    playingSince = Date.now();
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === "POST") return res.end(JSON.stringify({ ok: true, deleted: 0, added: 0 }));
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
}).listen(PORT, "127.0.0.1", () => console.log(`mock backend on http://127.0.0.1:${PORT}`));

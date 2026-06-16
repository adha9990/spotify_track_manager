import { type ChildProcess, fork } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import { storeRefreshToken } from "./auth";

let child: ChildProcess | null = null;

function serverPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "backend", "server.cjs")
    : path.join(__dirname, "../../backend/dist/server.cjs");
}

export function startBackend(clientId: string, refreshToken: string, port: number): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPOTIFY_CLIENT_ID: clientId,
    SPOTIFY_REFRESH_TOKEN: refreshToken,
    PORT: String(port),
    STM_DB_PATH: path.join(app.getPath("userData"), "stm_history.db"),
  };
  const options = app.isPackaged
    ? { env: { ...env, ELECTRON_RUN_AS_NODE: "1" } }
    : { env, execPath: process.env.npm_node_execpath || "node" };

  // Keep an IPC channel (4th stdio slot) so the backend can hand back a rotated
  // refresh token; windowsHide stops the dev system-Node spawning a console window.
  // windowsHide is a valid spawn option that Node passes through fork internally,
  // but is missing from @types/node's ForkOptions — cast to satisfy tsc.
  child = fork(serverPath(), [], {
    ...options,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    windowsHide: true,
  } as unknown as Parameters<typeof fork>[2]);
  child.on("message", (msg: { type?: string; value?: string }) => {
    if (msg?.type === "refresh_token" && msg.value) storeRefreshToken(msg.value);
  });
}

export function stopBackend(): Promise<void> {
  const c = child;
  child = null;
  if (!c) return Promise.resolve();
  // Wait for the process to actually exit so a restart (relogin) can rebind the
  // same port cleanly instead of racing the old process's socket release.
  return new Promise((resolve) => {
    c.once("exit", () => resolve());
    c.kill();
  });
}

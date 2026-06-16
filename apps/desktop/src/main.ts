import path from "node:path";
import { app, BrowserWindow, Menu } from "electron";
import { clientId, clearTokens, ensureRefreshToken } from "./auth";
import { startBackend, stopBackend } from "./backend";

const DEV_URL = "http://localhost:5173";
const PORT = 8765;
const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: "#f6f1e7",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  if (isDev) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(process.resourcesPath, "frontend", "index.html"));
}

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "帳號",
        submenu: [{ label: "重新登入 / 切換帳號", click: () => void relogin() }],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

async function relogin(): Promise<void> {
  try {
    await stopBackend();
    clearTokens();
    const refreshToken = await ensureRefreshToken(); // opens the OAuth login window
    startBackend(clientId(), refreshToken, PORT);
    mainWindow?.webContents.reload();
  } catch (err) {
    console.error("relogin failed:", err);
  }
}

void app.whenReady().then(async () => {
  try {
    const refreshToken = await ensureRefreshToken(); // OAuth login if no stored token
    startBackend(clientId(), refreshToken, PORT);
  } catch (err) {
    console.error("login/backend startup failed:", err);
    app.quit();
    return;
  }
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void stopBackend();
  if (process.platform !== "darwin") app.quit();
});

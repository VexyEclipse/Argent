// Argent desktop shell. A thin Electron wrapper around the built web app: it serves
// dist/ over a private app:// scheme (so client-side routes and absolute asset paths
// work), keeps a dark integrated title bar, and opens outside links in the browser.
// All media, auth and playback still go to the user's Jellyfin server.

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, screen, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const settings = require("./settings.cjs");
const updater = require("./updater.cjs");
const tray = require("./tray.cjs");
const mpv = require("./mpv.cjs");

// `npm run desktop:dev` loads the Vite dev server instead of the built files.
const DEV_URL = process.argv.includes("--dev") ? process.env.ARGENT_DEV_URL || "http://localhost:5173" : null;
const DIST = path.join(__dirname, "..", "dist");
const SCHEME = "app";
const ORIGIN = `${SCHEME}://argent`;

// Must happen before the app is ready: a standard, secure scheme gets a real origin,
// localStorage, fetch and media like an https page would.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// Chromium hands video to Windows' compositor as a separate layer, which keeps the old
// size for a few seconds after the window resizes: entering or leaving full screen
// showed the picture stretched. Drawing video with the rest of the page avoids it.
app.commandLine.appendSwitch("disable-direct-composition");

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("com.vexyeclipse.argent");

// ---- window bounds ------------------------------------------------------------------

const boundsFile = () => path.join(app.getPath("userData"), "window-state.json");

function readBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
    // Only restore onto a display that still exists.
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
    });
    return visible ? saved : null;
  } catch {
    return null;
  }
}

function saveBounds(win) {
  try {
    const state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    fs.writeFileSync(boundsFile(), JSON.stringify(state));
  } catch {
    /* not fatal */
  }
}

// ---- app:// serving -------------------------------------------------------------------

function serveDist() {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    // Never serve outside dist/. Unknown paths are client-side routes: hand back index.html.
    const inside = file.startsWith(DIST + path.sep);
    const target = inside && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, "index.html");
    return net.fetch(pathToFileURL(target).toString());
  });
}

// ---- now playing, tray --------------------------------------------------------------------

const ICON = path.join(__dirname, "..", "build", "icon.png");
let nowPlaying = null;
let quitting = false;

function refreshTray() {
  tray.update({
    icon: ICON,
    nowPlaying,
    onShow: showWindow,
    onCommand: (command) => mainWindow?.webContents.send("player:command", command),
    onCheckUpdates: () => {
      showWindow();
      updater.check();
    },
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  });
}

function showWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function appInfo() {
  return {
    version: app.getVersion(),
    settings: settings.read(),
    update: updater.status(),
    mpv: (await mpv.findMpv(settings.read().mpvPath)) || null,
  };
}

ipcMain.handle("app:info", appInfo);

ipcMain.handle("settings:set", (_e, key, value) => {
  const next = settings.set(key, value);
  if (key === "autoUpdate") updater.setEnabled(next.autoUpdate);
  return next;
});

ipcMain.handle("app:show", () => showWindow());
// Admin "Download": save the original file via the normal Save dialog. Only http(s) URLs,
// and only when asked by Argent's own window.
ipcMain.handle("download", (e, url) => {
  if (!mainWindow || e.sender !== mainWindow.webContents || typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
  mainWindow.webContents.downloadURL(url);
});
ipcMain.handle("update:check", () => updater.check());

// "Show in File Explorer" (administrators' menu): a file is shown selected in its folder, a
// folder is opened. Nothing is ever opened with its program, so no file can be run this
// way. The path is the server's; it only works when the server is on this computer.
ipcMain.handle("file:show", (e, target) => {
  if (!mainWindow || e.sender !== mainWindow.webContents || typeof target !== "string" || !path.isAbsolute(target)) return "invalid";
  try {
    if (fs.existsSync(target)) {
      if (fs.statSync(target).isDirectory()) shell.openPath(target);
      else shell.showItemInFolder(target);
      return "shown";
    }
    // The file has gone, but its folder may still be there.
    const folder = path.dirname(target);
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
      shell.openPath(folder);
      return "folder";
    }
  } catch {
    /* unreadable: treated as missing */
  }
  return "missing";
});

// ---- mpv ----------------------------------------------------------------------------------

ipcMain.handle("mpv:play", async (e, request) => {
  if (!mainWindow || e.sender !== mainWindow.webContents || !request || typeof request.url !== "string" || !/^https?:\/\//i.test(request.url)) {
    return { reason: "error", error: "Invalid request", position: 0, paused: false, interacted: false };
  }
  const exe = await mpv.findMpv(settings.read().mpvPath);
  if (!exe) return { reason: "error", error: "mpv isn't installed", position: request.startSeconds || 0, paused: false, interacted: false };
  const result = await mpv.play(exe, request, (state) => mainWindow?.webContents.send("mpv:state", state));
  // Back to Argent when mpv closes.
  showWindow();
  return result;
});
ipcMain.on("mpv:control", (_e, command) => mpv.control(command));
ipcMain.handle("mpv:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose mpv",
    properties: ["openFile"],
    filters: [{ name: "mpv", extensions: process.platform === "win32" ? ["exe"] : ["*"] }],
  });
  if (!result.canceled && result.filePaths[0]) settings.set("mpvPath", result.filePaths[0]);
  return appInfo();
});
ipcMain.handle("update:install", () => {
  quitting = true;
  updater.install();
});

ipcMain.on("now-playing", (_e, info) => {
  nowPlaying = info && typeof info.title === "string" ? info : null;
  refreshTray();
});

// ---- window ---------------------------------------------------------------------------

let mainWindow = null;

function createWindow() {
  const saved = readBounds();
  const win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 960,
    minHeight: 600,
    title: "Argent",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: "#09090a",
    show: false,
    // Native window buttons drawn over the app's own dark top bar.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: "#d2d5da", height: 40 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  if (saved?.maximized) win.maximize();

  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    saveBounds(win);
    // "Close to tray": keep running in the tray, with playback paused.
    if (!quitting && settings.read().closeToTray) {
      e.preventDefault();
      win.webContents.send("player:command", "pause");
      win.hide();
    }
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Keep the page title fixed to the product name.
  win.on("page-title-updated", (e) => e.preventDefault());

  // Links meant for a browser (server dashboard, IMDb…) open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // F11 full screen; Ctrl+Shift+I developer tools; Ctrl+R reload.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.control && input.shift && input.key.toLowerCase() === "i") {
      win.webContents.toggleDevTools();
      e.preventDefault();
    } else if (input.control && !input.shift && input.key.toLowerCase() === "r") {
      win.webContents.reload();
      e.preventDefault();
    }
  });

  win.loadURL(DEV_URL || `${ORIGIN}/`);
}

app.on("second-instance", showWindow);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (!DEV_URL) serveDist();
  createWindow();
  refreshTray();
  updater.start(settings.read().autoUpdate, (status) => mainWindow?.webContents.send("update:status", status));
});

app.on("before-quit", () => {
  quitting = true;
  mpv.stop();
});

app.on("window-all-closed", () => app.quit());

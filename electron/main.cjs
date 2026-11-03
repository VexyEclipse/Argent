// Argent desktop shell. A thin Electron wrapper around the built web app: it serves
// dist/ over a private app:// scheme (so client-side routes and absolute asset paths
// work), keeps a dark integrated title bar, and opens outside links in the browser.
// All media, auth and playback still go to the user's Jellyfin server.

const { app, BrowserWindow, Menu, net, protocol, screen, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  if (saved?.maximized) win.maximize();

  win.once("ready-to-show", () => win.show());
  win.on("close", () => saveBounds(win));

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

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (!DEV_URL) serveDist();
  createWindow();
});

app.on("window-all-closed", () => app.quit());

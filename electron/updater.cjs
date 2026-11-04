// Automatic updates from the project's GitHub releases (electron-updater reads the
// latest.yml that `npm run desktop:release` publishes). Only active in an installed build.

const { app } = require("electron");

const CHECK_EVERY_MS = 6 * 60 * 60_000;

let status = { state: "idle" };
let listener = () => {};
let updater = null;
let timer = null;

function emit(next) {
  status = next;
  listener(status);
}

function load() {
  if (updater || !app.isPackaged) return updater;
  try {
    ({ autoUpdater: updater } = require("electron-updater"));
  } catch {
    return null;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("checking-for-update", () => emit({ state: "checking" }));
  updater.on("update-available", (info) => emit({ state: "downloading", version: info.version, percent: 0 }));
  updater.on("update-not-available", () => emit({ state: "current", checkedAt: Date.now() }));
  updater.on("download-progress", (p) => emit({ ...status, state: "downloading", percent: Math.round(p.percent) }));
  updater.on("update-downloaded", (info) => emit({ state: "ready", version: info.version }));
  updater.on("error", (err) => emit({ state: "error", message: String(err?.message || err).split("\n")[0] }));
  return updater;
}

function check() {
  const u = load();
  if (!u) {
    emit({ state: "unsupported" });
    return;
  }
  u.checkForUpdates().catch(() => {
    /* reported through the error event */
  });
}

module.exports = {
  /** Starts background checks when enabled; `onStatus` hears every change. */
  start(enabled, onStatus) {
    listener = onStatus;
    clearInterval(timer);
    if (!app.isPackaged) {
      status = { state: "unsupported" };
      return;
    }
    if (!enabled) return;
    setTimeout(check, 10_000);
    timer = setInterval(check, CHECK_EVERY_MS);
  },
  setEnabled(enabled) {
    clearInterval(timer);
    timer = null;
    if (enabled && app.isPackaged) {
      check();
      timer = setInterval(check, CHECK_EVERY_MS);
    }
  },
  check,
  status: () => status,
  install() {
    if (status.state === "ready") load()?.quitAndInstall(false, true);
  },
};

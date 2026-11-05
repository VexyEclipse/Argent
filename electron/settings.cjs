// Desktop-only preferences, kept in the app's user data folder (not per Jellyfin user:
// they're about this computer).

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const DEFAULTS = {
  /** Closing the window keeps Argent running in the system tray. */
  closeToTray: false,
  /** Download updates in the background and install them on quit. */
  autoUpdate: true,
  /** Play in mpv (when it's installed) instead of the app's own player. */
  useMpv: false,
  /** mpv.exe chosen by hand; empty to look in the usual places. */
  mpvPath: "",
};

const file = () => path.join(app.getPath("userData"), "settings.json");

let current = null;

function read() {
  if (current) return current;
  try {
    current = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), "utf8")) };
  } catch {
    current = { ...DEFAULTS };
  }
  return current;
}

function set(key, value) {
  if (!(key in DEFAULTS) || typeof value !== typeof DEFAULTS[key]) return read();
  current = { ...read(), [key]: value };
  try {
    fs.writeFileSync(file(), JSON.stringify(current, null, 2));
  } catch {
    /* not fatal */
  }
  return current;
}

module.exports = { read, set };

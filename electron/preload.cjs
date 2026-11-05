// The bridge between the web app and the desktop shell. The page gets a small, fixed
// API on window.argentDesktop and never touches Electron or Node directly.

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, fn) {
  const handler = (_event, value) => fn(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("argentDesktop", {
  /** { version, settings, update } */
  getInfo: () => ipcRenderer.invoke("app:info"),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (fn) => subscribe("update:status", fn),
  /** Brings the window forward (e.g. when a notification is clicked). */
  showWindow: () => ipcRenderer.invoke("app:show"),
  /** Saves a file from the server through the Save dialog. */
  download: (url) => ipcRenderer.invoke("download", url),
  /** What's playing, for the tray; null when playback ends. */
  setNowPlaying: (info) => ipcRenderer.send("now-playing", info),
  /** "toggle" | "pause" | "next" | "previous", from the tray menu and window. */
  onPlayerCommand: (fn) => subscribe("player:command", fn),
  /** Plays in mpv; resolves with the result when mpv closes. */
  playExternal: (request) => ipcRenderer.invoke("mpv:play", request),
  /** mpv's position, pause and track changes while it plays. */
  onExternalState: (fn) => subscribe("mpv:state", fn),
  /** Remote control, tray and Stop for mpv. */
  controlExternal: (command) => ipcRenderer.send("mpv:control", command),
  /** Lets the viewer pick mpv.exe; resolves to the app info. */
  chooseMpv: () => ipcRenderer.invoke("mpv:choose"),
});

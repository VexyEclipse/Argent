// System tray icon: what's playing, playback controls, and a way back to the window
// when "close to tray" is on.

const { Menu, Tray, nativeImage } = require("electron");

let tray = null;

/**
 * @param {{ icon: string, nowPlaying: object | null, onShow: () => void, onCommand: (c: string) => void,
 *           onCheckUpdates: () => void, onQuit: () => void }} opts
 */
function update(opts) {
  if (!tray) {
    const image = nativeImage.createFromPath(opts.icon).resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.on("click", opts.onShow);
  }
  const np = opts.nowPlaying;
  const playing = np ? [np.title, np.subtitle].filter(Boolean).join(" — ") : "";
  tray.setToolTip(np ? `Argent · ${np.paused ? "Paused" : "Playing"}: ${playing}`.slice(0, 127) : "Argent");
  const template = [];
  if (np) {
    template.push(
      { label: playing.length > 60 ? `${playing.slice(0, 59)}…` : playing, enabled: false },
      { label: np.paused ? "Play" : "Pause", click: () => opts.onCommand("toggle") },
    );
    if (np.hasPrevious) template.push({ label: "Previous episode", click: () => opts.onCommand("previous") });
    if (np.hasNext) template.push({ label: "Next episode", click: () => opts.onCommand("next") });
    template.push({ type: "separator" });
  }
  template.push(
    { label: "Show Argent", click: opts.onShow },
    { label: "Check for updates", click: opts.onCheckUpdates },
    { type: "separator" },
    { label: "Quit Argent", click: opts.onQuit },
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

module.exports = { update };

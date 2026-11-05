// Playback in mpv (mpv.io), for viewers who have it: every codec, HDR, surround
// passthrough and subtitle format plays directly. Argent starts mpv with the stream,
// follows it over mpv's JSON IPC (a named pipe on Windows) and reports its state to the
// page, which keeps the server's progress, Up Next and the rating prompt as usual.

const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

/** Where mpv usually lives on Windows, besides PATH. */
function candidates() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  return [
    path.join(local, "Programs", "mpv", "mpv.exe"),
    path.join(local, "Microsoft", "WinGet", "Links", "mpv.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "mpv", "mpv.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "mpv", "mpv.exe"),
    path.join(home, "scoop", "apps", "mpv", "current", "mpv.exe"),
    path.join(home, "scoop", "shims", "mpv.exe"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "chocolatey", "bin", "mpv.exe"),
  ];
}

function onPath() {
  return new Promise((resolve) => {
    execFile(process.platform === "win32" ? "where" : "which", ["mpv"], { windowsHide: true }, (err, stdout) => {
      const first = String(stdout || "").split(/\r?\n/).find(Boolean);
      resolve(!err && first && fs.existsSync(first) ? first : null);
    });
  });
}

/** The mpv to use: the one chosen in Settings if it exists, else the first found. */
async function findMpv(chosen) {
  if (chosen && fs.existsSync(chosen)) return chosen;
  return candidates().find((p) => fs.existsSync(p)) || (await onPath());
}

let current = null;

/**
 * Dialogue boost (voice band up, rumble down) and volume levelling (ffmpeg's dynamic
 * normaliser), with a limiter so the boosts don't clip. Empty when neither is on.
 */
function soundFilters(sound) {
  if (!sound || (!sound.dialogue && !sound.level)) return "";
  const chain = [];
  if (sound.dialogue) chain.push("equalizer=f=200:t=h:w=200:g=-5", "equalizer=f=2400:t=q:w=0.8:g=6", "highshelf=f=9000:g=-2");
  if (sound.level) chain.push("dynaudnorm=f=250:g=15:p=0.9");
  chain.push("alimiter=limit=0.95");
  return chain.join(",");
}

/**
 * Plays `request` (see src/features/player/externalPlan.ts) and resolves with the
 * result when mpv exits. `onState` hears position, pause and track changes.
 */
function play(mpvPath, request, onState) {
  stop();
  const pipe = process.platform === "win32" ? `\\\\.\\pipe\\argent-mpv-${process.pid}-${Date.now()}` : path.join(os.tmpdir(), `argent-mpv-${process.pid}-${Date.now()}.sock`);
  const args = [
    request.url,
    `--input-ipc-server=${pipe}`,
    `--force-media-title=${[request.title, request.subtitle].filter(Boolean).join(" — ")}`,
    `--start=${Math.max(0, Math.floor(request.startSeconds || 0))}`,
    "--fullscreen",
    "--keep-open=no",
    "--idle=no",
    "--force-window=immediate",
    // Sidecar subtitle files come from the server, which needs the token in the URL.
    ...(request.subtitles || []).map((s) => `--sub-file=${s.url}`),
  ];
  if (request.method !== "Transcode" && request.audio) args.push(`--aid=${request.audio.ordinal + 1}`);
  const af = soundFilters(request.sound);
  if (af) args.push(`--af=lavfi=[${af}]`);
  const choice = request.subtitleChoice || { kind: "off" };
  if (choice.kind === "off") args.push("--sid=no");
  else if (choice.kind === "embedded") args.push(`--sid=${choice.ordinal + 1}`);
  else if (choice.kind === "external") {
    // External files are added after the embedded tracks; mpv numbers them in order.
    const embeddedCount = request.embeddedSubtitleCount || 0;
    const i = (request.subtitles || []).findIndex((s) => s.index === choice.index);
    if (i >= 0) args.push(`--sid=${embeddedCount + i + 1}`);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const state = { position: request.startSeconds || 0, paused: false, eof: false, interacted: false, audioOrdinal: undefined, subtitleOrdinal: undefined, externalSubtitle: undefined };
    let child;
    try {
      child = spawn(mpvPath, args, { windowsHide: false, stdio: "ignore" });
    } catch (e) {
      resolve({ ...state, reason: "error", error: String(e && e.message ? e.message : e) });
      return;
    }
    let socket = null;
    let lastSent = 0;
    let buffer = "";
    let commandId = 100;
    const session = {
      child,
      send(command) {
        if (socket && !socket.destroyed) socket.write(JSON.stringify({ command, request_id: commandId++ }) + "\n");
      },
      reason: null,
    };
    current = session;

    const emit = (force) => {
      const now = Date.now();
      if (!force && now - lastSent < 1000) return;
      lastSent = now;
      onState({
        position: state.position,
        paused: state.paused,
        audioOrdinal: state.audioOrdinal,
        subtitleOrdinal: state.subtitleOrdinal,
        externalSubtitle: state.externalSubtitle,
      });
    };

    const connect = (attempt = 0) => {
      if (child.exitCode !== null) return;
      const s = net.connect(pipe);
      s.on("connect", () => {
        socket = s;
        const observe = ["time-pos", "pause", "eof-reached", "aid", "sid"];
        observe.forEach((name, i) => session.send(["observe_property", i + 1, name]));
      });
      s.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.event === "property-change") {
            if (msg.name === "time-pos" && typeof msg.data === "number") {
              state.position = msg.data;
              emit(false);
            } else if (msg.name === "pause") {
              state.paused = Boolean(msg.data);
              emit(true);
            } else if (msg.name === "eof-reached") state.eof = Boolean(msg.data);
            else if (msg.name === "aid") state.audioOrdinal = typeof msg.data === "number" ? msg.data - 1 : undefined;
            else if (msg.name === "sid") {
              const ordinal = typeof msg.data === "number" ? msg.data - 1 : -1;
              const sidecar = (request.subtitles || [])[ordinal - (request.embeddedSubtitleCount || 0)];
              state.subtitleOrdinal = sidecar ? undefined : ordinal;
              state.externalSubtitle = sidecar ? sidecar.index : undefined;
              emit(true);
            }
          } else if (msg.event === "seek" && Date.now() - startedAt > 5000) {
            // The jump to the resume point doesn't count; a seek later on means someone's there.
            state.interacted = true;
          } else if (msg.event === "end-file" && msg.reason === "eof") {
            state.eof = true;
          }
        }
      });
      s.on("error", () => {
        // mpv creates the pipe a moment after it starts.
        if (!socket && attempt < 50) setTimeout(() => connect(attempt + 1), 100);
      });
    };
    setTimeout(() => connect(), 150);

    child.on("error", (e) => {
      if (current === session) current = null;
      resolve({ ...state, reason: "error", error: e.message });
    });
    child.on("exit", (code) => {
      if (current === session) current = null;
      socket?.destroy();
      const nearEnd = request.durationSeconds > 0 && state.position >= request.durationSeconds - 3;
      const reason = session.reason || (state.eof || nearEnd ? "ended" : code && code !== 0 && code !== 4 ? "error" : "stopped");
      resolve({ ...state, reason, error: reason === "error" ? `mpv exited with code ${code}` : undefined });
    });
  });
}

/** Commands from the page (remote control, the tray, Stop). */
function control(command) {
  const s = current;
  if (!s || !command || typeof command.kind !== "string") return;
  switch (command.kind) {
    case "toggle":
      s.send(["cycle", "pause"]);
      break;
    case "pause":
      s.send(["set_property", "pause", true]);
      break;
    case "unpause":
      s.send(["set_property", "pause", false]);
      break;
    case "seek":
      if (Number.isFinite(command.seconds)) s.send(["seek", command.seconds, "absolute"]);
      break;
    case "seekBy":
      if (Number.isFinite(command.seconds)) s.send(["seek", command.seconds, "relative"]);
      break;
    case "volume":
      if (Number.isFinite(command.value)) s.send(["set_property", "volume", Math.round(command.value * 100)]);
      break;
    case "mute":
      s.send(typeof command.muted === "boolean" ? ["set_property", "mute", command.muted] : ["cycle", "mute"]);
      break;
    case "next":
    case "previous":
      s.reason = command.kind;
      s.send(["quit"]);
      break;
    case "stop":
      s.reason = "stopped";
      s.send(["quit"]);
      // If the pipe never connected, end the process itself.
      setTimeout(() => s.child.exitCode === null && s.child.kill(), 1500);
      break;
  }
}

function stop() {
  if (current) control({ kind: "stop" });
}

module.exports = { findMpv, play, control, stop };

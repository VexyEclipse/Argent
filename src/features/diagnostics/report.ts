// "Copy diagnostics": a plain-text report for bug reports. It says what this device is,
// what it can decode, how the server and app are set up, and what happened recently.
// No passwords, tokens, user names or titles' file paths.

import { APP_VERSION } from "@/api/client";
import { client, getPublicInfo } from "@/api/jellyfin";
import { socketIsOpen } from "@/api/socket";
import { capabilities } from "@/features/player/deviceProfile";
import { readEngine, readQuality } from "@/features/player/prefs";
import { getTogether } from "@/features/together/store";
import { androidApp, nativeCapabilities } from "@/platform/android";
import { desktop } from "@/platform/desktop";
import { recentEvents, redact } from "./log";

const yesNo = (o: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([, v]) => typeof v === "boolean")
    .map(([k, v]) => `${k}${v ? "" : "✗"}`)
    .join(" ");

function shell(): string {
  if (androidApp) return `Android app ${androidApp.version?.() ?? "(before 0.7)"}`;
  if (desktop) return "Windows desktop app";
  return "web browser";
}

export async function buildDiagnostics(): Promise<string> {
  const lines: string[] = [];
  const add = (k: string, v: unknown) => v !== undefined && v !== null && v !== "" && lines.push(`${k}: ${v}`);
  const c = (() => {
    try {
      return client();
    } catch {
      return null;
    }
  })();

  lines.push("Argent diagnostics", `Generated ${new Date().toISOString()}`, "");
  add("Argent", APP_VERSION);
  add("Shell", shell());
  add("Interface", document.documentElement.dataset.platform);
  add("User agent", navigator.userAgent);
  add("Screen", `${screen.width}×${screen.height} @${window.devicePixelRatio}x, window ${innerWidth}×${innerHeight}`);
  add("Language", navigator.language);
  add("Online", navigator.onLine);

  lines.push("", "[Server]");
  if (c) {
    add("Address", c.serverUrl);
    try {
      const info = await getPublicInfo(c, AbortSignal.timeout(4000));
      add("Server", `${info.ServerName ?? ""} ${info.Version ?? ""}`.trim());
    } catch (e) {
      add("Server", `unreachable (${e instanceof Error ? e.message : e})`);
    }
    add("Device id", c.deviceId);
    add("Live connection", socketIsOpen() ? "open" : "closed");
  } else add("Address", "not signed in");

  lines.push("", "[Playback]");
  const cap = readQuality(0);
  add("Quality cap", cap && cap < 120_000_000 ? `${(cap / 1_000_000).toFixed(1)} Mbps` : "Auto");
  const caps = capabilities();
  add("Page decodes (MSE)", yesNo(caps as unknown as Record<string, unknown>));
  add("Page decodes (file)", yesNo(caps.file as unknown as Record<string, unknown>));
  const native = nativeCapabilities();
  if (native) {
    add("Player", readEngine() === "web" ? "page player (native switched off)" : "native (Media3)");
    add("Device", `${native.model}, Android SDK ${native.sdk}${native.tv ? ", TV" : ""}`);
    add("Native video", yesNo(native.video));
    add("Native HDR", yesNo(native.hdr));
    add("Native audio", yesNo(native.audio));
    add("Passthrough", `${yesNo(native.passthrough)}, up to ${native.maxChannels} channels`);
    add("Display", `${native.display.width}×${native.display.height}, refresh ${native.display.refreshRates.join("/")} Hz`);
  }
  if (desktop) {
    try {
      const info = await desktop.getInfo();
      add("Desktop app", info.version);
      add("Updates", info.update.state);
      add("mpv", info.settings.useMpv ? (info.mpv ?? "enabled, not found") : "off");
    } catch {
      /* ignore */
    }
  }

  const t = getTogether();
  if (t.group || t.target) {
    lines.push("", "[Together]");
    add("Group", t.group ? `${t.group.State}, ${t.group.Participants.length} people` : undefined);
    add("Clock offset", t.group ? `${Math.round(t.offsetMs)} ms (round trip ${Math.round(t.rttMs)} ms)` : undefined);
    add("Play on", t.target ? `${t.target.DeviceName} (${t.target.Client})` : undefined);
  }

  lines.push("", "[Recent events]");
  const events = recentEvents();
  if (!events.length) lines.push("(none)");
  for (const e of events) lines.push(`${new Date(e.at).toISOString().slice(11, 19)} ${e.level.toUpperCase().padEnd(5)} ${e.area}: ${e.message}`);
  return redact(lines.join("\n"));
}

/** Clipboard where it works; a selected textarea where it doesn't (older WebViews, http pages). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      /* ignore */
    }
    area.remove();
    return ok;
  }
}

/** Saves the report as a text file (TVs have no clipboard to paste from). */
export function saveText(text: string, name = `argent-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

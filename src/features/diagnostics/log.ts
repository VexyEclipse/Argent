// A short in-memory history of what happened on this device: playback decisions,
// fallbacks and errors. It goes into the diagnostics report (Profile → Settings → Help),
// so a bug report from a TV says what the player actually did. Never holds tokens.

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  at: number;
  level: LogLevel;
  area: string;
  message: string;
}

const MAX = 80;
const entries: LogEntry[] = [];

/** Strip access tokens from anything that might carry a URL. */
export function redact(text: string): string {
  return text.replace(/([?&](?:api_?key|ApiKey|X-Emby-Token|Token)=)[^&\s"]+/gi, "$1…").replace(/(Token=")[^"]+"/g, '$1…"');
}

export function logEvent(area: string, message: string, level: LogLevel = "info") {
  entries.push({ at: Date.now(), level, area, message: redact(message).slice(0, 500) });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  if (import.meta.env?.DEV && level !== "info") console.warn(`[${area}] ${message}`);
}

export function recentEvents(): readonly LogEntry[] {
  return entries;
}

let installed = false;

/** Uncaught errors and rejected promises are logged too. */
export function installErrorLogging() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => logEvent("app", e.message || String(e.error), "error"));
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    // Aborted requests are routine (a query superseded by navigation).
    if (!/abort/i.test(reason)) logEvent("app", `Unhandled: ${reason}`, "error");
  });
}

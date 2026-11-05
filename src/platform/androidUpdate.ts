// Updates for the Android app. The page checks the project's GitHub releases for a newer
// APK; the app downloads it and hands it to Android's installer, which asks the viewer to
// confirm (Android never installs an app silently). Same releases as the desktop app.

import { useEffect, useSyncExternalStore } from "react";
import { logEvent } from "@/features/diagnostics/log";
import { androidApp, onNativeEvent } from "./android";
import { apkOf, isNewer } from "./releases";

const RELEASES = "https://api.github.com/repos/VexyEclipse/Argent/releases/latest";
const CHECKED_KEY = "argent.android.updateCheckedAt";
const AUTO_KEY = "argent.android.autoUpdate";
const CHECK_EVERY_MS = 6 * 60 * 60_000;

export type AndroidUpdateStatus =
  | { state: "idle" | "checking" | "unsupported" }
  | { state: "current"; checkedAt: number }
  | { state: "available"; version: string; url: string }
  | { state: "downloading"; version: string; percent: number }
  /** Android's own "Install?" screen is up. */
  | { state: "installing"; version: string }
  /** The viewer has to allow Argent to install apps (Settings has been opened). */
  | { state: "permission"; version: string; url: string }
  | { state: "error"; message: string };

let status: AndroidUpdateStatus = androidApp?.installUpdate ? { state: "idle" } : { state: "unsupported" };
/** The newer APK found by the last check. */
let pending: { version: string; url: string } | null = null;
const listeners = new Set<() => void>();
const set = (s: AndroidUpdateStatus) => {
  status = s;
  listeners.forEach((fn) => fn());
};

export const appVersion = () => androidApp?.version?.() ?? null;

export async function checkAndroidUpdate(): Promise<void> {
  const current = appVersion();
  if (!androidApp?.installUpdate || !current) return set({ state: "unsupported" });
  set({ state: "checking" });
  try {
    const res = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const apk = apkOf(await res.json());
    try {
      localStorage.setItem(CHECKED_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    if (apk && isNewer(apk.version, current)) {
      logEvent("update", `Android ${apk.version} available (have ${current})`);
      pending = apk;
      set({ state: "available", ...apk });
    } else set({ state: "current", checkedAt: Date.now() });
  } catch (e) {
    set({ state: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

export function installAndroidUpdate() {
  if (!pending) return;
  set({ state: "downloading", version: pending.version, percent: 0 });
  androidApp?.installUpdate?.(pending.url, pending.version);
}

interface UpdateEvent {
  type: "update";
  state: "downloading" | "installing" | "permission" | "error" | "cancelled";
  percent?: number;
  message?: string;
}

let wired = false;
function wire() {
  if (wired || !androidApp) return;
  wired = true;
  onNativeEvent<UpdateEvent>((e) => {
    if (e.type !== "update" || !pending) return;
    const { version, url } = pending;
    if (e.state === "downloading") set({ state: "downloading", version, percent: e.percent ?? 0 });
    else if (e.state === "installing") set({ state: "installing", version });
    else if (e.state === "permission") set({ state: "permission", version, url });
    else if (e.state === "cancelled") set({ state: "available", version, url });
    else {
      logEvent("update", `Android update failed: ${e.message}`, "error");
      set({ state: "error", message: e.message ?? "The update couldn't be installed." });
    }
  });
}

export function readAutoUpdate(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setAutoUpdate(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, String(on));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useAndroidUpdate(): AndroidUpdateStatus {
  const s = useSyncExternalStore(subscribe, () => status);
  useEffect(wire, []);
  return s;
}

/** Checks in the background at most every six hours, when automatic updates are on. */
export function useAndroidUpdateCheck() {
  useEffect(() => {
    if (!androidApp?.installUpdate || !readAutoUpdate()) return;
    wire();
    let last = 0;
    try {
      last = Number(localStorage.getItem(CHECKED_KEY)) || 0;
    } catch {
      /* ignore */
    }
    const run = () => status.state === "idle" || status.state === "current" || status.state === "error" ? checkAndroidUpdate() : undefined;
    const first = window.setTimeout(run, Math.max(5_000, last + CHECK_EVERY_MS - Date.now()));
    const timer = window.setInterval(run, CHECK_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
}

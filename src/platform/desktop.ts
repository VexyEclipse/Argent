// The Argent desktop app's bridge (electron/preload.cjs). Absent in a browser, so every
// caller checks `desktop` first.

import { useEffect, useState } from "react";

export interface DesktopSettings {
  closeToTray: boolean;
  autoUpdate: boolean;
  /** Play in mpv instead of the app's own player (when mpv is installed). */
  useMpv: boolean;
  /** mpv.exe chosen by hand; empty to find it automatically. */
  mpvPath: string;
  /** Keep wide movies from stretching when full screen turns on or off. Absent before 0.8.14. */
  steadyFullscreenVideo?: boolean;
}

export type UpdateStatus =
  | { state: "idle" | "checking" | "unsupported" }
  | { state: "current"; checkedAt: number }
  | { state: "downloading"; version?: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

export interface DesktopInfo {
  version: string;
  settings: DesktopSettings;
  update: UpdateStatus;
  /** The mpv that would be used (found or chosen), or null when there is none. */
  mpv: string | null;
  /** A setting changed that only takes effect after a restart. */
  restartNeeded?: boolean;
}

export interface NowPlaying {
  title: string;
  subtitle?: string;
  paused: boolean;
  /** seconds */
  position: number;
  duration: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export type PlayerCommand = "toggle" | "pause" | "next" | "previous";

interface DesktopBridge {
  getInfo(): Promise<DesktopInfo>;
  setSetting<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]): Promise<DesktopSettings>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  /** Closes and reopens Argent. Absent before 0.8.14. */
  relaunch?(): Promise<void>;
  onUpdateStatus(fn: (status: UpdateStatus) => void): () => void;
  showWindow(): Promise<void>;
  download(url: string): Promise<void>;
  setNowPlaying(info: NowPlaying | null): void;
  onPlayerCommand(fn: (command: PlayerCommand) => void): () => void;
  /** Plays in mpv; resolves when mpv closes. Absent in desktop apps older than 0.7. */
  playExternal?(request: unknown): Promise<unknown>;
  onExternalState?(fn: (state: unknown) => void): () => void;
  controlExternal?(command: unknown): void;
  /** Lets the viewer pick mpv.exe; resolves to the new info. */
  chooseMpv?(): Promise<DesktopInfo>;
  /**
   * Shows a file selected in File Explorer, or opens a folder. "folder" when only the file's
   * folder was there, "missing" when neither is on this computer. Absent before 0.8.9.
   */
  showInFolder?(path: string): Promise<"shown" | "folder" | "missing" | "invalid">;
}

export const desktop: DesktopBridge | null = (window as unknown as { argentDesktop?: DesktopBridge }).argentDesktop ?? null;

/** Desktop app info and settings, kept current with update progress. */
export function useDesktopInfo() {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    desktop.getInfo().then((i) => live && setInfo(i));
    const off = desktop.onUpdateStatus((update) => setInfo((i) => (i ? { ...i, update } : i)));
    return () => {
      live = false;
      off();
    };
  }, []);

  const setSetting = async <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => {
    if (!desktop) return;
    setInfo((i) => (i ? { ...i, settings: { ...i.settings, [key]: value } } : i));
    await desktop.setSetting(key, value);
    // A setting can change what else the app reports (which mpv it found).
    setInfo(await desktop.getInfo());
  };
  const refresh = () => {
    desktop?.getInfo().then(setInfo);
  };

  return { info, setSetting, refresh };
}

/** The latest update status alone (for the "restart to update" prompt). */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    desktop.getInfo().then((i) => live && setStatus(i.update));
    const off = desktop.onUpdateStatus(setStatus);
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}

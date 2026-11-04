// The Argent desktop app's bridge (electron/preload.cjs). Absent in a browser, so every
// caller checks `desktop` first.

import { useEffect, useState } from "react";

export interface DesktopSettings {
  closeToTray: boolean;
  autoUpdate: boolean;
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
  onUpdateStatus(fn: (status: UpdateStatus) => void): () => void;
  showWindow(): Promise<void>;
  download(url: string): Promise<void>;
  setNowPlaying(info: NowPlaying | null): void;
  onPlayerCommand(fn: (command: PlayerCommand) => void): () => void;
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
    const settings = await desktop.setSetting(key, value);
    setInfo((i) => (i ? { ...i, settings } : i));
  };

  return { info, setSetting };
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

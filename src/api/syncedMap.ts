// A small per-user map kept in localStorage for speed and mirrored to one field of the
// user's Jellyfin DisplayPreferences, so it follows them to every device. Entries from
// other devices are merged in once per session; local entries win.

import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { client } from "./jellyfin";

const PREFS_CLIENT = "Argent";

interface DisplayPreferences {
  Id?: string;
  CustomPrefs?: Record<string, string | null>;
  [k: string]: unknown;
}

export interface SyncedMap<T> {
  read(userId: string): Record<string, T>;
  set(userId: string, key: string, value: T): void;
  remove(userId: string, key: string): void;
  /** The signed-in user's map, re-rendering when it changes. */
  use(): Record<string, T>;
}

export function createSyncedMap<T>(opts: { prefsId: string; field: string; storageKey: string; max?: number }): SyncedMap<T> {
  const key = (userId: string) => `${opts.storageKey}.${userId}`;
  const path = `/DisplayPreferences/${opts.prefsId}`;
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  const emit = () => listeners.forEach((fn) => fn());
  // useSyncExternalStore needs the same object back until something changes.
  let cache: { userId: string; raw: string | null; value: Record<string, T> } = { userId: "", raw: null, value: {} };
  let syncTimer = 0;
  const pulled = new Set<string>();

  function read(userId: string): Record<string, T> {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key(userId));
    } catch {
      /* ignore */
    }
    if (userId === cache.userId && raw === cache.raw) return cache.value;
    let value: Record<string, T> = {};
    try {
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed;
    } catch {
      /* ignore */
    }
    cache = { userId, raw, value };
    return value;
  }

  function write(userId: string, value: Record<string, T>, sync = true) {
    const keys = Object.keys(value);
    if (opts.max) for (const k of keys.slice(0, Math.max(0, keys.length - opts.max))) delete value[k];
    try {
      localStorage.setItem(key(userId), JSON.stringify(value));
    } catch {
      /* ignore */
    }
    emit();
    if (!sync) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(async () => {
      try {
        const c = client();
        const query = { userId, client: PREFS_CLIENT };
        const current = await c.request<DisplayPreferences>(path, { query });
        const body = { ...current, CustomPrefs: { ...(current?.CustomPrefs ?? {}), [opts.field]: JSON.stringify(read(userId)) } };
        await c.request<void>(path, { method: "POST", query, body });
      } catch {
        /* offline or older server: local copy still works */
      }
    }, 1500);
  }

  async function pull(userId: string) {
    if (pulled.has(userId)) return;
    pulled.add(userId);
    try {
      const prefs = await client().request<DisplayPreferences>(path, { query: { userId, client: PREFS_CLIENT } });
      const remote = JSON.parse(prefs?.CustomPrefs?.[opts.field] || "{}") as Record<string, T>;
      const local = read(userId);
      const merged = { ...remote, ...local };
      if (Object.keys(merged).length !== Object.keys(local).length) write(userId, merged, false);
    } catch {
      pulled.delete(userId);
    }
  }

  return {
    read,
    set: (userId, k, value) => write(userId, { ...read(userId), [k]: value }),
    remove: (userId, k) => {
      const next = { ...read(userId) };
      delete next[k];
      write(userId, next);
    },
    use() {
      const { user } = useAuth();
      const userId = user?.Id ?? "";
      useEffect(() => {
        if (userId) pull(userId);
      }, [userId]);
      return useSyncExternalStore(subscribe, () => read(userId));
    },
  };
}

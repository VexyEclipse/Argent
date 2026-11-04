// Your watchlist ("plan to watch"). Stored locally for speed and mirrored to the user's
// Jellyfin DisplayPreferences so it follows them across devices.

import { useEffect, useSyncExternalStore } from "react";
import { client } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { addEntry, emptyWatchlist, mergeCustomPrefs, normalise, removeEntry, toCustomPrefs, type WatchlistState } from "./logic";

const PREFS_ID = "argent-watchlist";
const PREFS_CLIENT = "Argent";

const key = (userId: string) => `argent.watchlist.${userId}`;

const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  listeners.forEach((fn) => fn());
}

// useSyncExternalStore needs the same object back until something changes.
let cache: { userId: string; raw: string | null; state: WatchlistState } = { userId: "", raw: null, state: emptyWatchlist() };

export function readWatchlist(userId: string): WatchlistState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(userId));
  } catch {
    /* ignore */
  }
  if (userId === cache.userId && raw === cache.raw) return cache.state;
  let state = emptyWatchlist();
  try {
    state = normalise(JSON.parse(raw || "null"));
  } catch {
    /* ignore */
  }
  cache = { userId, raw, state };
  return state;
}

let syncTimer = 0;

function write(userId: string, state: WatchlistState, sync = true) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(state));
  } catch {
    /* ignore */
  }
  emit();
  if (!sync) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => pushToServer(userId), 1500);
}

interface DisplayPreferences {
  Id?: string;
  CustomPrefs?: Record<string, string | null>;
  [k: string]: unknown;
}

const prefsPath = `/DisplayPreferences/${PREFS_ID}`;

async function pushToServer(userId: string) {
  try {
    const c = client();
    const query = { userId, client: PREFS_CLIENT };
    const current = await c.request<DisplayPreferences>(prefsPath, { query });
    // Fold in anything another device saved meanwhile before overwriting.
    const merged = mergeCustomPrefs(readWatchlist(userId), current?.CustomPrefs);
    write(userId, merged, false);
    const body: DisplayPreferences = { ...current, CustomPrefs: { ...(current?.CustomPrefs ?? {}), ...toCustomPrefs(merged) } };
    await c.request<void>(prefsPath, { method: "POST", query, body });
  } catch {
    /* offline or older server: local copy still works */
  }
}

const pulled = new Set<string>();

/** Merge what other devices saved into the local copy (once per session per user). */
async function pullFromServer(userId: string) {
  if (pulled.has(userId)) return;
  pulled.add(userId);
  try {
    const prefs = await client().request<DisplayPreferences>(prefsPath, { query: { userId, client: PREFS_CLIENT } });
    const local = readWatchlist(userId);
    const merged = mergeCustomPrefs(local, prefs?.CustomPrefs);
    if (JSON.stringify(merged) !== JSON.stringify(local)) write(userId, merged, false);
  } catch {
    pulled.delete(userId);
  }
}

/** Only films and shows go on the list; episodes and seasons point at their series. */
export const canWatchlist = (item: Pick<BaseItem, "Type">) => item.Type === "Movie" || item.Type === "Series";

export function addToWatchlist(userId: string, item: Pick<BaseItem, "Id" | "Name" | "Type">) {
  write(userId, addEntry(readWatchlist(userId), item.Id, { name: item.Name, type: item.Type === "Series" ? "Series" : "Movie" }));
}

export function removeFromWatchlist(userId: string, itemId: string) {
  write(userId, removeEntry(readWatchlist(userId), itemId));
}

/** The signed-in user's watchlist, re-rendering when it changes. */
export function useWatchlist(): WatchlistState {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  useEffect(() => {
    if (userId) pullFromServer(userId);
  }, [userId]);
  return useSyncExternalStore(subscribe, () => readWatchlist(userId));
}

/** Whether one title is on the list, plus a toggle for it. */
export function useWatchlistToggle(item: Pick<BaseItem, "Id" | "Name" | "Type"> | undefined) {
  const { user } = useAuth();
  const list = useWatchlist();
  const on = Boolean(item && list.items[item.Id]);
  const toggle = () => {
    if (!user || !item) return;
    if (on) removeFromWatchlist(user.Id, item.Id);
    else addToWatchlist(user.Id, item);
  };
  return { on, toggle };
}

// Pure watchlist rules: adding, removing, and merging what two devices saved.
// No DOM, no network.

export type WatchlistType = "Movie" | "Series";

export interface WatchlistEntry {
  /** ms since epoch */
  addedAt: number;
  /** Cached so the list renders a title before (or without) item metadata. */
  name: string;
  type: WatchlistType;
}

export interface WatchlistState {
  items: Record<string, WatchlistEntry>;
  /** itemId -> ms when it was taken off, so a stale device can't bring it back. */
  removed: Record<string, number>;
}

/** CustomPrefs key prefix in the user's Jellyfin DisplayPreferences. */
const ITEM = "w:";

export const emptyWatchlist = (): WatchlistState => ({ items: {}, removed: {} });

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function addEntry(state: WatchlistState, id: string, entry: Omit<WatchlistEntry, "addedAt">, now = Date.now()): WatchlistState {
  const removed = { ...state.removed };
  delete removed[id];
  return { items: { ...state.items, [id]: { ...entry, addedAt: now } }, removed };
}

export function removeEntry(state: WatchlistState, id: string, now = Date.now()): WatchlistState {
  if (!state.items[id]) return state;
  const items = { ...state.items };
  delete items[id];
  return { items, removed: { ...state.removed, [id]: now } };
}

/** Newest first. */
export function sortedIds(state: WatchlistState): string[] {
  return Object.entries(state.items)
    .sort((a, b) => b[1].addedAt - a[1].addedAt)
    .map(([id]) => id);
}

function readEntry(value: unknown): WatchlistEntry | null {
  const v = value as Partial<WatchlistEntry> | null;
  if (!v || !isNum(v.addedAt) || typeof v.name !== "string" || !v.name) return null;
  return { addedAt: v.addedAt, name: v.name, type: v.type === "Series" ? "Series" : "Movie" };
}

/** Accepts whatever localStorage held, dropping anything malformed. */
export function normalise(raw: unknown): WatchlistState {
  const out = emptyWatchlist();
  const r = raw as Partial<WatchlistState> | null;
  for (const [id, value] of Object.entries(r?.items ?? {})) {
    const entry = readEntry(value);
    if (entry) out.items[id] = entry;
  }
  for (const [id, at] of Object.entries(r?.removed ?? {})) if (isNum(at) && !out.items[id]) out.removed[id] = at;
  return out;
}

export function toCustomPrefs(state: WatchlistState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(state.items)) out[ITEM + id] = JSON.stringify(entry);
  for (const [id, at] of Object.entries(state.removed)) if (!state.items[id]) out[ITEM + id] = JSON.stringify({ removedAt: at });
  return out;
}

/** The latest add or remove of each title wins, whichever device made it. */
export function mergeCustomPrefs(local: WatchlistState, prefs: Record<string, string | null> | undefined): WatchlistState {
  const merged: WatchlistState = { items: { ...local.items }, removed: { ...local.removed } };
  for (const [key, raw] of Object.entries(prefs ?? {})) {
    if (!raw || !key.startsWith(ITEM)) continue;
    const id = key.slice(ITEM.length);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const localAt = Math.max(merged.items[id]?.addedAt ?? 0, merged.removed[id] ?? 0);
    const removedAt = (value as { removedAt?: unknown })?.removedAt;
    if (isNum(removedAt)) {
      if (removedAt > localAt) {
        delete merged.items[id];
        merged.removed[id] = removedAt;
      }
      continue;
    }
    const entry = readEntry(value);
    if (entry && entry.addedAt > localAt) {
      merged.items[id] = entry;
      delete merged.removed[id];
    }
  }
  return merged;
}

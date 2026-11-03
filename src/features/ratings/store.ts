// Your 1–10 ratings and notes. Stored locally for speed, mirrored to the user's Jellyfin
// DisplayPreferences so they follow them across devices, and the score is also written
// to Jellyfin's own UserData.Rating so other clients see it.

import { client, setUserRating } from "@/api/jellyfin";
import { MAX_NOTE, clampStars, emptyRatings, mergeCustomPrefs, toCustomPrefs, type RateTarget, type RatingsState } from "./logic";

const PREFS_ID = "argent-ratings";
const PREFS_CLIENT = "Argent";

const key = (userId: string) => `argent.ratings.${userId}`;

let listeners = new Set<() => void>();

export function subscribeRatings(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  listeners.forEach((fn) => fn());
}

// useSyncExternalStore needs the same object back until something changes.
let cache: { raw: string | null; state: RatingsState } = { raw: null, state: emptyRatings() };

export function readRatings(userId: string): RatingsState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(userId));
  } catch {
    /* ignore */
  }
  if (raw === cache.raw) return cache.state;
  let state = emptyRatings();
  try {
    const parsed = JSON.parse(raw || "null");
    if (parsed?.ratings) state = { ...state, ...parsed };
  } catch {
    /* ignore */
  }
  cache = { raw, state };
  return state;
}

let syncTimer = 0;

function write(userId: string, state: RatingsState, sync = true) {
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
    const merged = mergeCustomPrefs(readRatings(userId), current?.CustomPrefs);
    write(userId, merged, false);
    const body: DisplayPreferences = { ...current, CustomPrefs: { ...(current?.CustomPrefs ?? {}), ...toCustomPrefs(merged) } };
    await c.request<void>(prefsPath, { method: "POST", query, body });
  } catch {
    /* offline or older server: local copy still works */
  }
}

/** Merge ratings saved on the server (from other devices) into the local copy. */
export async function pullRatingsFromServer(userId: string) {
  try {
    const prefs = await client().request<DisplayPreferences>(prefsPath, { query: { userId, client: PREFS_CLIENT } });
    const local = readRatings(userId);
    const merged = mergeCustomPrefs(local, prefs?.CustomPrefs);
    if (JSON.stringify(merged) !== JSON.stringify(local)) write(userId, merged, false);
  } catch {
    /* ignore */
  }
}

export function rate(userId: string, target: RateTarget, stars: number, note?: string) {
  const s = readRatings(userId);
  const value = clampStars(stars);
  const trimmed = note?.trim().slice(0, MAX_NOTE);
  const ratings = { ...s.ratings, [target.id]: { stars: value, note: trimmed || undefined, ratedAt: Date.now(), name: target.name, type: target.type } };
  const removed = { ...s.removed };
  delete removed[target.id];
  write(userId, { ...s, ratings, removed });
  setUserRating(target.id, value).catch(() => {});
}

export function skipRating(userId: string, itemId: string) {
  const s = readRatings(userId);
  write(userId, { ...s, skipped: { ...s.skipped, [itemId]: Date.now() } });
}

export function removeRating(userId: string, itemId: string) {
  const s = readRatings(userId);
  const ratings = { ...s.ratings };
  delete ratings[itemId];
  write(userId, { ...s, ratings, removed: { ...s.removed, [itemId]: Date.now() } });
  setUserRating(itemId, null).catch(() => {});
}

export function resetRatingListeners() {
  listeners = new Set();
}

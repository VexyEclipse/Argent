// Recommendation feedback (dismissals, impressions). Stored locally for speed and
// mirrored to the user's Jellyfin DisplayPreferences so it follows them across devices.

import { client } from "@/api/jellyfin";
import type { Feedback } from "./engine";

const PREFS_ID = "argent-recommendations";
const PREFS_CLIENT = "Argent";
const DAY = 86_400_000;

const key = (userId: string) => `argent.rec.${userId}`;
const empty = (): Feedback => ({ dismissed: {}, impressions: {} });

let listeners = new Set<() => void>();

export function subscribeFeedback(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function readFeedback(userId: string): Feedback {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(userId)) || "null");
    if (parsed?.dismissed && parsed?.impressions) return parsed;
  } catch {
    /* ignore */
  }
  return empty();
}

function prune(f: Feedback, now = Date.now()): Feedback {
  // Impressions older than a month no longer matter.
  const impressions = Object.fromEntries(Object.entries(f.impressions).filter(([, v]) => now - v.last < 30 * DAY));
  return { dismissed: f.dismissed, impressions };
}

let syncTimer = 0;

function write(userId: string, f: Feedback) {
  const pruned = prune(f);
  try {
    localStorage.setItem(key(userId), JSON.stringify(pruned));
  } catch {
    /* ignore */
  }
  emit();
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => pushToServer(userId, pruned), 1500);
}

interface DisplayPreferences {
  Id?: string;
  CustomPrefs?: Record<string, string | null>;
  [k: string]: unknown;
}

async function pushToServer(userId: string, f: Feedback) {
  try {
    const c = client();
    const path = `/DisplayPreferences/${PREFS_ID}`;
    const query = { userId, client: PREFS_CLIENT };
    const current = await c.request<DisplayPreferences>(path, { query });
    const body: DisplayPreferences = {
      ...current,
      CustomPrefs: { ...(current?.CustomPrefs ?? {}), dismissed: JSON.stringify(f.dismissed) },
    };
    await c.request<void>(path, { method: "POST", query, body });
  } catch {
    /* offline or older server: local copy still works */
  }
}

/** Merge dismissals saved on the server (from other devices) into the local copy. */
export async function pullFromServer(userId: string) {
  try {
    const prefs = await client().request<DisplayPreferences>(`/DisplayPreferences/${PREFS_ID}`, { query: { userId, client: PREFS_CLIENT } });
    const remote = JSON.parse(prefs?.CustomPrefs?.dismissed || "{}") as Record<string, number>;
    const local = readFeedback(userId);
    const merged = { ...remote, ...local.dismissed };
    if (Object.keys(merged).length !== Object.keys(local.dismissed).length) {
      try {
        localStorage.setItem(key(userId), JSON.stringify({ ...local, dismissed: merged }));
      } catch {
        /* ignore */
      }
      emit();
    }
  } catch {
    /* ignore */
  }
}

export function dismiss(userId: string, itemId: string) {
  const f = readFeedback(userId);
  f.dismissed[itemId] = Date.now();
  write(userId, f);
}

export function undoDismiss(userId: string, itemId: string) {
  const f = readFeedback(userId);
  delete f.dismissed[itemId];
  write(userId, f);
}

export function clearDismissed(userId: string) {
  const f = readFeedback(userId);
  f.dismissed = {};
  write(userId, f);
}

/** Count an impression at most once per day per title. */
export function recordImpressions(userId: string, itemIds: string[]) {
  const f = readFeedback(userId);
  const now = Date.now();
  let changed = false;
  for (const id of itemIds) {
    const cur = f.impressions[id];
    if (cur && now - cur.last < DAY) continue;
    f.impressions[id] = { count: (cur?.count ?? 0) + 1, last: now, clicked: cur?.clicked };
    changed = true;
  }
  if (!changed) return;
  // Impressions don't change what's on screen right now; skip the re-render.
  try {
    localStorage.setItem(key(userId), JSON.stringify(prune(f)));
  } catch {
    /* ignore */
  }
}

export function recordOpen(userId: string, itemId: string) {
  const f = readFeedback(userId);
  const cur = f.impressions[itemId];
  f.impressions[itemId] = { count: cur?.count ?? 0, last: Date.now(), clicked: true };
  try {
    localStorage.setItem(key(userId), JSON.stringify(prune(f)));
  } catch {
    /* ignore */
  }
}

export function resetFeedbackListeners() {
  listeners = new Set();
}

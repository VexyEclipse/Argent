// Coming Up from TVmaze: a once-a-day check of the shows you follow for new episodes
// and announced seasons. Results are a local cache only: nothing is written to Jellyfin,
// and turning the check off simply stops it.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { client, getItems } from "@/api/jellyfin";
import { useAuth } from "@/auth/AuthProvider";
import { readWatchlist } from "@/features/watchlist/store";
import { desktop } from "@/platform/desktop";
import { entryFor, entryKey, notificationsFor, pickCandidates, sortEntries, type ShowSchedule, type UpcomingEntry } from "./logic";
import { fetchSchedule, lookupShow } from "./tvmaze";

const DAY = 86_400_000;
const CHECK_EVERY = DAY;
/** A show's schedule is re-fetched when older than this (a little under a day). */
const SCHEDULE_TTL = 20 * 3_600_000;
/** Shows TVmaze didn't recognise are looked up again after this. */
const MISS_TTL = 7 * DAY;
const MAX_NOTIFICATIONS = 4;

interface ShowCache {
  name: string;
  ref: string;
  tvmazeId: number | null;
  lookedUpAt: number;
  schedule?: ShowSchedule;
  fetchedAt?: number;
}

interface UpcomingCache {
  checkedAt: number;
  shows: Record<string, ShowCache>;
  /** entryKey -> ms notified, so each piece of news is announced once. */
  notified: Record<string, number>;
}

// ---- settings (this device) --------------------------------------------------------

export interface UpcomingPrefs {
  /** Check TVmaze daily for new episodes and seasons. */
  tvmaze: boolean;
  /** Desktop app: a notification when an episode airs today or a season is announced. */
  notify: boolean;
}

const PREFS_KEY = "argent.upcomingPrefs";
const PREF_DEFAULTS: UpcomingPrefs = { tvmaze: true, notify: true };

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => listeners.forEach((fn) => fn());

let prefsCache: { raw: string | null; prefs: UpcomingPrefs } = { raw: null, prefs: PREF_DEFAULTS };

export function readUpcomingPrefs(): UpcomingPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PREFS_KEY);
  } catch {
    /* ignore */
  }
  if (raw === prefsCache.raw) return prefsCache.prefs;
  let prefs = PREF_DEFAULTS;
  try {
    prefs = { ...PREF_DEFAULTS, ...JSON.parse(raw || "{}") };
  } catch {
    /* ignore */
  }
  prefsCache = { raw, prefs };
  return prefs;
}

export function setUpcomingPref<K extends keyof UpcomingPrefs>(key: K, value: UpcomingPrefs[K]) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readUpcomingPrefs(), [key]: value }));
  } catch {
    /* ignore */
  }
  emit();
}

export const useUpcomingPrefs = () => useSyncExternalStore(subscribe, readUpcomingPrefs);

// ---- cache ------------------------------------------------------------------------------

const cacheKey = (userId: string) => `argent.upcoming.${userId}`;
const emptyCache = (): UpcomingCache => ({ checkedAt: 0, shows: {}, notified: {} });

let cache: { userId: string; raw: string | null; value: UpcomingCache } = { userId: "", raw: null, value: emptyCache() };

function readCache(userId: string): UpcomingCache {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(cacheKey(userId));
  } catch {
    /* ignore */
  }
  if (userId === cache.userId && raw === cache.raw) return cache.value;
  let value = emptyCache();
  try {
    const parsed = JSON.parse(raw || "null");
    if (parsed && typeof parsed.checkedAt === "number" && parsed.shows && parsed.notified) value = parsed;
  } catch {
    /* ignore */
  }
  cache = { userId, raw, value };
  return value;
}

function writeCache(userId: string, value: UpcomingCache) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(value));
  } catch {
    /* storage full or blocked: the row just won't have TVmaze entries */
  }
  emit();
}

function entriesOf(c: UpcomingCache, now = new Date()): UpcomingEntry[] {
  const out: UpcomingEntry[] = [];
  for (const [seriesId, show] of Object.entries(c.shows)) {
    const entry = show.schedule ? entryFor(seriesId, show.schedule, now) : null;
    if (entry) out.push(entry);
  }
  return sortEntries(out);
}

// ---- the daily check --------------------------------------------------------------

let checking = false;
export const isChecking = () => checking;

interface Announcement {
  entry: UpcomingEntry;
  name: string;
}

// Where a clicked notification takes you; set by useUpcomingSync (it owns the router).
let openSeries: (id: string) => void = () => {};

/**
 * Checks TVmaze for every show you follow, at most once a day unless forced ("Check
 * now"). Safe to call often: it returns at once when nothing is due or a check is
 * already running. News is announced as desktop notifications.
 */
export async function refreshUpcoming(userId: string, force = false): Promise<void> {
  if (checking || !readUpcomingPrefs().tvmaze) return;
  const start = readCache(userId);
  if (!force && Date.now() - start.checkedAt < CHECK_EVERY) return;
  const scheduleTtl = force ? 0 : SCHEDULE_TTL;
  checking = true;
  emit();
  try {
    const series = await getItems({
      includeItemTypes: ["Series"],
      recursive: true,
      // RecursiveItemCount makes the server fill in how much of each series you've watched.
      fields: ["ProviderIds", "RecursiveItemCount"],
      enableImageTypes: [],
      limit: 5000,
    });
    const names = new Map(series.Items.map((s) => [s.Id, s.Name]));
    const candidates = pickCandidates(series.Items, new Set(Object.keys(readWatchlist(userId).items)));
    const previous =
      start.checkedAt === 0
        ? null
        : Object.fromEntries(Object.entries(start.shows).map(([id, s]) => [id, s.schedule ? entryFor(id, s.schedule) : null]));

    const shows: Record<string, ShowCache> = {};
    let done = 0;
    let failures = 0;
    for (const c of candidates) {
      // Stop if the user signs out or switches account mid-check.
      if (client().userId !== userId) return;
      const old = start.shows[c.seriesId];
      const now = Date.now();
      const show: ShowCache = old && old.ref === c.ref ? { ...old, name: names.get(c.seriesId) ?? old.name } : { name: names.get(c.seriesId) ?? "", ref: c.ref, tvmazeId: null, lookedUpAt: 0 };
      try {
        if (show.lookedUpAt === 0 || (show.tvmazeId === null && now - show.lookedUpAt > MISS_TTL)) {
          show.tvmazeId = await lookupShow(c.ref);
          show.lookedUpAt = Date.now();
        }
        if (show.tvmazeId !== null && (!show.fetchedAt || now - show.fetchedAt >= scheduleTtl)) {
          const schedule = await fetchSchedule(show.tvmazeId);
          if (schedule) {
            show.schedule = schedule;
            show.fetchedAt = Date.now();
          }
        }
        failures = 0;
      } catch {
        // Offline, rate limited or a bad response: keep what we had for this show. Several
        // in a row means TVmaze is unreachable: stop, keep the old results, retry later.
        if (++failures >= 3) return;
      }
      shows[c.seriesId] = show;
      // Let a first check fill the row as it goes.
      if (++done % 15 === 0) writeCache(userId, { ...readCache(userId), shows: { ...readCache(userId).shows, ...shows } });
    }

    const result: UpcomingCache = { checkedAt: Date.now(), shows, notified: {} };
    const entries = entriesOf(result);
    const news = notificationsFor(previous, entries, start.notified);
    const cutoff = Date.now() - 30 * DAY;
    result.notified = Object.fromEntries(Object.entries(start.notified).filter(([, at]) => at > cutoff));
    for (const e of news) result.notified[entryKey(e)] = Date.now();
    writeCache(userId, result);
    announce(news.map((entry) => ({ entry, name: shows[entry.seriesId]?.name || "A show you follow" })));
  } catch {
    // Jellyfin unreachable: try again on the next hourly tick.
  } finally {
    checking = false;
    emit();
  }
}

// ---- hooks ------------------------------------------------------------------------------

/** TVmaze entries for the signed-in user (soonest first) and when they were checked. */
export function useUpcomingEntries() {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  const prefs = useUpcomingPrefs();
  const value = useSyncExternalStore(subscribe, () => readCache(userId));
  const busy = useSyncExternalStore(subscribe, isChecking);
  const entries = useMemo(() => (prefs.tvmaze ? entriesOf(value) : []), [value, prefs.tvmaze]);
  return { entries, checkedAt: value.checkedAt, checking: busy };
}

function announce(list: Announcement[]) {
  if (!desktop || !readUpcomingPrefs().notify || !list.length || typeof Notification === "undefined") return;
  const show = (title: string, body: string, seriesId?: string) => {
    const n = new Notification(title, { body });
    n.onclick = () => {
      desktop?.showWindow();
      if (seriesId) openSeries(seriesId);
    };
  };
  if (list.length > MAX_NOTIFICATIONS) {
    show("Coming Up", `${list.length} of your shows have new episodes or seasons.`);
    return;
  }
  for (const { entry, name } of list) show(name, describeEntry(entry, true), entry.seriesId);
}

/** "New episode today · S2 · E5", "Season 3 announced", "Season 3 premieres 12 Mar". */
export function describeEntry(e: UpcomingEntry, forNotification = false): string {
  const when = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "today";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  if (e.kind === "season") return `Season ${e.season} announced`;
  if (e.kind === "premiere") return e.date ? `Season ${e.season} premieres ${when(e.date)}` : `Season ${e.season} announced`;
  const code = `S${e.season}${e.episode !== undefined ? ` · E${e.episode}` : ""}`;
  return forNotification ? `New episode ${e.date ? when(e.date) : "soon"} · ${code}` : code;
}

/** Runs the check shortly after start-up, then hourly (it only does work once a day). */
export function useUpcomingSync(onOpenSeries: (id: string) => void) {
  const { user } = useAuth();
  const prefs = useUpcomingPrefs();
  const userId = user?.Id;
  useEffect(() => {
    openSeries = onOpenSeries;
  }, [onOpenSeries]);
  useEffect(() => {
    if (!userId || !prefs.tvmaze) return;
    const run = () => refreshUpcoming(userId);
    const first = window.setTimeout(run, 8_000);
    const hourly = window.setInterval(run, 3_600_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(hourly);
    };
  }, [userId, prefs.tvmaze]);
}

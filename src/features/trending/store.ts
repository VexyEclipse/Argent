// Top 10 settings and the trending lists behind them.
//
// Anime comes from AniList's public API (free, no key). Films and series come from TMDB,
// which needs a free API key: yours (saved to your Jellyfin account, so your other devices
// have it too) or one the host set in argent.config.json. Requests carry no cookies, no
// Jellyfin token and no referrer, and nothing about your library: matching happens here.
// Lists are cached on this device for a few hours.

import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { createSyncedMap } from "@/api/syncedMap";
import { useAuth } from "@/auth/AuthProvider";
import { loadAppConfig } from "@/config/appConfig";
import {
  ANILIST_TRENDING_QUERY,
  isBearerToken,
  parseAniList,
  parseTmdb,
  parseTmdbGenres,
  pickTmdbTrailer,
  TREND_KINDS,
  type TrendEntry,
  type TrendKind,
} from "./logic";

const ANILIST = "https://graphql.anilist.co";
const TMDB = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 10_000;
const CACHE_KEY = "argent.trendingCache";
const CACHE_TTL = 6 * 3_600_000;
/** How far down each list to read, so there are ten even when only yours are shown. */
const DEPTH = 50;

// ---- settings (your account) ----------------------------------------------------------------

export interface TrendingPrefs {
  /** The Top 10 row on the home page. */
  home: boolean;
  anime: boolean;
  movies: boolean;
  series: boolean;
  /** Titles that aren't in your library, tagged as such. */
  notOwned: boolean;
  /** Your TMDB API key (v3 key or v4 read access token). */
  tmdbKey: string;
}

const DEFAULTS: TrendingPrefs = { home: true, anime: true, movies: true, series: true, notOwned: true, tmdbKey: "" };

const settings = createSyncedMap<string | boolean>({ prefsId: "argent-trending", field: "settings", storageKey: "argent.trending" });

export function useTrendingPrefs(): TrendingPrefs {
  const raw = settings.use();
  return useMemo(() => {
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof TrendingPrefs)[]) {
      const v = raw[k];
      if (typeof v === typeof DEFAULTS[k]) (out as Record<string, unknown>)[k] = v;
    }
    return out;
  }, [raw]);
}

export function useSetTrendingPref() {
  const { user } = useAuth();
  return <K extends keyof TrendingPrefs>(key: K, value: TrendingPrefs[K]) => {
    if (user) settings.set(user.Id, key, value);
  };
}

/** The key in use: yours, else the host's from argent.config.json. */
export function useTmdbKey(): { key: string; source: "you" | "host" | null } {
  const prefs = useTrendingPrefs();
  const config = useQuery({ queryKey: ["app-config"], queryFn: loadAppConfig, staleTime: Infinity });
  const host = typeof config.data?.tmdbApiKey === "string" ? config.data.tmdbApiKey.trim() : "";
  if (prefs.tmdbKey.trim()) return { key: prefs.tmdbKey.trim(), source: "you" };
  if (host) return { key: host, source: "host" };
  return { key: "", source: null };
}

/** The lists to offer: switched on, and for films and series, with a TMDB key. */
export function useTrendKinds(): TrendKind[] {
  const prefs = useTrendingPrefs();
  const { key } = useTmdbKey();
  return TREND_KINDS.filter((k) => prefs[k] && (k === "anime" || Boolean(key)));
}

// ---- which list the row shows (this device) ------------------------------------------------

const TAB_KEY = "argent.top10Tab";
const tabListeners = new Set<() => void>();
const readTab = (): string => {
  try {
    return localStorage.getItem(TAB_KEY) ?? "";
  } catch {
    return "";
  }
};

export function useTopTenTab(kinds: TrendKind[]): [TrendKind | undefined, (k: TrendKind) => void] {
  const stored = useSyncExternalStore((fn) => {
    tabListeners.add(fn);
    return () => tabListeners.delete(fn);
  }, readTab);
  const tab = kinds.find((k) => k === stored) ?? kinds[0];
  const set = (k: TrendKind) => {
    try {
      localStorage.setItem(TAB_KEY, k);
    } catch {
      /* ignore */
    }
    tabListeners.forEach((fn) => fn());
  };
  return [tab, set];
}

// ---- fetching ---------------------------------------------------------------------------

/** A short fingerprint of the key, so the cache knows when it changed without storing it twice. */
export function keyPrint(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

type Cache = Record<string, { at: number; entries: TrendEntry[] }>;

function readCache(): Cache {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function writeCache(slot: string, entries: TrendEntry[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), [slot]: { at: Date.now(), entries } }));
  } catch {
    /* full or unavailable: the next visit fetches again */
  }
}

const quiet: RequestInit = { credentials: "omit", referrerPolicy: "no-referrer" };

async function fetchAniList(): Promise<TrendEntry[]> {
  const response = await fetch(ANILIST, {
    ...quiet,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_TRENDING_QUERY, variables: { n: DEPTH } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`AniList ${response.status}`);
  return parseAniList(await response.json());
}

export class TmdbKeyError extends Error {}

function tmdbLanguage() {
  const lang = navigator.language || "en-US";
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(lang) ? lang : "en-US";
}

async function tmdb(path: string, key: string, query: Record<string, string> = {}): Promise<unknown> {
  const bearer = isBearerToken(key);
  const params = new URLSearchParams({ language: tmdbLanguage(), ...query });
  if (!bearer) params.set("api_key", key);
  const response = await fetch(`${TMDB}${path}?${params}`, {
    ...quiet,
    headers: bearer ? { Authorization: `Bearer ${key}`, Accept: "application/json" } : { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401) throw new TmdbKeyError("TMDB didn't accept the key");
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  return response.json();
}

async function fetchTmdb(kind: "movies" | "series", key: string): Promise<TrendEntry[]> {
  const type = kind === "movies" ? "movie" : "tv";
  const [genres, page1, page2] = await Promise.all([
    tmdb(`/genre/${type}/list`, key)
      .then(parseTmdbGenres)
      .catch(() => ({})),
    tmdb(`/trending/${type}/week`, key, { page: "1" }),
    tmdb(`/trending/${type}/week`, key, { page: "2" }).catch(() => null),
  ]);
  const first = parseTmdb(page1, kind, genres);
  const second = page2 ? parseTmdb(page2, kind, genres, first.length + 1) : [];
  const seen = new Set(first.map((e) => e.key));
  return [...first, ...second.filter((e) => !seen.has(e.key))];
}

/** A trending list, from this device's cache when it's fresh. */
export async function getTrending(kind: TrendKind, key: string): Promise<TrendEntry[]> {
  if (kind !== "anime" && !key) return [];
  const slot = kind === "anime" ? kind : `${kind}:${keyPrint(key)}`;
  const cached = readCache()[slot];
  if (cached && Date.now() - cached.at < CACHE_TTL && Array.isArray(cached.entries)) return cached.entries;
  try {
    const entries = kind === "anime" ? await fetchAniList() : await fetchTmdb(kind, key);
    writeCache(slot, entries);
    return entries;
  } catch (e) {
    // Offline or the service is down: yesterday's list beats none.
    if (cached?.entries?.length && !(e instanceof TmdbKeyError)) return cached.entries;
    throw e;
  }
}

/** true: TMDB accepts the key; false: it doesn't; null: TMDB couldn't be reached. */
export async function checkTmdbKey(key: string): Promise<boolean | null> {
  try {
    await tmdb("/configuration", key);
    return true;
  } catch (e) {
    return e instanceof TmdbKeyError ? false : null;
  }
}

/** A trailer for a title you don't have: AniList lists one; TMDB is asked. */
export async function trailerFor(entry: TrendEntry, key: string): Promise<string | null> {
  if (entry.trailer) return entry.trailer;
  if (!entry.ids.tmdb || !key) return null;
  const type = entry.format === "movie" ? "movie" : "tv";
  try {
    return pickTmdbTrailer(await tmdb(`/${type}/${entry.ids.tmdb}/videos`, key, { language: "en-US" })) ?? null;
  } catch {
    return null;
  }
}

// Filler episodes for anime, from MyAnimeList's episode lists. Jikan's public API, which
// served them, shut down in October 2026; two free services carry its format on:
// jikan-edge (open source, jikan.lucashdo.com) first, and Tenrai (api.tenrai.org) when it
// can't answer. A show is looked up by the MyAnimeList id in its metadata (or via AniList,
// or a careful title search), and its episode list read once a week. Requests carry no
// cookies, no Jellyfin token and no referrer; results are cached on this device only.

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { client, getEpisodes, getItem } from "@/api/jellyfin";
import { isAnimeLibrary } from "@/api/libraries";
import type { BaseItem } from "@/api/types";
import {
  absoluteNumbers,
  aniListIdOf,
  checkNeeded,
  fillerEpisodeIds,
  hasAnimeIds,
  isSettled,
  isTvEntry,
  malIdOf,
  mergePages,
  parseEpisodePage,
  parseEpisodeTitles,
  parseSequel,
  pickSearchMatch,
  tailPage,
  type EpisodePage,
  type MalPart,
  type SavedRun,
} from "./logic";

/** In order of preference. Each allows at least 60 requests a minute; stay under that. */
const SERVICES = [
  { name: "jikan-edge", base: "https://jikan.lucashdo.com/v1" },
  { name: "Tenrai", base: "https://api.tenrai.org/v1" },
];
const ANILIST = "https://graphql.anilist.co";
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 8_000;
/** A service that failed is skipped for this long. */
const DOWN_FOR_MS = 10 * 60_000;
const DAY = 86_400_000;
/** Not anime, or not found: asked again after this. */
const MISS_FOR = 30 * DAY;
const MAX_PARTS = 6;
const MAX_CACHED = 200;

// ---- settings (this device) --------------------------------------------------------------

export interface FillerPrefs {
  /** Look up filler episodes and badge them. */
  badges: boolean;
  /** Next episode, autoplay and a series' Play button pass over filler. */
  skip: boolean;
  /** Episodes titled with only a file name get their title from MyAnimeList. */
  names: boolean;
}

const PREFS_KEY = "argent.fillerPrefs";
const DEFAULTS: FillerPrefs = { badges: true, skip: false, names: true };
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
let prefsCache: { raw: string | null; value: FillerPrefs } = { raw: null, value: DEFAULTS };

export function readFillerPrefs(): FillerPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PREFS_KEY);
  } catch {
    /* ignore */
  }
  if (raw === prefsCache.raw) return prefsCache.value;
  let value = DEFAULTS;
  try {
    value = { ...DEFAULTS, ...JSON.parse(raw || "{}") };
  } catch {
    /* ignore */
  }
  prefsCache = { raw, value };
  return value;
}

export function setFillerPref<K extends keyof FillerPrefs>(key: K, value: FillerPrefs[K]) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readFillerPrefs(), [key]: value }));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export const useFillerPrefs = () => useSyncExternalStore(subscribe, readFillerPrefs);

const enabled = () => {
  const p = readFillerPrefs();
  return p.badges || p.skip;
};

// ---- cache --------------------------------------------------------------------------------

type Cached = SavedRun | { at: number; miss: true };
const CACHE_KEY = "argent.filler";

function readCache(): Record<string, Cached> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

function writeCache(seriesId: string, value: Cached) {
  const all = readCache();
  delete all[seriesId];
  all[seriesId] = value;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_CACHED))) delete all[k];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* storage full: looked up again next time */
  }
}

// ---- network ------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastCall = SERVICES.map(() => 0);
const downUntil = SERVICES.map(() => 0);

/** One request to one service, spaced to stay inside its rate limit. Null for "no such entry". */
async function ask(service: number, path: string): Promise<unknown | null> {
  const wait = lastCall[service] + MIN_GAP_MS - Date.now();
  lastCall[service] = Math.max(Date.now(), lastCall[service] + MIN_GAP_MS);
  if (wait > 0) await sleep(wait);
  const response = await fetch(`${SERVICES[service].base}${path}`, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${SERVICES[service].name} ${response.status}`);
  return response.json();
}

/**
 * A request to the first service that answers. One that times out, is rate limited or
 * errors is set aside for a while, so a dead service costs one wait, not one per request.
 */
async function jikan(path: string): Promise<unknown | null> {
  let lastError: unknown = new Error("No filler service is reachable");
  for (let i = 0; i < SERVICES.length; i++) {
    if (Date.now() < downUntil[i]) continue;
    try {
      return await ask(i, path);
    } catch (e) {
      downUntil[i] = Date.now() + DOWN_FOR_MS;
      lastError = e;
    }
  }
  throw lastError;
}

/** A title search on each service until one finds the show (jikan-edge lists fewer alternative titles). */
async function search(query: string, name: string, year?: number): Promise<number | null> {
  let answered = false;
  for (let i = 0; i < SERVICES.length; i++) {
    if (Date.now() < downUntil[i]) continue;
    try {
      const id = pickSearchMatch(await ask(i, `/anime?q=${encodeURIComponent(query)}&type=tv`), name, year);
      answered = true;
      if (id) return id;
    } catch {
      downUntil[i] = Date.now() + DOWN_FOR_MS;
    }
  }
  // Nobody answered: that's not "not found", so it mustn't be remembered as one.
  if (!answered) throw new Error("No filler service is reachable");
  return null;
}

async function malFromAniList(id: number): Promise<number | null> {
  const response = await fetch(ANILIST, {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: "query($id:Int){Media(id:$id,type:ANIME){idMal}}", variables: { id } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { data?: { Media?: { idMal?: unknown } } };
  const mal = json.data?.Media?.idMal;
  return typeof mal === "number" && mal > 0 ? mal : null;
}

async function findMalId(series: BaseItem): Promise<number | null> {
  const direct = malIdOf(series.ProviderIds);
  if (direct) return direct;
  const aniList = aniListIdOf(series.ProviderIds);
  if (aniList) {
    const viaAniList = await malFromAniList(aniList).catch(() => null);
    if (viaAniList) return viaAniList;
  }
  let id = await search(series.Name, series.Name, series.ProductionYear);
  // Libraries often name a show in English while MyAnimeList uses its romanised title.
  if (!id && series.OriginalTitle && series.OriginalTitle !== series.Name && /[a-z]/i.test(series.OriginalTitle))
    id = await search(series.OriginalTitle, series.OriginalTitle, series.ProductionYear);
  return id;
}

/** An entry's episode list from a page onwards, until the last page. */
async function readPages(malId: number, fromPage: number): Promise<EpisodePage[]> {
  const pages: EpisodePage[] = [];
  for (let page = fromPage; page < fromPage + 30; page++) {
    const parsed = parseEpisodePage(await jikan(`/anime/${malId}/episodes?page=${page}`));
    if (!parsed) break;
    pages.push(parsed);
    if (!parsed.more) break;
  }
  return pages;
}

/** The next TV season after an entry, when MyAnimeList lists it as an entry of its own. */
async function sequelOf(malId: number): Promise<number | null> {
  const sequel = parseSequel(await jikan(`/anime/${malId}/relations`));
  return sequel && isTvEntry(await jikan(`/anime/${sequel}`)) ? sequel : null;
}

/**
 * A show's run on MyAnimeList, brought up to date. A new run reads its entry, then TV
 * sequels until the library's episodes are covered. A saved run only has its newest page
 * read again (new episodes, late filler marks), then sequels if the library has gone past it.
 */
async function updateRun(saved: MalPart[], malId: number, libraryEpisodes: number): Promise<MalPart[]> {
  const parts = [...saved];
  if (parts.length) {
    const last = parts[parts.length - 1];
    parts[parts.length - 1] = mergePages(last, await readPages(last.malId, tailPage(last)));
  } else {
    const first = mergePages({ malId, episodes: 0, filler: [] }, await readPages(malId, 1));
    if (!first.episodes) return [];
    parts.push(first);
  }
  while (parts.reduce((n, p) => n + p.episodes, 0) < libraryEpisodes && parts.length < MAX_PARTS) {
    const sequel = await sequelOf(parts[parts.length - 1].malId);
    if (!sequel) break;
    const part = mergePages({ malId: sequel, episodes: 0, filler: [] }, await readPages(sequel, 1));
    if (!part.episodes) break;
    parts.push(part);
  }
  return parts;
}

async function isAnimeSeries(series: BaseItem): Promise<boolean> {
  if (hasAnimeIds(series.ProviderIds)) return true;
  const ancestors = await client().request<BaseItem[]>(`/Items/${series.Id}/Ancestors`, { query: { userId: client().userId } });
  return ancestors.some((a) => a.Type === "CollectionFolder" && isAnimeLibrary(a));
}

/** A show's episodes and its run on MyAnimeList. */
export interface Run {
  episodes: BaseItem[];
  parts: MalPart[];
}

const inFlight = new Map<string, Promise<Run | null>>();

/**
 * A show's run on MyAnimeList, from the saved copy unless the rules in `checkNeeded` say
 * it may have changed: a finished show is read once, then only when the library gains
 * episodes. Null when it isn't anime or isn't found.
 */
export function loadRun(seriesId: string): Promise<Run | null> {
  const running = inFlight.get(seriesId);
  if (running) return running;
  const job = (async (): Promise<Run | null> => {
    const episodes = (await getEpisodes(seriesId)).Items;
    const cached = readCache()[seriesId];
    const now = Date.now();
    if (cached && "miss" in cached && now - cached.at < MISS_FOR) return null;
    const saved = cached && "parts" in cached ? cached : null;
    const libraryEpisodes = Math.max(0, ...absoluteNumbers(episodes).values());
    const newestAdded = Math.max(0, ...episodes.map((e) => Date.parse(e.DateCreated ?? "") || 0));
    if (saved && checkNeeded(saved, { episodes: libraryEpisodes, newestAdded }, now) === "none") return { episodes, parts: saved.parts };

    const series = await getItem(seriesId, ["ProviderIds", "ProductionYear", "OriginalTitle"]);
    if (!saved && !(await isAnimeSeries(series))) {
      writeCache(seriesId, { at: now, miss: true });
      return null;
    }
    try {
      const malId = saved?.parts[0]?.malId ?? (await findMalId(series));
      if (!malId) {
        writeCache(seriesId, { at: now, miss: true });
        return null;
      }
      const parts = await updateRun(saved?.parts ?? [], malId, libraryEpisodes);
      writeCache(seriesId, { at: now, parts, status: series.Status, libraryEpisodes, settled: isSettled(series.Status, newestAdded, now) });
      return { episodes, parts };
    } catch {
      // No service reachable: use what we had, however old, and look again next time.
      return saved ? { episodes, parts: saved.parts } : null;
    }
  })().finally(() => inFlight.delete(seriesId));
  inFlight.set(seriesId, job);
  return job;
}

/** Ids of a series' filler episodes (empty when it isn't anime, isn't found, or the lookup is off). */
export async function fillerIds(seriesId: string): Promise<Set<string>> {
  if (!enabled()) return new Set();
  const run = await loadRun(seriesId);
  return run ? fillerEpisodeIds(run.episodes, run.parts) : new Set();
}

/** Titles on one page of an entry's episode list. */
export async function episodeTitles(malId: number, page: number): Promise<Record<number, string>> {
  return parseEpisodeTitles(await jikan(`/anime/${malId}/episodes?page=${page}`));
}

/** Filler episode ids for a series, for badges (empty while loading or when off). */
export function useFillerIds(seriesId: string | undefined): Set<string> {
  const prefs = useFillerPrefs();
  const q = useQuery({
    queryKey: ["filler", seriesId, prefs.badges || prefs.skip],
    queryFn: () => fillerIds(seriesId!),
    enabled: Boolean(seriesId) && prefs.badges,
    staleTime: 60 * 60_000,
    retry: false,
  });
  return q.data ?? EMPTY;
}

const EMPTY = new Set<string>();

/** With "Skip filler" on: the first episode from `list` (in order) that isn't filler. */
export async function skipFiller<T extends Pick<BaseItem, "Id">>(seriesId: string | undefined, list: T[]): Promise<T | null> {
  if (!list.length) return null;
  if (!seriesId || !readFillerPrefs().skip) return list[0];
  const filler = await fillerIds(seriesId).catch(() => EMPTY);
  return list.find((e) => !filler.has(e.Id)) ?? null;
}

// Pure filler rules: finding a show on MyAnimeList, reading its episode list (from a
// Jikan-style service), and matching Jellyfin's season/episode numbers to MyAnimeList's
// running numbers. No DOM, no network.

import type { BaseItem } from "@/api/types";

/** One MyAnimeList entry in a show's run (a long series is often several entries). */
export interface MalPart {
  malId: number;
  /** Episodes in this entry (from its episode list). */
  episodes: number;
  /** Episode numbers within this entry that are filler. */
  filler: number[];
}

/** MyAnimeList id straight from the metadata, or via AniList. */
export function malIdOf(ids: Record<string, string> | undefined): number | null {
  const raw = ids?.MyAnimeList ?? ids?.Mal ?? ids?.MAL ?? ids?.myanimelist;
  const n = Number(raw);
  return raw && /^\d{1,9}$/.test(raw) && n > 0 ? n : null;
}

export function aniListIdOf(ids: Record<string, string> | undefined): number | null {
  const raw = ids?.AniList ?? ids?.Anilist ?? ids?.anilist;
  const n = Number(raw);
  return raw && /^\d{1,9}$/.test(raw) && n > 0 ? n : null;
}

/** Whether a series looks like anime from its own metadata (anime database ids). */
export const hasAnimeIds = (ids: Record<string, string> | undefined) =>
  Boolean(malIdOf(ids) || aniListIdOf(ids) || ids?.AniDB || ids?.Anidb || ids?.Kitsu);

const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// The two services speak slightly different dialects of Jikan's format: Tenrai keeps
// Jikan's snake_case (mal_id, has_next_page), jikan-edge uses camelCase (malId, number).
// The readers below accept both.

const idOf = (r: Record<string, unknown>) => (typeof r.mal_id === "number" ? r.mal_id : typeof r.malId === "number" ? r.malId : undefined);

function yearOf(r: Record<string, unknown>): number | undefined {
  if (typeof r.year === "number") return r.year;
  const aired = isObj(r.aired) && isObj(r.aired.prop) && isObj(r.aired.prop.from) ? r.aired.prop.from.year : undefined;
  if (typeof aired === "number") return aired;
  const start = typeof r.startDate === "string" ? Number(r.startDate.slice(0, 4)) : NaN;
  return Number.isInteger(start) && start > 1900 ? start : undefined;
}

/**
 * The search result that is clearly this show: same title (any of its titles) and the
 * same start year, give or take one. Nothing when unsure: a wrong match would mark the
 * wrong episodes.
 */
export function pickSearchMatch(json: unknown, name: string, year?: number): number | null {
  if (!isObj(json) || !Array.isArray(json.data)) return null;
  const want = normalise(name);
  if (!want) return null;
  const matches: { id: number; year?: number }[] = [];
  for (const r of json.data) {
    if (!isObj(r)) continue;
    const id = idOf(r);
    if (id === undefined) continue;
    const synonyms = Array.isArray(r.title_synonyms) ? r.title_synonyms : Array.isArray(r.titleSynonyms) ? r.titleSynonyms : [];
    const titles = [r.title, r.title_english, r.titleEnglish, r.title_japanese, r.titleJapanese, ...synonyms];
    if (Array.isArray(r.titles)) for (const t of r.titles) if (isObj(t)) titles.push(t.title);
    if (!titles.some((t) => typeof t === "string" && normalise(t) === want)) continue;
    matches.push({ id, year: yearOf(r) });
  }
  if (year) {
    const dated = matches.find((m) => m.year !== undefined && Math.abs(m.year - year) <= 1);
    if (dated) return dated.id;
  }
  return matches.length === 1 && (!year || matches[0].year === undefined) ? matches[0].id : null;
}

/** One page of an entry's episode list: the filler episode numbers, the lowest and highest number, and whether more pages follow. */
export interface EpisodePage {
  filler: number[];
  first: number;
  last: number;
  more: boolean;
}

/** One page of `/anime/{id}/episodes`. */
export function parseEpisodePage(json: unknown): EpisodePage | null {
  if (!isObj(json) || !Array.isArray(json.data)) return null;
  const filler: number[] = [];
  let first = 0;
  let last = 0;
  for (const e of json.data) {
    if (!isObj(e)) continue;
    const n = typeof e.mal_id === "number" ? e.mal_id : e.number;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 100_000) continue;
    last = Math.max(last, n);
    first = first ? Math.min(first, n) : n;
    if (e.filler === true) filler.push(n);
  }
  const paging = isObj(json.pagination) ? json.pagination : isObj(json.meta) && isObj(json.meta.pagination) ? json.meta.pagination : {};
  const more = paging.has_next_page === true || paging.hasNextPage === true;
  return { filler, first, last, more };
}

/** The sequel entry (a following TV season) from `/anime/{id}/relations`. */
export function parseSequel(json: unknown): number | null {
  if (!isObj(json) || !Array.isArray(json.data)) return null;
  for (const rel of json.data) {
    if (!isObj(rel) || rel.relation !== "Sequel") continue;
    // Jikan's shape groups entries under each relation; jikan-edge lists them flat.
    const entries = Array.isArray(rel.entry) ? rel.entry : [rel];
    for (const e of entries) if (isObj(e) && e.type === "anime" && idOf(e) !== undefined) return idOf(e)!;
  }
  return null;
}

/** Whether an entry is a TV series (sequel films and OVAs don't continue the numbering). */
export function isTvEntry(json: unknown): boolean {
  const d = isObj(json) && isObj(json.data) ? json.data : null;
  return Boolean(d && d.type === "TV");
}

type Ep = Pick<BaseItem, "Id" | "IndexNumber" | "ParentIndexNumber" | "LocationType">;

/**
 * Running episode numbers (1, 2, 3… across seasons), as MyAnimeList counts. A season
 * starts after the highest episode number of the seasons before it, so a missing file
 * doesn't shift everything after it. Specials (season 0) have none.
 */
export function absoluteNumbers(episodes: Ep[]): Map<string, number> {
  const bySeason = new Map<number, number>();
  for (const e of episodes) {
    const s = e.ParentIndexNumber ?? 1;
    if (s === 0 || e.IndexNumber === undefined) continue;
    bySeason.set(s, Math.max(bySeason.get(s) ?? 0, e.IndexNumber));
  }
  const offsets = new Map<number, number>();
  let total = 0;
  for (const s of [...bySeason.keys()].sort((a, b) => a - b)) {
    offsets.set(s, total);
    total += bySeason.get(s)!;
  }
  const out = new Map<string, number>();
  for (const e of episodes) {
    const s = e.ParentIndexNumber ?? 1;
    if (s === 0 || e.IndexNumber === undefined || !offsets.has(s)) continue;
    out.set(e.Id, offsets.get(s)! + e.IndexNumber);
  }
  return out;
}

/** Filler episodes as running numbers across a chain of entries. */
export function fillerNumbers(parts: MalPart[]): Set<number> {
  const out = new Set<number>();
  let offset = 0;
  for (const p of parts) {
    for (const n of p.filler) out.add(offset + n);
    offset += p.episodes;
  }
  return out;
}

/** Ids of the filler episodes among a show's episodes. */
export function fillerEpisodeIds(episodes: Ep[], parts: MalPart[]): Set<string> {
  const filler = fillerNumbers(parts);
  const ids = new Set<string>();
  if (!filler.size) return ids;
  for (const [id, n] of absoluteNumbers(episodes)) if (filler.has(n)) ids.add(id);
  return ids;
}

// ---- keeping a saved list current -------------------------------------------------------

/** Episodes per page of an entry's episode list (both services). */
export const EPISODES_PER_PAGE = 100;

/** The page to read again to pick up an entry's newest episodes: the one its last episode is on. */
export const tailPage = (part: Pick<MalPart, "episodes">) => Math.floor((Math.max(1, part.episodes) - 1) / EPISODES_PER_PAGE) + 1;

/**
 * An entry after reading some of its pages again: the pages read replace what was saved
 * for their episodes (a filler mark can be added or taken back), the rest stays.
 */
export function mergePages(part: MalPart, pages: EpisodePage[]): MalPart {
  const read = pages.filter((p) => p.first > 0);
  if (!read.length) return part;
  const from = Math.min(...read.map((p) => p.first));
  const filler = new Set(part.filler.filter((n) => n < from));
  for (const p of read) p.filler.forEach((n) => filler.add(n));
  return { ...part, episodes: Math.max(part.episodes, ...read.map((p) => p.last)), filler: [...filler].sort((a, b) => a - b) };
}

/** A show's saved filler list and when it was last checked. */
export interface SavedRun {
  /** Last time anything was read for it (ms). */
  at: number;
  parts: MalPart[];
  /** Jellyfin's status for the show then: "Continuing", "Ended"… */
  status?: string;
  /** Episodes the library had then (running numbers). */
  libraryEpisodes?: number;
  /** A finished show has had its last check (a month after its final episode arrived). */
  settled?: boolean;
}

export type CheckKind = "none" | "newEpisodes" | "weekly" | "final";

const ONE_DAY = 86_400_000;
export const WEEKLY_MS = 7 * ONE_DAY;
/** Late filler marks on a finished show are caught by one check this long after its last episode arrived. */
export const SETTLE_MS = 30 * ONE_DAY;

/**
 * Whether a saved list needs reading again, and why. New episodes in the library are read
 * as they arrive; a show still airing has its newest page rechecked weekly; a finished one
 * once more, a month after its last episode arrived, and then never.
 */
export function checkNeeded(saved: SavedRun, library: { episodes: number; newestAdded?: number; status?: string }, now = Date.now()): CheckKind {
  const covered = saved.parts.reduce((n, p) => n + p.episodes, 0);
  const since = now - saved.at;
  // Past the list: at once when they've just arrived; if MyAnimeList hadn't listed them
  // yet, again a week later.
  if (library.episodes > covered && (library.episodes > (saved.libraryEpisodes ?? 0) || since >= WEEKLY_MS)) return "newEpisodes";
  const status = library.status ?? saved.status;
  if (status !== "Ended") return since >= WEEKLY_MS ? "weekly" : "none";
  if (saved.settled) return "none";
  const settleAt = (library.newestAdded ?? 0) + SETTLE_MS;
  return now >= settleAt && saved.at < settleAt ? "final" : "none";
}

/** Whether a finished show's list needs no more checks once it's read now. */
export const isSettled = (status: string | undefined, newestAdded: number | undefined, now = Date.now()) => status === "Ended" && now >= (newestAdded ?? 0) + SETTLE_MS;

// ---- episode titles ----------------------------------------------------------------------

/** Titles on one page of `/anime/{id}/episodes`, by episode number (English title, else romanised). */
export function parseEpisodeTitles(json: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!isObj(json) || !Array.isArray(json.data)) return out;
  for (const e of json.data) {
    if (!isObj(e)) continue;
    const n = typeof e.mal_id === "number" ? e.mal_id : e.number;
    const title = [e.title, e.title_romanji, e.titleRomanji].find((t) => typeof t === "string" && t.trim());
    if (typeof n === "number" && Number.isInteger(n) && n > 0 && typeof title === "string") out[n] = title.trim().slice(0, 200);
  }
  return out;
}

/** Which entry of a run a running episode number falls in, and its number within that entry. */
export function locate(n: number, parts: Pick<MalPart, "malId" | "episodes">[]): { malId: number; number: number } | null {
  let offset = 0;
  for (const p of parts) {
    if (n > offset && n <= offset + p.episodes) return { malId: p.malId, number: n - offset };
    offset += p.episodes;
  }
  return null;
}

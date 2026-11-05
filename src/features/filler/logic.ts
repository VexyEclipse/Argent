// Pure filler rules: finding a show on MyAnimeList, reading its episode list, and matching
// Jellyfin's season/episode numbers to MyAnimeList's running numbers. No DOM, no network.

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
    if (!isObj(r) || typeof r.mal_id !== "number") continue;
    const titles = [r.title, r.title_english, r.title_japanese, ...(Array.isArray(r.title_synonyms) ? r.title_synonyms : [])];
    if (Array.isArray(r.titles)) for (const t of r.titles) if (isObj(t)) titles.push(t.title);
    if (!titles.some((t) => typeof t === "string" && normalise(t) === want)) continue;
    const aired = isObj(r.aired) && isObj(r.aired.prop) && isObj(r.aired.prop.from) ? r.aired.prop.from.year : undefined;
    matches.push({ id: r.mal_id, year: typeof r.year === "number" ? r.year : typeof aired === "number" ? aired : undefined });
  }
  if (year) {
    const dated = matches.find((m) => m.year !== undefined && Math.abs(m.year - year) <= 1);
    if (dated) return dated.id;
  }
  return matches.length === 1 && (!year || matches[0].year === undefined) ? matches[0].id : null;
}

/** One page of `/anime/{id}/episodes`: the filler episode numbers, the highest number, and whether more pages follow. */
export function parseEpisodePage(json: unknown): { filler: number[]; last: number; more: boolean } | null {
  if (!isObj(json) || !Array.isArray(json.data)) return null;
  const filler: number[] = [];
  let last = 0;
  for (const e of json.data) {
    if (!isObj(e) || typeof e.mal_id !== "number" || !Number.isInteger(e.mal_id) || e.mal_id <= 0 || e.mal_id > 100_000) continue;
    last = Math.max(last, e.mal_id);
    if (e.filler === true) filler.push(e.mal_id);
  }
  const more = isObj(json.pagination) && json.pagination.has_next_page === true;
  return { filler, last, more };
}

/** The sequel entry (a following TV season) from `/anime/{id}/relations`. */
export function parseSequel(json: unknown): number | null {
  if (!isObj(json) || !Array.isArray(json.data)) return null;
  for (const rel of json.data) {
    if (!isObj(rel) || rel.relation !== "Sequel" || !Array.isArray(rel.entry)) continue;
    for (const e of rel.entry) if (isObj(e) && e.type === "anime" && typeof e.mal_id === "number") return e.mal_id;
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

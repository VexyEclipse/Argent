// Top 10 rules: reading AniList's and TMDB's trending lists, and telling which of their
// titles are already in your library. No DOM, no network.

import type { IndexEntry } from "@/api/libraryIndex";
import { baseTitle, normaliseTitle, titleWords } from "@/api/titles";

export type TrendKind = "anime" | "movies" | "series";
export const TREND_KINDS: TrendKind[] = ["anime", "movies", "series"];
export const KIND_LABEL: Record<TrendKind, string> = { anime: "Anime", movies: "Movies", series: "Series" };

export interface TrendEntry {
  /** "anilist:123", "tmdb-movie:456", "tmdb-tv:789". */
  key: string;
  kind: TrendKind;
  /** Where the list ranks it, from 1. */
  rank: number;
  title: string;
  /** Every name it goes by (English, romaji, native, synonyms, original), for matching. */
  titles: string[];
  year?: number;
  overview?: string;
  poster?: string;
  backdrop?: string;
  /** 0–10. */
  score?: number;
  genres: string[];
  /** The kind of library item it would be. */
  format: "movie" | "series";
  episodes?: number;
  studio?: string;
  /** A YouTube video id. */
  trailer?: string;
  /** Its page on AniList or TMDB. */
  url: string;
  ids: { tmdb?: string; anilist?: string; mal?: string };
  /** Earlier seasons and the work it belongs to (anime), which a library may hold instead. */
  related: { anilist: string[]; mal: string[]; titles: string[] };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** AniList descriptions carry a little HTML (<br>, <i>) and entities. */
export function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

// ---- AniList ------------------------------------------------------------------------------

export const ANILIST_TRENDING_QUERY = `query($n:Int){Page(perPage:$n){media(type:ANIME,sort:TRENDING_DESC,isAdult:false,format_in:[TV,TV_SHORT,ONA,MOVIE]){
id idMal format seasonYear startDate{year} episodes averageScore genres description(asHtml:false) siteUrl
title{romaji english native} synonyms coverImage{extraLarge large} bannerImage trailer{id site}
studios(isMain:true){nodes{name}}
relations{edges{relationType node{id idMal type title{romaji english}}}}}}}`;

export function parseAniList(json: unknown): TrendEntry[] {
  const list = isObj(json) && isObj(json.data) && isObj(json.data.Page) && Array.isArray(json.data.Page.media) ? json.data.Page.media : [];
  const out: TrendEntry[] = [];
  for (const m of list) {
    if (!isObj(m) || typeof m.id !== "number") continue;
    const t = isObj(m.title) ? m.title : {};
    const title = str(t.english) ?? str(t.romaji) ?? str(t.native);
    if (!title) continue;
    const synonyms = Array.isArray(m.synonyms) ? m.synonyms.map(str).filter((s): s is string => Boolean(s)) : [];
    const titles = [...new Set([str(t.english), str(t.romaji), str(t.native), ...synonyms].filter((s): s is string => Boolean(s)))];
    const start = isObj(m.startDate) ? num(m.startDate.year) : undefined;
    const cover = isObj(m.coverImage) ? (str(m.coverImage.extraLarge) ?? str(m.coverImage.large)) : undefined;
    const trailer = isObj(m.trailer) && m.trailer.site === "youtube" ? str(m.trailer.id) : undefined;
    const studios = isObj(m.studios) && Array.isArray(m.studios.nodes) ? m.studios.nodes : [];
    const related: TrendEntry["related"] = { anilist: [], mal: [], titles: [] };
    const edges = isObj(m.relations) && Array.isArray(m.relations.edges) ? m.relations.edges : [];
    for (const e of edges) {
      if (!isObj(e) || !isObj(e.node) || e.node.type !== "ANIME") continue;
      if (e.relationType !== "PREQUEL" && e.relationType !== "PARENT") continue;
      if (typeof e.node.id === "number") related.anilist.push(String(e.node.id));
      if (typeof e.node.idMal === "number") related.mal.push(String(e.node.idMal));
      const nt = isObj(e.node.title) ? e.node.title : {};
      for (const s of [str(nt.english), str(nt.romaji)]) if (s) related.titles.push(s);
    }
    const score = num(m.averageScore);
    out.push({
      key: `anilist:${m.id}`,
      kind: "anime",
      rank: out.length + 1,
      title,
      titles,
      year: num(m.seasonYear) ?? start,
      overview: plainText(str(m.description)),
      poster: cover,
      backdrop: str(m.bannerImage),
      score: score ? Math.round(score) / 10 : undefined,
      genres: Array.isArray(m.genres) ? m.genres.map(str).filter((g): g is string => Boolean(g)) : [],
      format: m.format === "MOVIE" ? "movie" : "series",
      episodes: num(m.episodes),
      studio: studios.map((s) => (isObj(s) ? str(s.name) : undefined)).find(Boolean),
      trailer,
      url: str(m.siteUrl) ?? `https://anilist.co/anime/${m.id}`,
      ids: { anilist: String(m.id), mal: typeof m.idMal === "number" ? String(m.idMal) : undefined },
      related,
    });
  }
  return out;
}

// ---- TMDB ---------------------------------------------------------------------------------

export const TMDB_IMAGE = "https://image.tmdb.org/t/p";
const ANIMATION = 16;

/** Japanese animation: it belongs in Anime, not Series. */
const isAnime = (r: Record<string, unknown>) => r.original_language === "ja" && Array.isArray(r.genre_ids) && r.genre_ids.includes(ANIMATION);

export function parseTmdb(json: unknown, kind: "movies" | "series", genres: Record<number, string> = {}, startRank = 1): TrendEntry[] {
  const list = isObj(json) && Array.isArray(json.results) ? json.results : [];
  const out: TrendEntry[] = [];
  const tv = kind === "series";
  for (const r of list) {
    if (!isObj(r) || typeof r.id !== "number" || r.adult === true) continue;
    if (tv && isAnime(r)) continue;
    const title = str(tv ? r.name : r.title);
    if (!title) continue;
    const original = str(tv ? r.original_name : r.original_title);
    const date = str(tv ? r.first_air_date : r.release_date);
    const year = date ? Number(date.slice(0, 4)) || undefined : undefined;
    const votes = num(r.vote_count) ?? 0;
    const score = num(r.vote_average);
    const poster = str(r.poster_path);
    const backdrop = str(r.backdrop_path);
    out.push({
      key: `tmdb-${tv ? "tv" : "movie"}:${r.id}`,
      kind,
      rank: startRank + out.length,
      title,
      titles: [...new Set([title, original].filter((s): s is string => Boolean(s)))],
      year,
      overview: str(r.overview),
      poster: poster ? `${TMDB_IMAGE}/w342${poster}` : undefined,
      backdrop: backdrop ? `${TMDB_IMAGE}/w1280${backdrop}` : undefined,
      score: votes > 0 && score ? Math.round(score * 10) / 10 : undefined,
      genres: Array.isArray(r.genre_ids) ? r.genre_ids.map((g) => (typeof g === "number" ? genres[g] : undefined)).filter((g): g is string => Boolean(g)) : [],
      format: tv ? "series" : "movie",
      url: `https://www.themoviedb.org/${tv ? "tv" : "movie"}/${r.id}`,
      ids: { tmdb: String(r.id) },
      related: { anilist: [], mal: [], titles: [] },
    });
  }
  return out;
}

export function parseTmdbGenres(json: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (isObj(json) && Array.isArray(json.genres)) for (const g of json.genres) if (isObj(g) && typeof g.id === "number" && str(g.name)) out[g.id] = str(g.name)!;
  return out;
}

/** The YouTube trailer TMDB lists for a title: official trailers first, then teasers. */
export function pickTmdbTrailer(json: unknown): string | undefined {
  const list = isObj(json) && Array.isArray(json.results) ? json.results.filter(isObj) : [];
  const yt = list.filter((v) => v.site === "YouTube" && str(v.key));
  const rank = (v: Record<string, unknown>) => (v.type === "Trailer" ? 0 : v.type === "Teaser" ? 2 : 4) + (v.official === true ? 0 : 1);
  yt.sort((a, b) => rank(a) - rank(b));
  return yt[0] ? str(yt[0].key) : undefined;
}

/** A v4 read-access token (a JWT) goes in a header; a v3 key goes in the query. */
export const isBearerToken = (key: string) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key.trim());

// ---- matching to the library --------------------------------------------------------------

const idIn = (ids: Record<string, string>, names: string[]) => {
  for (const n of names) {
    const v = ids[n];
    if (v && /^\d{1,10}$/.test(v.trim())) return v.trim();
  }
  return undefined;
};
const tmdbOf = (ids: Record<string, string>) => idIn(ids, ["Tmdb", "TMDb", "tmdb"]);
const aniListOf = (ids: Record<string, string>) => idIn(ids, ["AniList", "Anilist", "anilist"]);
const malOf = (ids: Record<string, string>) => idIn(ids, ["MyAnimeList", "Mal", "MAL", "myanimelist"]);

export interface IndexLookup {
  byTmdb: Map<string, IndexEntry[]>;
  byAniList: Map<string, IndexEntry>;
  byMal: Map<string, IndexEntry>;
  byTitle: Map<string, IndexEntry[]>;
  anime: IndexEntry[];
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildLookup(index: IndexEntry[]): IndexLookup {
  const lookup: IndexLookup = { byTmdb: new Map(), byAniList: new Map(), byMal: new Map(), byTitle: new Map(), anime: [] };
  for (const e of index) {
    const tmdb = tmdbOf(e.ids);
    if (tmdb) push(lookup.byTmdb, tmdb, e);
    const al = aniListOf(e.ids);
    if (al && !lookup.byAniList.has(al)) lookup.byAniList.set(al, e);
    const mal = malOf(e.ids);
    if (mal && !lookup.byMal.has(mal)) lookup.byMal.set(mal, e);
    for (const name of [e.name, e.original]) {
      if (!name) continue;
      const n = normaliseTitle(name);
      if (n.length >= MIN_KEY) push(lookup.byTitle, n, e);
      const base = normaliseTitle(baseTitle(name));
      if (base.length >= MIN_KEY && base !== n) push(lookup.byTitle, base, e);
    }
    if (e.anime) lookup.anime.push(e);
  }
  return lookup;
}

/** Names shorter than this ("3", "K") say too little to match by. */
const MIN_KEY = 2;

const typeFor = (entry: TrendEntry) => (entry.format === "movie" ? "Movie" : "Series");
const near = (a?: number, b?: number) => a === undefined || b === undefined || Math.abs(a - b) <= 1;

/** The library item a trending title is, if you have it. */
export function findOwned(entry: TrendEntry, lookup: IndexLookup): string | undefined {
  const type = typeFor(entry);
  const fits = (e: IndexEntry) => e.type === type;

  // By id: exact, so no other checks.
  if (entry.ids.tmdb) {
    const hit = lookup.byTmdb.get(entry.ids.tmdb)?.find(fits);
    if (hit) return hit.id;
  }
  if (entry.kind === "anime") {
    for (const id of [entry.ids.anilist, ...entry.related.anilist]) {
      const hit = id ? lookup.byAniList.get(id) : undefined;
      if (hit && fits(hit)) return hit.id;
    }
    for (const id of [entry.ids.mal, ...entry.related.mal]) {
      const hit = id ? lookup.byMal.get(id) : undefined;
      if (hit && fits(hit)) return hit.id;
    }
  }

  // By name. Films must be from the same year too ("Dune" 1984 and 2021); a show's
  // later season starts years after the show, so anime series are matched by name alone.
  const checkYear = entry.kind !== "anime" || entry.format === "movie";
  const names = entry.kind === "anime" ? [...entry.titles, ...entry.related.titles] : entry.titles;
  const candidates = (key: string) =>
    key.length < MIN_KEY ? [] : (lookup.byTitle.get(key) ?? []).filter((e) => fits(e) && (!checkYear || near(e.year, entry.year)));
  for (const name of names) {
    const hit = candidates(normaliseTitle(name))[0];
    if (hit) return hit.id;
  }
  if (entry.kind !== "anime") return undefined;
  for (const name of names) {
    const base = normaliseTitle(baseTitle(name));
    const hit = base ? candidates(base)[0] : undefined;
    if (hit) return hit.id;
  }

  // A season or arc of a show you have: "Jujutsu Kaisen: The Culling Game" for "Jujutsu
  // Kaisen". Anime libraries only, and only names long enough not to be a coincidence.
  let best: { id: string; length: number } | undefined;
  for (const e of lookup.anime) {
    if (!fits(e)) continue;
    for (const own of [e.name, e.original]) {
      if (!own) continue;
      const words = titleWords(own);
      if (words.length < 2 && normaliseTitle(own).length < 8) continue;
      for (const name of names) {
        const theirs = titleWords(name);
        if (theirs.length <= words.length || !words.every((w, i) => theirs[i] === w)) continue;
        const length = words.join("").length;
        if (!best || length > best.length) best = { id: e.id, length };
      }
    }
  }
  return best?.id;
}

export interface Ranked {
  rank: number;
  entry: TrendEntry;
  /** The library item, when you have it. */
  ownedId?: string;
}

/**
 * The list to show, numbered from 1. With titles you don't have, the list as it stands;
 * without them, only yours. A title you have shows once even when several of its seasons
 * are trending.
 */
export function rankList(entries: TrendEntry[], owned: Map<string, string | undefined>, opts: { includeNotOwned: boolean; limit: number }): Ranked[] {
  const out: Ranked[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const ownedId = owned.get(entry.key);
    if (ownedId) {
      if (seen.has(ownedId)) continue;
      seen.add(ownedId);
    } else if (!opts.includeNotOwned) continue;
    out.push({ rank: out.length + 1, entry, ownedId });
    if (out.length >= opts.limit) break;
  }
  return out;
}

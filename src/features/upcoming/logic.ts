// Pure "what's coming up" rules: which of your shows to check, how to read a TVmaze
// show, and what to announce. No DOM, no network.

import type { BaseItem } from "@/api/types";

/** The parts of a TVmaze show Argent keeps (validated; everything else is dropped). */
export interface ShowSchedule {
  status: string;
  next?: { season: number; number?: number; airstamp: string };
  seasons: { number: number; premiereDate?: string }[];
}

export interface Candidate {
  seriesId: string;
  /** "tvdb:81189" or "imdb:tt0903747": how the show is looked up on TVmaze. */
  ref: string;
}

export type EntryKind = "episode" | "premiere" | "season";

export interface UpcomingEntry {
  seriesId: string;
  kind: EntryKind;
  season: number;
  episode?: number;
  /** ISO date or timestamp; absent when a season is announced without a date. */
  date?: string;
}

const MAX_SHOWS = 250;
const TVDB = /^\d{1,10}$/;
const IMDB = /^tt\d{5,10}$/;

/** How to find a series on TVmaze, from the ids Jellyfin already has. Invalid ids are never sent. */
export function showRef(item: Pick<BaseItem, "ProviderIds">): string | null {
  const ids = item.ProviderIds ?? {};
  const tvdb = ids.Tvdb ?? ids.TheTVDB;
  if (tvdb && TVDB.test(tvdb)) return `tvdb:${tvdb}`;
  const imdb = ids.Imdb ?? ids.IMDB;
  if (imdb && IMDB.test(imdb)) return `imdb:${imdb}`;
  return null;
}

export function parseRef(ref: string): { key: "thetvdb" | "imdb"; value: string } | null {
  const [kind, value = ""] = ref.split(":");
  if (kind === "tvdb" && TVDB.test(value)) return { key: "thetvdb", value };
  if (kind === "imdb" && IMDB.test(value)) return { key: "imdb", value };
  return null;
}

/**
 * Shows worth checking: not ended, and either started, favourited or on your watchlist.
 * Shows you've never touched would only add noise (and requests).
 */
export function pickCandidates(series: BaseItem[], watchlisted: ReadonlySet<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const s of series) {
    if (s.Type !== "Series" || s.Status === "Ended") continue;
    const u = s.UserData;
    const followed = Boolean(u?.Played || (u?.PlayedPercentage ?? 0) > 0 || u?.IsFavorite || watchlisted.has(s.Id));
    if (!followed) continue;
    const ref = showRef(s);
    if (ref) out.push({ seriesId: s.Id, ref });
    if (out.length >= MAX_SHOWS) break;
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000;
const validDate = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** The TVmaze show id from a lookup response, or null. */
export function parseShowId(json: unknown): number | null {
  if (!isObj(json)) return null;
  const id = json.id;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/** Reads `/shows/:id?embed[]=nextepisode&embed[]=seasons`, keeping only well-formed fields. */
export function parseSchedule(json: unknown): ShowSchedule | null {
  if (!isObj(json) || parseShowId(json) === null) return null;
  const status = typeof json.status === "string" ? json.status.slice(0, 40) : "";
  const embedded = isObj(json._embedded) ? json._embedded : {};
  const seasons: ShowSchedule["seasons"] = [];
  if (Array.isArray(embedded.seasons)) {
    for (const s of embedded.seasons) {
      if (!isObj(s) || !posInt(s.number)) continue;
      seasons.push({ number: s.number, premiereDate: validDate(s.premiereDate) ? s.premiereDate : undefined });
    }
  }
  let next: ShowSchedule["next"];
  const n = embedded.nextepisode;
  if (isObj(n) && posInt(n.season)) {
    const airstamp = validDate(n.airstamp) ? n.airstamp : validDate(n.airdate) ? n.airdate : undefined;
    if (airstamp) next = { season: n.season, number: posInt(n.number) ? n.number : undefined, airstamp };
  }
  return { status, next, seasons };
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** What to show for one series: its next episode, else an announced season, else nothing. */
export function entryFor(seriesId: string, schedule: ShowSchedule, now = new Date()): UpcomingEntry | null {
  const today = dayStart(now);
  if (schedule.next && Date.parse(schedule.next.airstamp) >= today) {
    const { season, number, airstamp } = schedule.next;
    return { seriesId, kind: number === 1 ? "premiere" : "episode", season, episode: number, date: airstamp };
  }
  if (schedule.status === "Ended") return null;
  // An announced season: newer than every season that has already started airing.
  const started = schedule.seasons.filter((s) => s.premiereDate && Date.parse(s.premiereDate) < today).map((s) => s.number);
  const latest = Math.max(0, ...started);
  const announced = schedule.seasons.filter((s) => s.number > latest).sort((a, b) => a.number - b.number)[0];
  if (!announced) return null;
  return { seriesId, kind: announced.premiereDate ? "premiere" : "season", season: announced.number, date: announced.premiereDate };
}

/** Dated entries soonest first, then announced seasons without a date. */
export function sortEntries(entries: UpcomingEntry[]): UpcomingEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date && b.date) return Date.parse(a.date) - Date.parse(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.season - b.season;
  });
}

export const entryKey = (e: UpcomingEntry) => `${e.seriesId}:${e.kind === "episode" ? "e" : "s"}${e.season}${e.episode !== undefined ? `:${e.episode}` : ""}`;

/**
 * Desktop notifications worth sending after a check: episodes (and premieres) airing
 * today, and seasons newly announced since the previous check. Each is sent once.
 */
export function notificationsFor(
  previous: Record<string, UpcomingEntry | null> | null,
  current: UpcomingEntry[],
  notified: Record<string, number>,
  now = new Date(),
): UpcomingEntry[] {
  const today = dayStart(now);
  const out: UpcomingEntry[] = [];
  for (const e of current) {
    const key = entryKey(e);
    if (notified[key]) continue;
    const airsToday = e.date !== undefined && dayStart(new Date(e.date)) === today;
    const before = previous?.[e.seriesId];
    // Only a change counts as news; the first check after install announces nothing old.
    const newSeason = e.kind !== "episode" && previous !== null && e.seriesId in previous && (!before || before.season !== e.season || before.kind === "episode");
    if (airsToday || newSeason) out.push(e);
  }
  return out;
}

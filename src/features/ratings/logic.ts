// Pure rating rules: what a finished playback asks you to rate, when it counts as
// finished, and how ratings saved on two devices merge. No DOM, no network.

import type { BaseItem } from "@/api/types";

export type RatedType = "Movie" | "Series" | "Season";

export interface PastRating {
  stars: number;
  note?: string;
  ratedAt: number;
}

export interface RatingEntry {
  /** 1–10 */
  stars: number;
  note?: string;
  ratedAt: number;
  /** Cached so the profile renders before (or without) item metadata. */
  name: string;
  type: RatedType;
  tags?: string[];
  /** The note gives something away; it stays blurred until clicked. */
  spoiler?: boolean;
  /** Earlier ratings of the same title, newest first (the rewatch diary). */
  history?: PastRating[];
  /** Seasons: the series they belong to. */
  seriesId?: string;
  seasonNumber?: number;
}

export interface RatingsState {
  ratings: Record<string, RatingEntry>;
  /** itemId -> ms when the prompt was skipped; it won't ask again. */
  skipped: Record<string, number>;
  /** itemId -> ms when a rating was removed, so a stale device can't bring it back. */
  removed: Record<string, number>;
  /** Up to four pinned favourites shown at the top of the Media profile. */
  showcase: { ids: string[]; at: number };
}

export interface RateTarget {
  id: string;
  name: string;
  type: RatedType;
  seriesId?: string;
  seasonNumber?: number;
}

export const MAX_NOTE = 1000;
export const MAX_SHOWCASE = 4;
const MAX_HISTORY = 20;
const DAY = 86_400_000;
/** A title rated longer ago than this is asked about again when you finish it again. */
export const REWATCH_DAYS = 30;

/** One-tap reasons offered in the prompt. */
export const QUICK_TAGS = [
  "Great ending",
  "Great acting",
  "Beautiful visuals",
  "Amazing soundtrack",
  "Rewatchable",
  "Funny",
  "Emotional",
  "Slow start",
  "Confusing",
  "Overhyped",
];

export const emptyRatings = (): RatingsState => ({ ratings: {}, skipped: {}, removed: {}, showcase: { ids: [], at: 0 } });

/** Fills in fields added after a state was first saved. */
export function normalise(state: Partial<RatingsState> | null | undefined): RatingsState {
  const base = emptyRatings();
  if (!state?.ratings) return base;
  return {
    ratings: state.ratings,
    skipped: state.skipped ?? {},
    removed: state.removed ?? {},
    showcase: state.showcase?.ids ? state.showcase : base.showcase,
  };
}

/**
 * What finishing `item` asks you to rate: the film itself, the whole series after its
 * final episode, or (when `seasons` is on) the season after its last episode. `next`
 * is undefined while the episode list is still loading, and then nothing is asked
 * rather than guessing.
 */
export function ratingTarget(item: BaseItem, next: BaseItem | null | undefined, opts: { seasons?: boolean } = {}): RateTarget | null {
  if (item.Type === "Movie") return { id: item.Id, name: item.Name, type: "Movie" };
  if (item.Type !== "Episode" || next === undefined) return null;
  if (next === null) return item.SeriesId ? { id: item.SeriesId, name: item.SeriesName ?? item.Name, type: "Series" } : null;
  const seasonEnds = item.SeasonId && next.SeasonId !== item.SeasonId;
  const special = item.ParentIndexNumber === 0;
  if (opts.seasons && seasonEnds && !special && item.SeriesId) {
    const season = item.SeasonName ?? (item.ParentIndexNumber ? `Season ${item.ParentIndexNumber}` : "Season");
    return {
      id: item.SeasonId!,
      name: `${item.SeriesName ?? ""} · ${season}`.replace(/^ · /, ""),
      type: "Season",
      seriesId: item.SeriesId,
      seasonNumber: item.ParentIndexNumber,
    };
  }
  return null;
}

/** Reached the credits: the outro segment if there is one, otherwise 90% of the runtime. */
export function isFinished(positionSeconds: number, durationSeconds: number, outroStartSeconds?: number): boolean {
  if (!(durationSeconds > 0)) return false;
  const threshold = outroStartSeconds && outroStartSeconds > durationSeconds * 0.5 ? Math.min(outroStartSeconds, durationSeconds * 0.9) : durationSeconds * 0.9;
  return positionSeconds >= threshold;
}

/** Ask once; ask again only when a title rated a while ago has been watched again. */
export function shouldPrompt(target: RateTarget | null, state: RatingsState, now = Date.now()): target is RateTarget {
  if (!target || state.skipped[target.id]) return false;
  const existing = state.ratings[target.id];
  return !existing || now - existing.ratedAt > REWATCH_DAYS * DAY;
}

export function clampStars(stars: number): number {
  return Math.min(10, Math.max(1, Math.round(stars)));
}

/**
 * The entry after rating `target` again. The previous score moves into the diary when
 * it changed or was given on another day, so fixing a typo doesn't add a line.
 */
export function nextEntry(
  previous: RatingEntry | undefined,
  target: RateTarget,
  input: { stars: number; note?: string; tags?: string[]; spoiler?: boolean },
  now = Date.now(),
): RatingEntry {
  let history = previous?.history ?? [];
  if (previous && (previous.stars !== clampStars(input.stars) || now - previous.ratedAt > DAY)) {
    history = [{ stars: previous.stars, note: previous.note, ratedAt: previous.ratedAt }, ...history].slice(0, MAX_HISTORY);
  }
  const note = input.note?.trim().slice(0, MAX_NOTE) || undefined;
  return {
    stars: clampStars(input.stars),
    note,
    ratedAt: now,
    name: target.name,
    type: target.type,
    tags: input.tags?.length ? [...new Set(input.tags)] : undefined,
    spoiler: note && input.spoiler ? true : undefined,
    history: history.length ? history : undefined,
    seriesId: target.seriesId,
    seasonNumber: target.seasonNumber,
  };
}

export function toggleShowcase(state: RatingsState, id: string, now = Date.now()): RatingsState {
  const ids = state.showcase.ids.includes(id) ? state.showcase.ids.filter((x) => x !== id) : [...state.showcase.ids, id].slice(-MAX_SHOWCASE);
  return { ...state, showcase: { ids, at: now } };
}

// ---- server mirror ----------------------------------------------------------------
// Each title is its own DisplayPreferences key, so two devices only ever compare one
// entry at a time and the newer change wins.

const RATING = "r.";
const SKIP = "s.";
const SHOWCASE = "showcase";

type Removed = { removedAt: number };

export function toCustomPrefs(state: RatingsState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(state.ratings)) out[RATING + id] = JSON.stringify(entry);
  for (const [id, at] of Object.entries(state.removed)) if (!state.ratings[id]) out[RATING + id] = JSON.stringify({ removedAt: at } satisfies Removed);
  for (const [id, at] of Object.entries(state.skipped)) out[SKIP + id] = String(at);
  if (state.showcase.at) out[SHOWCASE] = JSON.stringify(state.showcase);
  return out;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readEntry(value: Partial<RatingEntry>): RatingEntry | null {
  if (!isNum(value.stars) || !isNum(value.ratedAt) || typeof value.name !== "string" || !value.name) return null;
  const history = Array.isArray(value.history)
    ? value.history
        .filter((h) => isNum(h?.stars) && isNum(h?.ratedAt))
        .map((h) => ({ stars: clampStars(h.stars), note: h.note || undefined, ratedAt: h.ratedAt }))
    : [];
  const tags = Array.isArray(value.tags) ? value.tags.filter((t) => typeof t === "string" && t) : [];
  return {
    stars: clampStars(value.stars),
    note: value.note || undefined,
    ratedAt: value.ratedAt,
    name: value.name,
    type: value.type === "Series" || value.type === "Season" ? value.type : "Movie",
    tags: tags.length ? tags : undefined,
    spoiler: value.spoiler ? true : undefined,
    history: history.length ? history : undefined,
    seriesId: value.seriesId || undefined,
    seasonNumber: isNum(value.seasonNumber) ? value.seasonNumber : undefined,
  };
}

export function mergeCustomPrefs(local: RatingsState, prefs: Record<string, string | null> | undefined): RatingsState {
  const merged: RatingsState = { ratings: { ...local.ratings }, skipped: { ...local.skipped }, removed: { ...local.removed }, showcase: local.showcase };
  for (const [key, raw] of Object.entries(prefs ?? {})) {
    if (!raw) continue;
    if (key === SHOWCASE) {
      try {
        const remote = JSON.parse(raw);
        if (Array.isArray(remote?.ids) && isNum(remote.at) && remote.at > merged.showcase.at) {
          merged.showcase = { ids: remote.ids.filter((x: unknown) => typeof x === "string").slice(0, MAX_SHOWCASE), at: remote.at };
        }
      } catch {
        /* ignore */
      }
      continue;
    }
    if (key.startsWith(SKIP)) {
      const id = key.slice(SKIP.length);
      const at = Number(raw);
      if (at && !merged.skipped[id]) merged.skipped[id] = at;
      continue;
    }
    if (!key.startsWith(RATING)) continue;
    const id = key.slice(RATING.length);
    let value: Partial<RatingEntry & Removed>;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const localAt = Math.max(merged.ratings[id]?.ratedAt ?? 0, merged.removed[id] ?? 0);
    if (value.removedAt) {
      if (value.removedAt > localAt) {
        delete merged.ratings[id];
        merged.removed[id] = value.removedAt;
      }
      continue;
    }
    const entry = readEntry(value);
    if (entry && entry.ratedAt > localAt) {
      merged.ratings[id] = entry;
      delete merged.removed[id];
    }
  }
  return merged;
}

/** Folds an imported (or another device's) state in; the newer change wins per title. */
export const mergeStates = (local: RatingsState, incoming: RatingsState) => mergeCustomPrefs(local, toCustomPrefs(incoming));

// ---- profile helpers --------------------------------------------------------------

export type RatingSort = "stars" | "recent" | "title";

export function sortRatings(entries: [string, RatingEntry][], sort: RatingSort): [string, RatingEntry][] {
  const list = [...entries];
  if (sort === "title") list.sort((a, b) => a[1].name.localeCompare(b[1].name));
  else if (sort === "recent") list.sort((a, b) => b[1].ratedAt - a[1].ratedAt);
  else list.sort((a, b) => b[1].stars - a[1].stars || b[1].ratedAt - a[1].ratedAt);
  return list;
}

export function ratingStats(entries: RatingEntry[]) {
  const distribution = Array.from({ length: 10 }, () => 0);
  for (const e of entries) distribution[e.stars - 1]++;
  const average = entries.length ? entries.reduce((s, e) => s + e.stars, 0) / entries.length : 0;
  return { count: entries.length, average, distribution };
}

/** Movies and series only: seasons stay out of top lists so a show can't fill them. */
export const isTitle = (e: RatingEntry) => e.type !== "Season";

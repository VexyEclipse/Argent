// Pure rating rules: what a finished playback asks you to rate, when it counts as
// finished, and how ratings saved on two devices merge. No DOM, no network.

import type { BaseItem } from "@/api/types";

export type RatedType = "Movie" | "Series";

export interface RatingEntry {
  /** 1–10 */
  stars: number;
  note?: string;
  ratedAt: number;
  /** Cached so the profile renders before (or without) item metadata. */
  name: string;
  type: RatedType;
}

export interface RatingsState {
  ratings: Record<string, RatingEntry>;
  /** itemId -> ms when the prompt was skipped; it won't ask again. */
  skipped: Record<string, number>;
  /** itemId -> ms when a rating was removed, so a stale device can't bring it back. */
  removed: Record<string, number>;
}

export interface RateTarget {
  id: string;
  name: string;
  type: RatedType;
}

export const MAX_NOTE = 1000;

export const emptyRatings = (): RatingsState => ({ ratings: {}, skipped: {}, removed: {} });

/**
 * What finishing `item` asks you to rate: the film itself, or the whole series after
 * its final episode. `next` is undefined while the episode list is still loading, and
 * then nothing is asked rather than guessing it was the finale.
 */
export function ratingTarget(item: BaseItem, next: BaseItem | null | undefined): RateTarget | null {
  if (item.Type === "Movie") return { id: item.Id, name: item.Name, type: "Movie" };
  if (item.Type === "Episode" && next === null && item.SeriesId) {
    return { id: item.SeriesId, name: item.SeriesName ?? item.Name, type: "Series" };
  }
  return null;
}

/** Reached the credits: the outro segment if there is one, otherwise 90% of the runtime. */
export function isFinished(positionSeconds: number, durationSeconds: number, outroStartSeconds?: number): boolean {
  if (!(durationSeconds > 0)) return false;
  const threshold = outroStartSeconds && outroStartSeconds > durationSeconds * 0.5 ? Math.min(outroStartSeconds, durationSeconds * 0.9) : durationSeconds * 0.9;
  return positionSeconds >= threshold;
}

export function shouldPrompt(target: RateTarget | null, state: RatingsState): target is RateTarget {
  return Boolean(target && !state.ratings[target.id] && !state.skipped[target.id]);
}

export function clampStars(stars: number): number {
  return Math.min(10, Math.max(1, Math.round(stars)));
}

// ---- server mirror ----------------------------------------------------------------
// Each title is its own DisplayPreferences key, so two devices only ever compare one
// entry at a time and the newer change wins.

const RATING = "r.";
const SKIP = "s.";

type Removed = { removedAt: number };

export function toCustomPrefs(state: RatingsState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(state.ratings)) out[RATING + id] = JSON.stringify(entry);
  for (const [id, at] of Object.entries(state.removed)) if (!state.ratings[id]) out[RATING + id] = JSON.stringify({ removedAt: at } satisfies Removed);
  for (const [id, at] of Object.entries(state.skipped)) out[SKIP + id] = String(at);
  return out;
}

export function mergeCustomPrefs(local: RatingsState, prefs: Record<string, string | null> | undefined): RatingsState {
  const merged: RatingsState = { ratings: { ...local.ratings }, skipped: { ...local.skipped }, removed: { ...local.removed } };
  for (const [key, raw] of Object.entries(prefs ?? {})) {
    if (!raw) continue;
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
    } else if (value.stars && value.ratedAt && value.name && value.ratedAt > localAt) {
      merged.ratings[id] = {
        stars: clampStars(value.stars),
        note: value.note || undefined,
        ratedAt: value.ratedAt,
        name: value.name,
        type: value.type === "Series" ? "Series" : "Movie",
      };
      delete merged.removed[id];
    }
  }
  return merged;
}

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

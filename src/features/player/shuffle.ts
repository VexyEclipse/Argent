// "Play something" and shuffle: a random pick from a library view, from your
// recommendations, or (episode shuffle) the next random episode of a series.

import { getEpisodes, getItems, type ItemQuery } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";

const HISTORY_KEY = "argent.shuffleHistory";

/** One random playable title from a library query (filters kept). Series play their next episode. */
export async function randomFrom(query: ItemQuery): Promise<BaseItem | null> {
  const r = await getItems({ ...query, sortBy: ["Random"], limit: 1, startIndex: 0, enableTotalRecordCount: false });
  return r.Items[0] ?? null;
}

/**
 * Picks from your recommendations: the stronger the pick the likelier, unwatched first,
 * and never the same title twice in a row.
 */
export function pickSomething(items: BaseItem[], previous?: string, random = Math.random): BaseItem | null {
  const pool = items.filter((i) => !i.UserData?.Played && i.Id !== previous).slice(0, 12);
  const list = pool.length ? pool : items.filter((i) => i.Id !== previous);
  if (!list.length) return items[0] ?? null;
  // Weight the top of the list (already ranked) more heavily.
  const weights = list.map((_, i) => 1 / (i + 2));
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

function readHistory(seriesId: string): string[] {
  try {
    const all = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "{}") as Record<string, string[]>;
    return Array.isArray(all[seriesId]) ? all[seriesId] : [];
  } catch {
    return [];
  }
}

function writeHistory(seriesId: string, ids: string[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ [seriesId]: ids }));
  } catch {
    /* ignore */
  }
}

/** A random episode that hasn't come up yet this shuffle (until most of the series has). */
export function pickEpisode(episodes: BaseItem[], played: string[], current?: string, random = Math.random): BaseItem | null {
  const real = episodes.filter((e) => e.LocationType !== "Virtual" && e.Id !== current);
  if (!real.length) return null;
  const seen = new Set(played);
  const fresh = real.filter((e) => !seen.has(e.Id));
  const pool = fresh.length ? fresh : real;
  return pool[Math.floor(random() * pool.length)] ?? null;
}

/** The next episode of a series shuffle; remembers what played (this tab only). */
export async function shuffleEpisode(seriesId: string, current?: string): Promise<BaseItem | null> {
  const episodes = (await getEpisodes(seriesId)).Items;
  const history = readHistory(seriesId);
  const pick = pickEpisode(episodes, history, current);
  if (pick) writeHistory(seriesId, [...history, ...(current ? [current] : []), pick.Id].slice(-Math.max(1, Math.floor(episodes.length * 0.8))));
  return pick;
}

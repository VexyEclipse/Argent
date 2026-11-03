// What your ratings say about your taste: genres you score highest, the people you
// keep rating, and where you disagree most with everyone else.

import type { BaseItem } from "@/api/types";
import { isTitle, type RatingEntry } from "@/features/ratings/logic";

export interface TasteInsights {
  /** Genres with at least two rated titles, best average first. */
  genres: { name: string; average: number; count: number }[];
  /** Actors and directors in at least two rated titles. */
  people: { id: string; name: string; role: string; average: number; count: number }[];
  /** Titles where your score is furthest from the community rating. */
  hotTakes: { id: string; name: string; mine: number; community: number; diff: number }[];
  tags: { tag: string; count: number }[];
}

const MIN_COUNT = 2;

function averages<K>(groups: Map<K, number[]>) {
  return [...groups].filter(([, v]) => v.length >= MIN_COUNT).map(([k, v]) => ({ key: k, average: v.reduce((a, b) => a + b, 0) / v.length, count: v.length }));
}

export function tasteInsights(entries: [string, RatingEntry][], items: Map<string, BaseItem>): TasteInsights {
  const genres = new Map<string, number[]>();
  const people = new Map<string, number[]>();
  const personInfo = new Map<string, { name: string; role: string }>();
  const tags = new Map<string, number>();
  const hotTakes: TasteInsights["hotTakes"] = [];

  for (const [id, e] of entries) {
    e.tags?.forEach((t) => tags.set(t, (tags.get(t) ?? 0) + 1));
    if (!isTitle(e)) continue;
    const item = items.get(id);
    if (!item) continue;
    item.Genres?.forEach((g) => genres.set(g, [...(genres.get(g) ?? []), e.stars]));
    const credited = [...(item.People ?? []).filter((p) => p.Type === "Actor").slice(0, 4), ...(item.People ?? []).filter((p) => p.Type === "Director")];
    for (const p of credited) {
      people.set(p.Id, [...(people.get(p.Id) ?? []), e.stars]);
      if (!personInfo.has(p.Id)) personInfo.set(p.Id, { name: p.Name, role: p.Type === "Director" ? "Director" : "Actor" });
    }
    if (typeof item.CommunityRating === "number") {
      const diff = e.stars - item.CommunityRating;
      if (Math.abs(diff) >= 1.5) hotTakes.push({ id, name: e.name, mine: e.stars, community: item.CommunityRating, diff });
    }
  }

  return {
    genres: averages(genres)
      .sort((a, b) => b.average - a.average || b.count - a.count)
      .map(({ key, average, count }) => ({ name: key, average, count })),
    people: averages(people)
      .sort((a, b) => b.count - a.count || b.average - a.average)
      .slice(0, 8)
      .map(({ key, average, count }) => ({ id: key, ...personInfo.get(key)!, average, count })),
    hotTakes: hotTakes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5),
    tags: [...tags].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })),
  };
}

import type { EngineItem, ScoredItem } from "./types";

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  let inter = 0;
  for (const x of b) if (sa.has(x)) inter++;
  return inter / (sa.size + b.length - inter);
}

export function itemSimilarity(a: EngineItem, b: EngineItem): number {
  const genres = jaccard(a.genres, b.genres);
  const people = a.people.some((p) => b.people.some((q) => q.id === p.id)) ? 1 : 0;
  const sameDecade = a.year && b.year && Math.floor(a.year / 10) === Math.floor(b.year / 10) ? 1 : 0;
  return 0.65 * genres + 0.25 * people + 0.1 * sameDecade;
}

/**
 * Maximal-marginal-relevance selection: each pick balances its own score against how
 * much it resembles what is already chosen, so a row isn't ten near-identical titles.
 */
export function diversify(scored: ScoredItem[], count: number, lambda: number, poolSize = count * 4): ScoredItem[] {
  const pool = scored.slice(0, poolSize);
  if (lambda <= 0) return pool.slice(0, count);
  const chosen: ScoredItem[] = [];
  const top = pool[0]?.score ?? 1;
  const bottom = pool[pool.length - 1]?.score ?? 0;
  const range = Math.max(1e-6, top - bottom);
  while (chosen.length < count && pool.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const relevance = (pool[i].score - bottom) / range;
      let redundancy = 0;
      for (const c of chosen) redundancy = Math.max(redundancy, itemSimilarity(pool[i].item, c.item));
      const value = (1 - lambda) * relevance - lambda * redundancy;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    chosen.push(pool.splice(bestIndex, 1)[0]);
  }
  return chosen;
}

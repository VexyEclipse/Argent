import { decadeOf, type Profile } from "./profile";
import type { EngineItem, ExternalSignals, Feedback, Reason, ScoredItem, Strength, Weights } from "./types";

const DAY = 86_400_000;

export const DEFAULT_WEIGHTS: Weights = {
  genre: 0.24,
  people: 0.17,
  similar: 0.2,
  tags: 0.07,
  studio: 0.04,
  era: 0.07,
  quality: 0.11,
  runtime: 0.03,
  type: 0.05,
  freshness: 0.02,
  impressionPenalty: 0.035,
  negative: 0.12,
  diversity: 0.22,
  rotation: 0.03,
};

/** Stable 0–1 hash of a string; used for the daily rotation jitter. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/**
 * Whether a title is eligible as a *new* recommendation. Anything the user finished,
 * is part-way through (Continue Watching) or is following (Next Up) is excluded.
 */
export function isEligible(item: EngineItem, feedback: Feedback): boolean {
  if (feedback.dismissed[item.id]) return false;
  if (item.user.played) return false;
  if (item.user.progress > 0) return false;
  if (item.type === "Series" && (item.episodesWatched ?? 0) > 0) return false;
  return true;
}

function topWeighted(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  return Math.min(1, sorted[0] + 0.5 * (sorted[1] ?? 0) + 0.25 * (sorted[2] ?? 0)) / 1.0;
}

function genreScore(item: EngineItem, profile: Profile): number {
  if (!item.genres.length) return 0;
  const affs = item.genres.map((g) => profile.genres.get(g) ?? 0).sort((a, b) => b - a);
  const mean = affs.reduce((a, b) => a + b, 0) / affs.length;
  // Best genre carries most weight; mean penalises titles that are mostly off-taste.
  let score = 0.6 * affs[0] + 0.4 * mean;
  // Genre combinations (the closest Jellyfin has to sub-genres).
  const sorted = [...item.genres].sort();
  let pairBest = 0;
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) pairBest = Math.max(pairBest, profile.genrePairs.get(`${sorted[i]}|${sorted[j]}`) ?? 0);
  score = Math.min(1, score + 0.3 * pairBest);
  return score;
}

function eraScore(item: EngineItem, profile: Profile): number {
  const d = decadeOf(item.year);
  if (!d) return 0.3;
  return profile.decades.get(d) ?? 0;
}

function qualityScore(item: EngineItem, profile: Profile): number {
  const community = typeof item.communityRating === "number" ? item.communityRating / 10 : undefined;
  const critic = typeof item.criticRating === "number" ? item.criticRating / 100 : undefined;
  const parts = [community, critic].filter((v): v is number => v !== undefined);
  if (!parts.length) return 0.45;
  const q = parts.reduce((a, b) => a + b, 0) / parts.length;
  // Users who watch well-rated titles get a steeper quality curve.
  const steep = profile.ratingMean > 7 ? 1.4 : 1;
  return Math.max(0, Math.min(1, Math.pow(q, steep)));
}

function runtimeScore(item: EngineItem, profile: Profile): number {
  if (item.type !== "Movie" || !item.runtimeMinutes || !profile.runtimeMedian) return 0.5;
  return Math.exp(-Math.abs(item.runtimeMinutes - profile.runtimeMedian) / 55);
}

function similarScore(item: EngineItem, signals: ExternalSignals, seedWeight: Map<string, number>): { value: number; seedId?: string } {
  const hits = signals.similarHits.get(item.id);
  if (!hits?.length) return { value: 0 };
  let best = 0;
  let seedId: string | undefined;
  let sum = 0;
  for (const h of hits) {
    const v = (seedWeight.get(h.seedId) ?? 0) * (1 - (h.rank / Math.max(1, h.of)) * 0.5);
    sum += v;
    if (v > best) {
      best = v;
      seedId = h.seedId;
    }
  }
  // Similar to several watched titles is a pattern, not a coincidence.
  return { value: Math.min(1, best + 0.35 * (sum - best)), seedId };
}

function peopleScore(item: EngineItem, profile: Profile, signals: ExternalSignals): { value: number; personId?: string } {
  const ids = new Set(signals.personHits.get(item.id) ?? []);
  item.people.forEach((p) => ids.add(p.id));
  let best = 0;
  let personId: string | undefined;
  const values: number[] = [];
  for (const id of ids) {
    const v = profile.people.get(id)?.affinity ?? 0;
    if (!v) continue;
    values.push(v);
    if (v > best) {
      best = v;
      personId = id;
    }
  }
  return { value: topWeighted(values), personId };
}

function explain(
  item: EngineItem,
  c: ScoredItem["components"],
  weights: Weights,
  profile: Profile,
  ctx: { seedId?: string; personId?: string; seedNames: Map<string, string> },
): Reason {
  const contributions: [keyof ScoredItem["components"], number][] = (Object.keys(c) as (keyof ScoredItem["components"])[]).map((k) => [
    k,
    c[k] * (weights[k] as number),
  ]);
  contributions.sort((a, b) => b[1] - a[1]);
  for (const [key] of contributions) {
    if (key === "similar" && ctx.seedId && c.similar > 0.25)
      return { kind: "similar", text: `Because you watched ${ctx.seedNames.get(ctx.seedId) ?? "something similar"}` };
    if (key === "people" && ctx.personId && c.people > 0.3) {
      const p = profile.people.get(ctx.personId);
      if (p) return { kind: "person", text: p.role === "Director" ? `Directed by ${p.name}` : p.role === "Writer" ? `Written by ${p.name}` : `With ${p.name}` };
    }
    if (key === "genre" && c.genre > 0.35) {
      const g = [...item.genres].sort((a, b) => (profile.genres.get(b) ?? 0) - (profile.genres.get(a) ?? 0))[0];
      if (g) return { kind: "genre", text: `Matches your taste in ${g}` };
    }
    if (key === "tags" && c.tags > 0.4) {
      const t = [...item.tags].sort((a, b) => (profile.tags.get(b) ?? 0) - (profile.tags.get(a) ?? 0))[0];
      if (t) return { kind: "tag", text: `More ${t.toLowerCase()}` };
    }
    if (key === "era" && c.era > 0.6 && item.year) return { kind: "era", text: `From the ${decadeOf(item.year)}s you watch most` };
    if (key === "quality" && c.quality > 0.72) return { kind: "quality", text: "Highly rated in your library" };
    if (key === "freshness" && c.freshness > 0.5) return { kind: "new", text: "Recently added" };
  }
  return { kind: "explore", text: "Something different" };
}

export interface ScoreContext {
  profile: Profile;
  signals: ExternalSignals;
  feedback: Feedback;
  weights?: Weights;
  now?: number;
  seedNames?: Map<string, string>;
}

export function scoreCandidates(candidates: EngineItem[], ctx: ScoreContext): ScoredItem[] {
  const weights = ctx.weights ?? DEFAULT_WEIGHTS;
  const now = ctx.now ?? Date.now();
  const { profile, signals, feedback } = ctx;
  const day = Math.floor(now / DAY);
  const seedNames = ctx.seedNames ?? new Map(profile.seeds.map((s) => [s.item.id, s.item.name]));
  const maxSeed = profile.seeds[0]?.weight ?? 1;
  const seedWeight = new Map(profile.seeds.map((s) => [s.item.id, s.weight / maxSeed]));
  const coldStart = profile.totalWeight <= 0;

  const scored: ScoredItem[] = [];
  for (const item of candidates) {
    if (!isEligible(item, feedback)) continue;
    const sim = similarScore(item, signals, seedWeight);
    const ppl = peopleScore(item, profile, signals);
    const tagAffs = item.tags
      .map((t) => profile.tags.get(t) ?? 0)
      .sort((a, b) => b - a)
      .slice(0, 3);
    const addedDays = item.dateAdded ? (now - item.dateAdded) / DAY : 999;
    const components: ScoredItem["components"] = {
      genre: genreScore(item, profile),
      people: ppl.value,
      similar: sim.value,
      tags: tagAffs.length ? tagAffs.reduce((a, b) => a + b, 0) / tagAffs.length : 0,
      studio: Math.max(0, ...item.studios.map((s) => profile.studios.get(s) ?? 0)),
      era: eraScore(item, profile),
      quality: qualityScore(item, profile),
      runtime: runtimeScore(item, profile),
      type: coldStart ? 0.5 : Math.max(0.2, profile.typeShare[item.type]),
      freshness: addedDays < 30 ? 1 - addedDays / 30 : 0,
    };

    let score = 0;
    for (const key of Object.keys(components) as (keyof typeof components)[]) score += components[key] * (weights[key] as number);
    if (coldStart) score = components.quality * 0.6 + components.freshness * 0.25 + hash01(`${item.id}:${day}`) * 0.15;

    // Explicit and implicit negatives.
    const neg = Math.max(0, ...item.genres.map((g) => profile.negativeGenres.get(g) ?? 0));
    score -= neg * weights.negative;
    const imp = feedback.impressions[item.id];
    if (imp && !imp.clicked) {
      const fade = Math.exp(-(now - imp.last) / (7 * DAY));
      score -= weights.impressionPenalty * Math.min(imp.count, 6) * fade;
    }
    // Daily rotation: same day = same order; across days, near-ties trade places.
    score += (hash01(`${item.id}:${day}`) - 0.5) * weights.rotation;

    scored.push({
      item,
      score,
      strength: "exploratory",
      components,
      reason: coldStart
        ? { kind: "quality", text: components.freshness > 0.3 ? "Recently added" : "Highly rated in your library" }
        : explain(item, components, weights, profile, { seedId: sim.seedId, personId: ppl.personId, seedNames }),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  classifyStrength(scored, coldStart);
  return scored;
}

/** Strong = clearly above the pack *and* backed by a specific signal. */
function classifyStrength(scored: ScoredItem[], coldStart: boolean) {
  if (!scored.length) return;
  const at = (q: number) => scored[Math.min(scored.length - 1, Math.floor(scored.length * q))].score;
  const p10 = at(0.1);
  const p35 = at(0.35);
  for (const s of scored) {
    const specific = s.components.similar > 0.3 || s.components.people > 0.4 || s.components.genre > 0.7;
    let strength: Strength = "exploratory";
    if (!coldStart && s.score >= p10 && specific) strength = "strong";
    else if (!coldStart && s.score >= p35) strength = "good";
    s.strength = strength;
  }
}

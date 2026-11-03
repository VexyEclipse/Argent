import { buildProfile, libraryStats, topPeople, type Profile } from "./profile";
import { diversify } from "./rerank";
import { DEFAULT_WEIGHTS, hash01, isEligible, scoreCandidates } from "./score";
import type { EngineItem, ExternalSignals, Feedback, HistorySignal, ScoredItem, Weights } from "./types";

const DAY = 86_400_000;

export interface PersonalSection {
  id: string;
  title: string;
  eyebrow: string;
  items: ScoredItem[];
}

export interface RecommendationResult {
  profile: Profile;
  recommended: ScoredItem[];
  discover: ScoredItem[];
  sections: PersonalSection[];
  /** Whether there is enough history for personalised results. */
  personalised: boolean;
}

export interface EngineInput {
  library: EngineItem[];
  history: HistorySignal[];
  signals: ExternalSignals;
  feedback: Feedback;
  weights?: Weights;
  now?: number;
  limits?: { recommended?: number; discover?: number; section?: number; sections?: number };
}

/**
 * Discover: the long tail of the library. Favors titles that have sat unwatched for a
 * while and rate well, with a daily seeded shuffle so it changes every day.
 */
function discover(scored: ScoredItem[], exclude: Set<string>, count: number, now: number): ScoredItem[] {
  const day = Math.floor(now / DAY);
  const ranked = scored
    .filter((s) => !exclude.has(s.item.id))
    .map((s) => {
      const age = s.item.dateAdded ? (now - s.item.dateAdded) / DAY : 365;
      const overlooked = Math.min(1, age / 180);
      const value = 0.4 * s.components.quality + 0.25 * overlooked + 0.15 * Math.max(0, s.score) + 0.2 * hash01(`${s.item.id}:discover:${day}`);
      return { s, value };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, count * 3);
  // Shuffle the top band so the row reads as discovery, not a second ranking.
  return ranked
    .map((r) => ({ r, k: hash01(`${r.s.item.id}:${day}:order`) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, count)
    .map(({ r }) => ({
      ...r.s,
      reason: { kind: "explore" as const, text: r.s.item.dateAdded && now - r.s.item.dateAdded > 120 * DAY ? "Overlooked in your library" : "Worth a look" },
    }));
}

/** Use each reason at most twice in a row; later cards fall back to their next-best reason. */
function spreadReasons(list: ScoredItem[], maxRepeats = 2): ScoredItem[] {
  const used = new Map<string, number>();
  return list.map((s) => {
    const reason = s.reasons.find((r) => (used.get(r.text) ?? 0) < maxRepeats) ?? s.reason;
    used.set(reason.text, (used.get(reason.text) ?? 0) + 1);
    return reason === s.reason ? s : { ...s, reason };
  });
}

export function recommend(input: EngineInput): RecommendationResult {
  const now = input.now ?? Date.now();
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const limits = { recommended: 20, discover: 18, section: 16, sections: 3, ...input.limits };

  const stats = libraryStats(input.library);
  const dismissedItems = input.library.filter((i) => input.feedback.dismissed[i.id]);
  const profile = buildProfile(input.history, stats, input.feedback, now, dismissedItems);
  const scored = scoreCandidates(input.library, { profile, signals: input.signals, feedback: input.feedback, weights, now });
  const personalised = profile.totalWeight > 0 && profile.historySize >= 2;

  const recommended = spreadReasons(diversify(scored, limits.recommended, weights.diversity));
  const used = new Set(recommended.map((s) => s.item.id));
  // Titles already on screen; each section leads with titles nobody has shown yet.
  const shown = new Set(used);
  const take = (pool: ScoredItem[], minFresh: number): ScoredItem[] | null => {
    const fresh = pool.filter((s) => !shown.has(s.item.id));
    if (fresh.length < minFresh) return null;
    const items = [...fresh, ...pool.filter((s) => shown.has(s.item.id))].slice(0, limits.section);
    items.slice(0, 8).forEach((s) => shown.add(s.item.id));
    return items;
  };

  const sections: PersonalSection[] = [];
  if (personalised) {
    // "Because you watched": strongest recent seeds with enough similar titles.
    for (const seed of profile.seeds.slice(0, 6)) {
      if (sections.filter((s) => s.id.startsWith("seed:")).length >= 2) break;
      const items = take(
        scored.filter((s) => input.signals.similarHits.get(s.item.id)?.some((h) => h.seedId === seed.item.id)),
        4,
      );
      if (items) sections.push({ id: `seed:${seed.item.id}`, eyebrow: "Because you watched", title: seed.item.name, items });
    }

    // A person whose work recurs in the history and has several unwatched titles.
    for (const person of topPeople(profile).sort((a, b) => b.affinity * b.titles - a.affinity * a.titles)) {
      if (person.titles < 2) continue;
      const items = take(
        scored.filter((s) => input.signals.personHits.get(s.item.id)?.includes(person.id)),
        3,
      );
      if (items) {
        sections.push({
          id: `person:${person.id}`,
          eyebrow: person.role === "Director" ? "From the director" : person.role === "Writer" ? "From the writer" : "Starring",
          title: person.name,
          items,
        });
        break;
      }
    }

    // The genre combination the user returns to most.
    const topPair = [...profile.genrePairs.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topPair && topPair[1] > 0.5) {
      const [a, b] = topPair[0].split("|");
      const items = take(
        scored.filter((s) => s.item.genres.includes(a) && s.item.genres.includes(b)),
        5,
      );
      if (items) sections.push({ id: `pair:${topPair[0]}`, eyebrow: "Your kind of", title: `${a} and ${b}`, items });
    }

    // A favoured decade, when it stands out from the library's own mix.
    const topDecade = [...profile.decades.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topDecade && sections.length < limits.sections + 1) {
      const items = take(
        scored.filter((s) => s.item.year && Math.floor(s.item.year / 10) * 10 === topDecade[0]),
        6,
      );
      if (items) sections.push({ id: `decade:${topDecade[0]}`, eyebrow: "A decade you love", title: `The ${topDecade[0]}s`, items });
    }
  }

  // Prefer sections that don't just repeat the main row.
  const ranked = sections
    .map((s) => ({ s, fresh: s.items.filter((i) => !used.has(i.item.id)).length / s.items.length }))
    .sort((a, b) => b.fresh - a.fresh)
    .slice(0, limits.sections)
    .map(({ s }) => s);

  const discoverExclude = new Set(used);
  ranked.forEach((s) => s.items.slice(0, 6).forEach((i) => discoverExclude.add(i.item.id)));

  return {
    profile,
    recommended,
    discover: discover(scored, discoverExclude, limits.discover, now),
    sections: ranked,
    personalised,
  };
}

export { isEligible };

import type { EngineItem, Feedback, HistorySignal, PersonRole } from "./types";

const DAY = 86_400_000;

/** Library-wide frequency of each feature, used to discount ubiquitous ones. */
export interface LibraryStats {
  total: number;
  genres: Map<string, number>;
  tags: Map<string, number>;
  studios: Map<string, number>;
  decades: Map<number, number>;
}

export interface PersonAffinity {
  id: string;
  name: string;
  role: PersonRole;
  affinity: number;
  titles: number;
}

export interface Profile {
  historySize: number;
  totalWeight: number;
  genres: Map<string, number>;
  genrePairs: Map<string, number>;
  tags: Map<string, number>;
  studios: Map<string, number>;
  people: Map<string, PersonAffinity>;
  decades: Map<number, number>;
  typeShare: { Movie: number; Series: number };
  ratingMean: number;
  runtimeMedian?: number;
  /** Features pulled down by dismissals and abandoned titles. */
  negativeGenres: Map<string, number>;
  /** History titles ordered by engagement weight (seeds for "Because you watched"). */
  seeds: { item: EngineItem; weight: number }[];
}

export const decadeOf = (year?: number) => (year ? Math.floor(year / 10) * 10 : undefined);

export function libraryStats(items: EngineItem[]): LibraryStats {
  const stats: LibraryStats = { total: items.length, genres: new Map(), tags: new Map(), studios: new Map(), decades: new Map() };
  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const item of items) {
    item.genres.forEach((g) => bump(stats.genres, g));
    item.tags.forEach((t) => bump(stats.tags, t));
    item.studios.forEach((s) => bump(stats.studios, s));
    const d = decadeOf(item.year);
    if (d) bump(stats.decades, d);
  }
  return stats;
}

/**
 * How much one history title says about taste. Combines completion, recency,
 * rewatching, favourites and explicit ratings. Can be negative (abandoned, disliked).
 */
export function engagementWeight(signal: HistorySignal, now: number): number {
  const { item, completion, plays, lastPlayed } = signal;
  const ageDays = lastPlayed ? Math.max(0, (now - lastPlayed) / DAY) : 365;
  // Old history still counts, recent history counts more (half-life ~4 months).
  const recency = 0.35 + 0.65 * Math.exp(-ageDays / 180);

  let base: number;
  if (signal.abandoned) {
    base = -0.35;
  } else if (item.type === "Series") {
    // Many episodes watched is strong evidence even when the series isn't finished.
    const episodes = signal.episodes ?? 0;
    base = Math.min(1.25, 0.25 + 0.75 * Math.min(1, episodes / 8) + 0.25 * completion);
  } else {
    base = completion >= 0.9 ? 1 : 0.2 + 0.8 * completion;
  }

  const rewatch = plays > 1 ? 1 + 0.25 * Math.min(plays - 1, 4) : 1;
  let explicit = 1;
  if (item.user.favorite) explicit *= 1.6;
  if (item.user.likes === true) explicit *= 1.4;
  if (item.user.likes === false) return -0.6 * recency;
  if (typeof item.user.rating === "number") {
    // A low score is an explicit "not this": 4 → -0.15, 1 → -0.45.
    if (item.user.rating <= 4) return -(0.15 + 0.1 * (4 - Math.max(1, item.user.rating))) * recency;
    explicit *= 0.4 + item.user.rating / 10; // 5→0.9, 8→1.2, 10→1.4
  }

  return base * recency * (base > 0 ? rewatch * explicit : 1);
}

/** 0.36 at one title, 0.6 at two, 0.75 at three: patterns need repetition. */
export const support = (titles: number) => 1 - Math.exp(-titles / 2.2);

function normaliseAffinity(
  raw: Map<string, { weight: number; titles: number }>,
  totalWeight: number,
  libraryCounts: Map<string, number> | null,
  libraryTotal: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (totalWeight <= 0) return out;
  let max = 0;
  for (const [key, { weight, titles }] of raw) {
    if (weight <= 0) continue;
    const share = weight / totalWeight;
    // Lift over the library baseline discounts features everything has (e.g. Drama).
    const libShare = libraryCounts ? Math.max(1, libraryCounts.get(key) ?? 1) / Math.max(1, libraryTotal) : share;
    const lift = Math.min(6, share / libShare);
    const value = Math.pow(share, 0.65) * Math.pow(lift, 0.35) * support(titles);
    out.set(key, value);
    max = Math.max(max, value);
  }
  if (max > 0) for (const [k, v] of out) out.set(k, v / max);
  return out;
}

const ROLE_WEIGHT: Record<PersonRole, number> = { Director: 1.25, Writer: 0.7, Actor: 1 };

export function buildProfile(
  history: HistorySignal[],
  library: LibraryStats,
  feedback: Feedback,
  now = Date.now(),
  dismissedItems: EngineItem[] = [],
): Profile {
  const genres = new Map<string, { weight: number; titles: number }>();
  const pairs = new Map<string, { weight: number; titles: number }>();
  const tags = new Map<string, { weight: number; titles: number }>();
  const studios = new Map<string, { weight: number; titles: number }>();
  const people = new Map<string, { weight: number; titles: number; name: string; role: PersonRole }>();
  const decades = new Map<number, number>();
  const negative = new Map<string, number>();
  const typeWeight = { Movie: 0, Series: 0 };
  const seeds: { item: EngineItem; weight: number }[] = [];
  const ratings: number[] = [];
  const runtimes: number[] = [];
  let totalWeight = 0;

  const add = (m: Map<string, { weight: number; titles: number }>, k: string, w: number) => {
    const cur = m.get(k) ?? { weight: 0, titles: 0 };
    cur.weight += w;
    cur.titles += 1;
    m.set(k, cur);
  };

  for (const signal of history) {
    const w = engagementWeight(signal, now);
    const { item } = signal;
    if (w <= 0) {
      item.genres.forEach((g) => negative.set(g, (negative.get(g) ?? 0) + -w));
      continue;
    }
    totalWeight += w;
    typeWeight[item.type] += w;
    seeds.push({ item, weight: w });

    item.genres.forEach((g) => add(genres, g, w));
    const sorted = [...item.genres].sort();
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) add(pairs, `${sorted[i]}|${sorted[j]}`, w);
    item.tags.forEach((t) => add(tags, t, w));
    item.studios.forEach((s) => add(studios, s, w));

    for (const p of item.people) {
      if (p.role === "Actor" && p.order > 7) continue; // supporting cast says little
      const billing = p.role === "Actor" ? 1 / (1 + p.order * 0.25) : 1;
      const cur = people.get(p.id) ?? { weight: 0, titles: 0, name: p.name, role: p.role };
      cur.weight += w * ROLE_WEIGHT[p.role] * billing;
      cur.titles += 1;
      // A person who directs and acts keeps their strongest role label.
      if (ROLE_WEIGHT[p.role] > ROLE_WEIGHT[cur.role]) cur.role = p.role;
      people.set(p.id, cur);
    }

    const d = decadeOf(item.year);
    if (d) decades.set(d, (decades.get(d) ?? 0) + w);
    if (typeof item.communityRating === "number") ratings.push(item.communityRating);
    if (item.type === "Movie" && item.runtimeMinutes) runtimes.push(item.runtimeMinutes);
  }

  // Dismissed titles are an explicit "not this", weaker than an abandoned watch.
  for (const item of dismissedItems) {
    if (!feedback.dismissed[item.id]) continue;
    item.genres.forEach((g) => negative.set(g, (negative.get(g) ?? 0) + 0.2));
  }

  // People: no library baseline (most people appear once), so use share × support.
  const peopleAff = new Map<string, PersonAffinity>();
  let maxPerson = 0;
  for (const [id, p] of people) {
    const value = (p.weight / Math.max(totalWeight, 1e-9)) ** 0.6 * support(p.titles);
    peopleAff.set(id, { id, name: p.name, role: p.role, affinity: value, titles: p.titles });
    maxPerson = Math.max(maxPerson, value);
  }
  if (maxPerson > 0) for (const p of peopleAff.values()) p.affinity /= maxPerson;

  // Decades: lift over library distribution, smoothed into neighbouring decades.
  const decadeAff = new Map<number, number>();
  if (totalWeight > 0) {
    let max = 0;
    const libTotal = Math.max(
      1,
      [...library.decades.values()].reduce((a, b) => a + b, 0),
    );
    const keys = new Set([...library.decades.keys(), ...decades.keys()]);
    for (const d of keys) {
      const smoothed = (decades.get(d) ?? 0) + 0.3 * ((decades.get(d - 10) ?? 0) + (decades.get(d + 10) ?? 0));
      const share = smoothed / totalWeight;
      const libShare = (library.decades.get(d) ?? 0.5) / libTotal;
      const v = Math.pow(share, 0.7) * Math.pow(Math.min(5, share / libShare + 0.01), 0.3);
      decadeAff.set(d, v);
      max = Math.max(max, v);
    }
    if (max > 0) for (const [k, v] of decadeAff) decadeAff.set(k, v / max);
  }

  const negMax = Math.max(0, ...negative.values());
  if (negMax > 0) for (const [k, v] of negative) negative.set(k, Math.min(1, v / Math.max(negMax, 1)));

  runtimes.sort((a, b) => a - b);
  const typeTotal = typeWeight.Movie + typeWeight.Series || 1;

  return {
    historySize: history.length,
    totalWeight,
    genres: normaliseAffinity(genres, totalWeight, library.genres, library.total),
    genrePairs: normaliseAffinity(pairs, totalWeight, null, library.total),
    tags: normaliseAffinity(tags, totalWeight, library.tags, library.total),
    studios: normaliseAffinity(studios, totalWeight, library.studios, library.total),
    people: peopleAff,
    decades: decadeAff,
    typeShare: { Movie: typeWeight.Movie / typeTotal, Series: typeWeight.Series / typeTotal },
    ratingMean: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 6.5,
    runtimeMedian: runtimes.length ? runtimes[Math.floor(runtimes.length / 2)] : undefined,
    negativeGenres: negative,
    seeds: seeds.sort((a, b) => b.weight - a.weight),
  };
}

/** The people worth querying the server for (their other titles become candidates). */
export function topPeople(profile: Profile, limit = { Actor: 18, Director: 10, Writer: 4 }): PersonAffinity[] {
  const byRole: Record<PersonRole, PersonAffinity[]> = { Actor: [], Director: [], Writer: [] };
  for (const p of profile.people.values()) byRole[p.role].push(p);
  return (Object.keys(byRole) as PersonRole[]).flatMap((role) =>
    byRole[role]
      .filter((p) => p.titles >= (role === "Director" ? 1 : 2) || p.affinity > 0.6)
      .sort((a, b) => b.affinity - a.affinity)
      .slice(0, limit[role]),
  );
}

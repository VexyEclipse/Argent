import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  buildProfile,
  engagementWeight,
  libraryStats,
  recommend,
  scoreCandidates,
  support,
  type EngineItem,
  type ExternalSignals,
  type Feedback,
  type HistorySignal,
} from ".";

const NOW = Date.UTC(2026, 10, 1);
const DAY = 86_400_000;

let n = 0;
function item(partial: Partial<EngineItem> & { genres?: string[] }): EngineItem {
  n++;
  return {
    id: partial.id ?? `i${n}`,
    type: partial.type ?? "Movie",
    name: partial.name ?? `Title ${n}`,
    genres: partial.genres ?? [],
    tags: partial.tags ?? [],
    studios: partial.studios ?? [],
    people: partial.people ?? [],
    year: partial.year ?? 2010,
    communityRating: partial.communityRating ?? 7,
    runtimeMinutes: partial.runtimeMinutes ?? 110,
    dateAdded: partial.dateAdded ?? NOW - 200 * DAY,
    user: { played: false, playCount: 0, progress: 0, favorite: false, ...partial.user },
    episodesWatched: partial.episodesWatched,
    episodesTotal: partial.episodesTotal,
  };
}

const noSignals = (): ExternalSignals => ({ personHits: new Map(), similarHits: new Map() });
const noFeedback = (): Feedback => ({ dismissed: {}, impressions: {} });
const watched = (i: EngineItem, daysAgo = 10, plays = 1): HistorySignal => ({ item: i, completion: 1, plays, lastPlayed: NOW - daysAgo * DAY });

describe("engagement", () => {
  it("weights recent, rewatched, favourite titles higher", () => {
    const base = item({ genres: ["Drama"] });
    const recent = engagementWeight(watched(base, 5), NOW);
    const old = engagementWeight(watched(base, 900), NOW);
    const rewatched = engagementWeight(watched(base, 5, 3), NOW);
    const fav = engagementWeight(watched({ ...base, user: { ...base.user, favorite: true } }, 5), NOW);
    expect(recent).toBeGreaterThan(old);
    expect(rewatched).toBeGreaterThan(recent);
    expect(fav).toBeGreaterThan(recent);
  });

  it("treats abandoned and disliked titles as negative", () => {
    const i = item({ genres: ["Horror"] });
    expect(engagementWeight({ item: i, completion: 0.1, plays: 1, abandoned: true }, NOW)).toBeLessThan(0);
    expect(engagementWeight(watched({ ...i, user: { ...i.user, likes: false } }), NOW)).toBeLessThan(0);
  });

  it("needs repetition before a feature is trusted", () => {
    expect(support(1)).toBeLessThan(support(3));
    expect(support(1)).toBeLessThan(0.4);
  });
});

describe("profile", () => {
  it("discounts genres that dominate the whole library", () => {
    const library = [...Array.from({ length: 40 }, () => item({ genres: ["Drama"] })), ...Array.from({ length: 4 }, () => item({ genres: ["Western"] }))];
    const history = [
      watched(item({ genres: ["Drama", "Western"] })),
      watched(item({ genres: ["Drama", "Western"] })),
      watched(item({ genres: ["Drama", "Western"] })),
    ];
    const profile = buildProfile(history, libraryStats(library), noFeedback(), NOW);
    expect(profile.genres.get("Western")!).toBeGreaterThan(profile.genres.get("Drama")!);
  });
});

describe("scoring", () => {
  const sciFi = () => item({ genres: ["Science Fiction", "Thriller"], communityRating: 7.5 });
  const romcom = () => item({ genres: ["Romance", "Comedy"], communityRating: 7.5 });

  it("ranks titles matching repeated preferences above off-taste ones", () => {
    const history = [watched(sciFi()), watched(sciFi()), watched(sciFi()), watched(romcom(), 400)];
    const a = sciFi();
    const b = romcom();
    const profile = buildProfile(history, libraryStats([a, b]), noFeedback(), NOW);
    const ranked = scoreCandidates([a, b], { profile, signals: noSignals(), feedback: noFeedback(), now: NOW });
    expect(ranked[0].item.id).toBe(a.id);
  });

  it("never recommends watched, in-progress, started-series or dismissed titles", () => {
    const history = [watched(sciFi())];
    const done = sciFi();
    done.user.played = true;
    const partial = sciFi();
    partial.user.progress = 0.4;
    const started = item({ type: "Series", genres: ["Science Fiction"], episodesWatched: 3 });
    const dismissed = sciFi();
    const fresh = sciFi();
    const feedback: Feedback = { dismissed: { [dismissed.id]: NOW }, impressions: {} };
    const pool = [done, partial, started, dismissed, fresh];
    const profile = buildProfile(history, libraryStats(pool), feedback, NOW);
    const ids = scoreCandidates(pool, { profile, signals: noSignals(), feedback, now: NOW }).map((s) => s.item.id);
    expect(ids).toEqual([fresh.id]);
  });

  it("uses Jellyfin similarity and people signals, and explains why", () => {
    const seed = item({ name: "Arrival", genres: ["Science Fiction"] });
    const director = { id: "p1", name: "Denis Villeneuve", role: "Director" as const, order: 0 };
    seed.people = [director];
    const second = item({ genres: ["Science Fiction"], people: [director] });
    const history = [watched(seed, 3), watched(second, 20)];
    const similar = item({ genres: ["Drama"] });
    const byDirector = item({ genres: ["Drama"] });
    const plain = item({ genres: ["Drama"] });
    const signals: ExternalSignals = {
      personHits: new Map([[byDirector.id, ["p1"]]]),
      similarHits: new Map([[similar.id, [{ seedId: seed.id, rank: 0, of: 20 }]]]),
    };
    const pool = [similar, byDirector, plain];
    const profile = buildProfile(history, libraryStats(pool), noFeedback(), NOW);
    const ranked = scoreCandidates(pool, { profile, signals, feedback: noFeedback(), now: NOW });
    expect(ranked.at(-1)!.item.id).toBe(plain.id);
    expect(ranked.find((r) => r.item.id === similar.id)!.reason.text).toContain("Arrival");
    expect(ranked.find((r) => r.item.id === byDirector.id)!.reason.text).toContain("Villeneuve");
  });

  it("demotes titles that keep being shown without being opened", () => {
    const history = [watched(sciFi()), watched(sciFi())];
    const a = sciFi();
    const b = sciFi();
    const feedback: Feedback = { dismissed: {}, impressions: { [a.id]: { count: 6, last: NOW - DAY } } };
    const profile = buildProfile(history, libraryStats([a, b]), feedback, NOW);
    const ranked = scoreCandidates([a, b], { profile, signals: noSignals(), feedback, now: NOW, weights: { ...DEFAULT_WEIGHTS, rotation: 0 } });
    expect(ranked[0].item.id).toBe(b.id);
  });

  it("gives different users different results", () => {
    const pool = [sciFi(), sciFi(), romcom(), romcom()];
    const userA = recommend({
      library: pool,
      history: [watched(sciFi()), watched(sciFi()), watched(sciFi())],
      signals: noSignals(),
      feedback: noFeedback(),
      now: NOW,
    });
    const userB = recommend({
      library: pool,
      history: [watched(romcom()), watched(romcom()), watched(romcom())],
      signals: noSignals(),
      feedback: noFeedback(),
      now: NOW,
    });
    expect(userA.recommended[0].item.genres).toContain("Science Fiction");
    expect(userB.recommended[0].item.genres).toContain("Romance");
  });

  it("falls back to quality and freshness with no history", () => {
    const good = item({ genres: ["Drama"], communityRating: 8.8 });
    const bad = item({ genres: ["Drama"], communityRating: 4.1 });
    const r = recommend({ library: [bad, good], history: [], signals: noSignals(), feedback: noFeedback(), now: NOW });
    expect(r.personalised).toBe(false);
    expect(r.recommended[0].item.id).toBe(good.id);
    expect(r.recommended.every((s) => s.strength === "exploratory")).toBe(true);
  });
});

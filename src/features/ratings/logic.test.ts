import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import {
  emptyRatings,
  isFinished,
  mergeCustomPrefs,
  mergeStates,
  moveWithinScore,
  nextEntry,
  normalise,
  ratingStats,
  ratingTarget,
  setOrder,
  shouldPrompt,
  sortRatings,
  toCustomPrefs,
  toggleShowcase,
  topTiers,
  type RatingEntry,
} from "./logic";

const movie = { Id: "m1", Name: "Heat", Type: "Movie" } as BaseItem;
const episode = {
  Id: "e9",
  Name: "Finale",
  Type: "Episode",
  SeriesId: "s1",
  SeriesName: "Dark",
  SeasonId: "x1",
  SeasonName: "Season 1",
  ParentIndexNumber: 1,
} as BaseItem;
const nextEp = { Id: "e10", Name: "Next", Type: "Episode", SeasonId: "x1" } as BaseItem;
const nextSeason = { Id: "e11", Name: "S2E1", Type: "Episode", SeasonId: "x2" } as BaseItem;
const DAY = 86_400_000;
const entry = (stars: number, ratedAt: number, name = "X"): RatingEntry => ({ stars, ratedAt, name, type: "Movie" });

describe("ratingTarget", () => {
  it("rates a film as itself", () => {
    expect(ratingTarget(movie, undefined)).toEqual({ id: "m1", name: "Heat", type: "Movie" });
  });
  it("rates the series after its final episode", () => {
    expect(ratingTarget(episode, null)).toEqual({ id: "s1", name: "Dark", type: "Series" });
  });
  it("asks nothing mid-season or while the episode list is loading", () => {
    expect(ratingTarget(episode, nextEp, { seasons: true })).toBeNull();
    expect(ratingTarget(episode, undefined, { seasons: true })).toBeNull();
  });
  it("rates the season after its last episode when season ratings are on", () => {
    expect(ratingTarget(episode, nextSeason, { seasons: true })).toEqual({
      id: "x1",
      name: "Dark · Season 1",
      type: "Season",
      seriesId: "s1",
      seasonNumber: 1,
    });
    expect(ratingTarget(episode, nextSeason)).toBeNull();
    expect(ratingTarget({ ...episode, ParentIndexNumber: 0 }, nextSeason, { seasons: true })).toBeNull();
  });
});

describe("isFinished", () => {
  it("counts the outro as finished", () => {
    expect(isFinished(5300, 6000, 5280)).toBe(true);
    expect(isFinished(5200, 6000, 5280)).toBe(false);
  });
  it("falls back to 90% without an outro", () => {
    expect(isFinished(5400, 6000)).toBe(true);
    expect(isFinished(1800, 6000)).toBe(false);
  });
  it("ignores an outro marker that sits implausibly early", () => {
    expect(isFinished(1000, 6000, 900)).toBe(false);
  });
  it("needs a duration", () => {
    expect(isFinished(10, 0)).toBe(false);
  });
});

describe("shouldPrompt", () => {
  const target = { id: "m1", name: "Heat", type: "Movie" as const };
  const now = 100 * DAY;
  it("asks once, then not again after a recent rating or a skip", () => {
    expect(shouldPrompt(target, emptyRatings(), now)).toBe(true);
    expect(shouldPrompt(target, { ...emptyRatings(), ratings: { m1: entry(8, now - DAY) } }, now)).toBe(false);
    expect(shouldPrompt(target, { ...emptyRatings(), skipped: { m1: 1 } }, now)).toBe(false);
    expect(shouldPrompt(null, emptyRatings(), now)).toBe(false);
  });
  it("asks again on a rewatch long after the last rating", () => {
    expect(shouldPrompt(target, { ...emptyRatings(), ratings: { m1: entry(8, now - 40 * DAY) } }, now)).toBe(true);
  });
});

describe("nextEntry", () => {
  const target = { id: "m1", name: "Heat", type: "Movie" as const };
  it("moves the old score into the diary on a rewatch", () => {
    const first = nextEntry(undefined, target, { stars: 9, note: "Great" }, 10 * DAY);
    const second = nextEntry(first, target, { stars: 7 }, 50 * DAY);
    expect(second.stars).toBe(7);
    expect(second.history).toEqual([{ stars: 9, note: "Great", ratedAt: 10 * DAY }]);
  });
  it("doesn't log a same-day edit that keeps the score", () => {
    const first = nextEntry(undefined, target, { stars: 9 }, 10 * DAY);
    expect(nextEntry(first, target, { stars: 9, note: "typo fixed" }, 10 * DAY + 60_000).history).toBeUndefined();
  });
  it("keeps tags, and the spoiler flag only with a note", () => {
    expect(nextEntry(undefined, target, { stars: 8, tags: ["Funny", "Funny"], spoiler: true }).tags).toEqual(["Funny"]);
    expect(nextEntry(undefined, target, { stars: 8, spoiler: true }).spoiler).toBeUndefined();
    expect(nextEntry(undefined, target, { stars: 8, note: "He dies", spoiler: true }).spoiler).toBe(true);
  });
});

describe("showcase", () => {
  it("pins up to four and unpins on a second toggle", () => {
    let s = emptyRatings();
    for (const id of ["a", "b", "c", "d", "e"]) s = toggleShowcase(s, id, 1);
    expect(s.showcase.ids).toEqual(["b", "c", "d", "e"]);
    expect(toggleShowcase(s, "c", 2).showcase.ids).toEqual(["b", "d", "e"]);
  });
});

describe("server mirror", () => {
  it("round-trips ratings, skips, removals and the showcase", () => {
    const rich: RatingEntry = {
      ...entry(9, 10),
      tags: ["Funny"],
      spoiler: true,
      note: "x",
      history: [{ stars: 7, ratedAt: 5 }],
      type: "Season",
      seriesId: "s",
      seasonNumber: 2,
    };
    const state = { ratings: { a: rich }, skipped: { b: 5 }, removed: { c: 7 }, showcase: { ids: ["a"], at: 3 }, order: { ids: ["a"], at: 4 } };
    expect(mergeCustomPrefs(emptyRatings(), toCustomPrefs(state))).toEqual(state);
  });
  it("upgrades states saved before newer fields existed", () => {
    expect(normalise({ ratings: {} } as never)).toEqual(emptyRatings());
  });
  it("imports merge the same way", () => {
    const local = { ...emptyRatings(), ratings: { a: entry(6, 20) } };
    expect(mergeStates(local, { ...emptyRatings(), ratings: { a: entry(2, 10), b: entry(8, 5) } }).ratings).toEqual({ a: entry(6, 20), b: entry(8, 5) });
  });
  it("keeps whichever change is newer", () => {
    const local = { ...emptyRatings(), ratings: { a: entry(6, 20) } };
    const older = toCustomPrefs({ ...emptyRatings(), ratings: { a: entry(9, 10) } });
    const newer = toCustomPrefs({ ...emptyRatings(), ratings: { a: entry(3, 30) } });
    expect(mergeCustomPrefs(local, older).ratings.a.stars).toBe(6);
    expect(mergeCustomPrefs(local, newer).ratings.a.stars).toBe(3);
  });
  it("a newer removal on another device deletes the rating", () => {
    const local = { ...emptyRatings(), ratings: { a: entry(6, 20) } };
    const merged = mergeCustomPrefs(local, toCustomPrefs({ ...emptyRatings(), removed: { a: 25 } }));
    expect(merged.ratings.a).toBeUndefined();
    expect(merged.removed.a).toBe(25);
  });
  it("ignores garbage", () => {
    expect(mergeCustomPrefs(emptyRatings(), { "r.x": "{nope", "r.y": "{}", other: "1" })).toEqual(emptyRatings());
  });
});

describe("profile helpers", () => {
  it("sorts by score, newest first on ties", () => {
    const list = sortRatings(
      [
        ["a", entry(7, 1, "B")],
        ["b", entry(9, 1, "C")],
        ["c", entry(9, 2, "A")],
      ],
      "stars",
    );
    expect(list.map(([id]) => id)).toEqual(["c", "b", "a"]);
  });
  it("computes the distribution and average", () => {
    const stats = ratingStats([entry(10, 1), entry(8, 1), entry(8, 1)]);
    expect(stats.count).toBe(3);
    expect(stats.average).toBeCloseTo(26 / 3);
    expect(stats.distribution[7]).toBe(2);
    expect(stats.distribution[9]).toBe(1);
  });
});

describe("ordering within a score", () => {
  const e = (stars: number, ratedAt: number) => ({ stars, ratedAt, name: `n${stars}-${ratedAt}`, type: "Movie" as const });
  const entries: [string, ReturnType<typeof e>][] = [
    ["a", e(10, 1)],
    ["b", e(10, 2)],
    ["c", e(10, 3)],
    ["d", e(9, 4)],
    ["f", e(9, 5)],
    ["g", e(8, 6)],
  ];
  const ids = (list: [string, unknown][]) => list.map(([id]) => id);

  it("breaks ties by your order, never across scores", () => {
    expect(ids(sortRatings(entries, "stars"))).toEqual(["c", "b", "a", "f", "d", "g"]);
    expect(ids(sortRatings(entries, "stars", ["a", "d", "c"]))).toEqual(["a", "c", "b", "d", "f", "g"]);
    // An order that puts a 9 first still can't lift it above the 10s.
    expect(ids(sortRatings(entries, "stars", ["g", "d", "a"]))).toEqual(["a", "c", "b", "d", "f", "g"]);
  });

  it("moves a title one place within its score only", () => {
    const ranked = sortRatings(entries, "stars");
    expect(moveWithinScore(ranked, "b", -1)).toEqual(["b", "c", "a", "f", "d", "g"]);
    expect(moveWithinScore(ranked, "a", 1)).toBeNull(); // the last 10 can't drop into the 9s
    expect(moveWithinScore(ranked, "f", -1)).toBeNull(); // the first 9 can't rise into the 10s
    expect(moveWithinScore(ranked, "c", -1)).toBeNull();
    expect(moveWithinScore(ranked, "missing", 1)).toBeNull();
  });

  it("shows whole scores around the top 10 cut", () => {
    const ranked = sortRatings(entries, "stars");
    const tiers = topTiers(ranked, 4);
    expect(tiers.map((t) => t.stars)).toEqual([10, 9]);
    // The 9 at rank 5 is outside the top 4 but can be moved up into it.
    expect(tiers[1].titles.map((t) => [t.id, t.rank])).toEqual([
      ["f", 4],
      ["d", 5],
    ]);
  });

  it("syncs the newer order", () => {
    const local = setOrder(emptyRatings(), ["a"], 10);
    const remote = toCustomPrefs(setOrder(emptyRatings(), ["b", "a"], 20));
    expect(mergeCustomPrefs(local, remote).order).toEqual({ ids: ["b", "a"], at: 20 });
    expect(mergeCustomPrefs(setOrder(emptyRatings(), ["c"], 30), remote).order.ids).toEqual(["c"]);
  });
});

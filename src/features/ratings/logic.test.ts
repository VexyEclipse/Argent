import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { emptyRatings, isFinished, mergeCustomPrefs, ratingStats, ratingTarget, shouldPrompt, sortRatings, toCustomPrefs, type RatingEntry } from "./logic";

const movie = { Id: "m1", Name: "Heat", Type: "Movie" } as BaseItem;
const episode = { Id: "e9", Name: "Finale", Type: "Episode", SeriesId: "s1", SeriesName: "Dark" } as BaseItem;
const nextEp = { Id: "e10", Name: "Next", Type: "Episode" } as BaseItem;
const entry = (stars: number, ratedAt: number, name = "X"): RatingEntry => ({ stars, ratedAt, name, type: "Movie" });

describe("ratingTarget", () => {
  it("rates a film as itself", () => {
    expect(ratingTarget(movie, undefined)).toEqual({ id: "m1", name: "Heat", type: "Movie" });
  });
  it("rates the series after its final episode", () => {
    expect(ratingTarget(episode, null)).toEqual({ id: "s1", name: "Dark", type: "Series" });
  });
  it("asks nothing mid-season or while the episode list is loading", () => {
    expect(ratingTarget(episode, nextEp)).toBeNull();
    expect(ratingTarget(episode, undefined)).toBeNull();
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
  it("asks once, then never after a rating or a skip", () => {
    expect(shouldPrompt(target, emptyRatings())).toBe(true);
    expect(shouldPrompt(target, { ...emptyRatings(), ratings: { m1: entry(8, 1) } })).toBe(false);
    expect(shouldPrompt(target, { ...emptyRatings(), skipped: { m1: 1 } })).toBe(false);
    expect(shouldPrompt(null, emptyRatings())).toBe(false);
  });
});

describe("server mirror", () => {
  it("round-trips ratings, skips and removals", () => {
    const state = { ratings: { a: entry(9, 10) }, skipped: { b: 5 }, removed: { c: 7 } };
    expect(mergeCustomPrefs(emptyRatings(), toCustomPrefs(state))).toEqual(state);
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

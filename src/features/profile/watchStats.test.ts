import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { computeWatchStats, computeYearReview, ratingBacklog, reviewYears } from "./watchStats";
import { tasteInsights } from "./insights";

const HOUR = 36_000_000_000; // ticks
const NOW = new Date(Date.UTC(2026, 10, 3));

const movie = (id: string, hours: number, plays = 1, genres: string[] = [], lastPlayed = "2026-05-01T00:00:00Z") =>
  ({
    Id: id,
    Name: id,
    Type: "Movie",
    RunTimeTicks: hours * HOUR,
    Genres: genres,
    UserData: { PlayCount: plays, Played: true, LastPlayedDate: lastPlayed },
  }) as BaseItem;
const episode = (id: string, seriesId: string, lastPlayed = "2025-01-01T00:00:00Z") =>
  ({
    Id: id,
    Name: id,
    Type: "Episode",
    SeriesId: seriesId,
    SeriesName: seriesId,
    RunTimeTicks: 0.5 * HOUR,
    UserData: { PlayCount: 1, Played: true, LastPlayedDate: lastPlayed },
  }) as BaseItem;
const series = (id: string, played: boolean, genres: string[] = []) =>
  ({ Id: id, Name: id, Type: "Series", Genres: genres, UserData: { Played: played } }) as BaseItem;

describe("computeWatchStats", () => {
  const stats = computeWatchStats(
    {
      movies: [movie("m1", 2, 2, ["Drama"]), movie("m2", 1.5, 1, ["Animation"], "2024-01-01T00:00:00Z")],
      episodes: [episode("e1", "s1"), episode("e2", "s1"), episode("e3", "s2", "2026-02-01T00:00:00Z")],
      series: [series("s1", true, ["Drama"]), series("s2", false, ["Animation"]), series("s3", true)],
      animeIds: new Set(["s2", "m2"]),
    },
    NOW,
  );

  it("estimates hours as runtime × plays", () => {
    expect(stats.movieHours).toBeCloseTo(5.5);
    expect(stats.episodeHours).toBeCloseTo(1.5);
    expect(stats.hours).toBeCloseTo(7);
    expect(stats.rewatches).toBe(1);
  });
  it("counts series started and finished, ignoring untouched ones", () => {
    expect(stats.seriesStarted).toBe(2);
    expect(stats.seriesFinished).toBe(1);
    expect(stats.episodes).toBe(3);
  });
  it("splits out anime", () => {
    expect(stats.anime).toEqual({ titles: 2, episodes: 1, hours: 2 });
  });
  it("ranks genres by hours and finds the most watched series", () => {
    expect(stats.topGenres[0]).toEqual({ name: "Drama", hours: 5 });
    expect(stats.mostWatched).toMatchObject({ id: "s1", episodes: 2 });
  });
  it("counts titles played this year", () => {
    expect(stats.thisYear).toBe(2);
  });
});

describe("ratingBacklog", () => {
  const data = {
    movies: [movie("m1", 2, 1, [], "2026-01-01T00:00:00Z"), movie("m2", 2, 1, [], "2026-05-01T00:00:00Z")],
    episodes: [episode("e1", "s1", "2026-03-01T00:00:00Z"), episode("e2", "s2", "2026-09-01T00:00:00Z")],
    series: [series("s1", true), series("s2", false), series("s3", true)],
  };
  it("lists unrated watched films and finished series, latest first", () => {
    expect(ratingBacklog(data, {}).map((i) => i.Id)).toEqual(["m2", "s1", "m1"]);
    expect(ratingBacklog(data, { m2: true }).map((i) => i.Id)).toEqual(["s1", "m1"]);
  });
});

describe("computeYearReview", () => {
  const data = {
    movies: [movie("m1", 2, 3, ["Drama"], "2026-06-01T00:00:00Z"), movie("m2", 3, 1, ["Crime"], "2025-06-01T00:00:00Z")],
    episodes: [episode("e1", "s1", "2026-02-01T00:00:00Z"), episode("e2", "s1", "2026-02-02T00:00:00Z"), episode("e3", "s2", "2026-03-01T00:00:00Z")],
    series: [series("s1", true, ["Drama"]), series("s2", false, ["Comedy"])],
  };
  it("covers only titles last played that year, one viewing each", () => {
    const r = computeYearReview(data, 2026);
    expect(r.hours).toBeCloseTo(3.5);
    expect([r.movies, r.episodes, r.series]).toEqual([1, 3, 2]);
    expect(r.mostBinged).toMatchObject({ id: "s1", episodes: 2 });
    expect(r.topGenres[0]).toEqual({ name: "Drama", hours: 3 });
    expect(r.longestMovie).toMatchObject({ id: "m1" });
  });
  it("lists the years with history", () => {
    expect(reviewYears(data)).toEqual([2026, 2025]);
  });
});

describe("tasteInsights", () => {
  const e = (stars: number, name: string, tags?: string[]) => ({ stars, name, ratedAt: 1, type: "Movie" as const, tags });
  const it_ = (id: string, genres: string[], community: number, people: string[] = []) =>
    ({
      Id: id,
      Name: id,
      Type: "Movie",
      Genres: genres,
      CommunityRating: community,
      People: people.map((p) => ({ Id: p, Name: p, Type: "Actor" })),
    }) as BaseItem;
  const items = new Map([
    ["a", it_("a", ["Drama"], 7, ["p1"])],
    ["b", it_("b", ["Drama", "Crime"], 8, ["p1"])],
    ["c", it_("c", ["Crime"], 8.5)],
    ["d", it_("d", ["Comedy"], 7)],
  ]);
  const r = tasteInsights(
    [
      ["a", e(9, "A", ["Funny"])],
      ["b", e(8, "B", ["Funny", "Emotional"])],
      ["c", e(4, "C")],
      ["d", e(7, "D")],
    ],
    items,
  );
  it("averages genres with two or more ratings", () => {
    expect(r.genres).toEqual([
      { name: "Drama", average: 8.5, count: 2 },
      { name: "Crime", average: 6, count: 2 },
    ]);
  });
  it("finds people you keep rating", () => {
    expect(r.people[0]).toMatchObject({ id: "p1", count: 2, average: 8.5 });
  });
  it("flags big disagreements with the community", () => {
    expect(r.hotTakes.map((h) => h.id)).toEqual(["c", "a"]);
  });
  it("counts tags", () => {
    expect(r.tags[0]).toEqual({ tag: "Funny", count: 2 });
  });
});

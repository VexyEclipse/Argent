import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { computeWatchStats } from "./watchStats";

const HOUR = 36_000_000_000; // ticks
const NOW = new Date(Date.UTC(2026, 10, 3));

const movie = (id: string, hours: number, plays = 1, genres: string[] = [], lastPlayed = "2026-05-01T00:00:00Z") =>
  ({ Id: id, Name: id, Type: "Movie", RunTimeTicks: hours * HOUR, Genres: genres, UserData: { PlayCount: plays, Played: true, LastPlayedDate: lastPlayed } }) as BaseItem;
const episode = (id: string, seriesId: string, lastPlayed = "2025-01-01T00:00:00Z") =>
  ({ Id: id, Name: id, Type: "Episode", SeriesId: seriesId, SeriesName: seriesId, RunTimeTicks: 0.5 * HOUR, UserData: { PlayCount: 1, Played: true, LastPlayedDate: lastPlayed } }) as BaseItem;
const series = (id: string, played: boolean, genres: string[] = []) => ({ Id: id, Name: id, Type: "Series", Genres: genres, UserData: { Played: played } }) as BaseItem;

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

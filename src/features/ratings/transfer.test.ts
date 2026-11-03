import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { emptyRatings, type RatingEntry } from "./logic";
import { fromJson, parseCsv, pickMatch, rowsFromCsv, toCsv, toJson } from "./transfer";

const entry = (stars: number, name: string, extra: Partial<RatingEntry> = {}): RatingEntry => ({
  stars,
  name,
  ratedAt: Date.UTC(2026, 0, 2),
  type: "Movie",
  ...extra,
});

describe("JSON", () => {
  it("round-trips everything", () => {
    const state = { ...emptyRatings(), ratings: { a: entry(9, "Heat", { note: "x", tags: ["Funny"] }) }, showcase: { ids: ["a"], at: 4 } };
    expect(fromJson(toJson(state))).toEqual(state);
  });
  it("rejects other files", () => {
    expect(fromJson('{"foo":1}')).toBeNull();
    expect(fromJson("nope")).toBeNull();
  });
});

describe("CSV", () => {
  it("parses quotes, commas and newlines", () => {
    expect(parseCsv('a,"b, c","say ""hi""\nthere"\r\n1,2,3\n')).toEqual([
      ["a", "b, c", 'say "hi"\nthere'],
      ["1", "2", "3"],
    ]);
  });
  it("round-trips Argent's own export", () => {
    const items = new Map([["a", { Id: "a", Name: "Heat", Type: "Movie", ProductionYear: 1995, ProviderIds: { Tmdb: "949" } } as BaseItem]]);
    const csv = toCsv([["a", entry(9, "Heat", { note: 'Tense, "great"', tags: ["Rewatchable"] })]], items);
    expect(rowsFromCsv(csv)).toEqual([
      {
        title: "Heat",
        year: 1995,
        stars: 9,
        note: 'Tense, "great"',
        date: Date.UTC(2026, 0, 2),
        tags: ["Rewatchable"],
        tmdb: "949",
        imdb: undefined,
        type: "Movie",
      },
    ]);
  });
  it("leaves seasons out of the CSV", () => {
    expect(
      toCsv([["s", entry(8, "Dark · Season 1", { type: "Season" })]], new Map())
        .trim()
        .split("\r\n"),
    ).toHaveLength(1);
  });
  it("reads a Letterboxd export, doubling the 5-star scale", () => {
    const csv = "Date,Name,Year,Letterboxd URI,Rating\n2024-03-01,Arrival,2016,https://boxd.it/x,4.5\n2024-03-02,No score,2010,https://boxd.it/y,\n";
    expect(rowsFromCsv(csv)).toMatchObject([{ title: "Arrival", year: 2016, stars: 9 }]);
  });
});

describe("pickMatch", () => {
  const lib = [
    { Id: "1", Name: "Dune", Type: "Movie", ProductionYear: 1984 },
    { Id: "2", Name: "Dune", Type: "Movie", ProductionYear: 2021, ProviderIds: { Tmdb: "438631" } },
    { Id: "3", Name: "Amélie", Type: "Movie", ProductionYear: 2001 },
  ] as BaseItem[];
  it("prefers a provider id, then title and year", () => {
    expect(pickMatch({ title: "Dune", stars: 8, tmdb: "438631" }, lib)?.Id).toBe("2");
    expect(pickMatch({ title: "Dune", stars: 8, year: 1984 }, lib)?.Id).toBe("1");
    expect(pickMatch({ title: "amelie", stars: 8, year: 2001 }, lib)?.Id).toBe("3");
    expect(pickMatch({ title: "Dune", stars: 8, year: 1999 }, lib)).toBeNull();
  });
});

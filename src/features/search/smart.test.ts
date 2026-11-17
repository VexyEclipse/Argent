import { describe, expect, it } from "vitest";
import { fuzzyFind, titleScore } from "./fuzzy";
import { isSmart, parseDuration, parseSmartQuery } from "./smart";

const GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Drama",
  "Horror",
  "Romance",
  "Science Fiction",
  "Sci-Fi & Fantasy",
  "Thriller",
  "Isekai",
  "Anime",
  "Talk",
];
const now = new Date("2026-11-18T12:00:00Z");
const parse = (s: string) => parseSmartQuery(s, { genres: GENRES, now });

describe("parseSmartQuery", () => {
  it("reads decade, genre, kind and running time", () => {
    const q = parse("90s comedies under 2 hours");
    expect(q.years).toEqual({ from: 1990, to: 1999 });
    expect(q.genres).toEqual([["Comedy"]]);
    expect(q.maxMinutes).toBe(120);
    expect(q.text).toBe("");
    expect(q.chips.map((c) => c.label)).toEqual(["1990–1999", "Under 2 h", "Comedy"]);
  });

  it("finds a studio or person after from/by, and the kind", () => {
    const q = parse("anime from MAPPA");
    expect(q.maker).toBe("MAPPA");
    expect(q.kinds).toEqual(["Anime"]);
    expect(q.genres).toEqual([]);
  });

  it("reads a person, watched state and kind", () => {
    const q = parse("unwatched films with Tom Hanks");
    expect(q.person).toBe("Tom Hanks");
    expect(q.played).toBe(false);
    expect(q.kinds).toEqual(["Movie"]);
    expect(q.text).toBe("");
  });

  it("reads 'like' only where it can't be part of a title", () => {
    expect(parse("something like Interstellar").like).toBe("Interstellar");
    expect(parse("anime like Frieren")).toMatchObject({ like: "Frieren", kinds: ["Anime"] });
    const title = parse("Some Like It Hot");
    expect(title.like).toBeUndefined();
    expect(isSmart(title)).toBe(false);
    expect(title.text).toBe("Some Like It Hot");
  });

  it("leaves a year that's part of a title alone", () => {
    const q = parse("Blade Runner 2049");
    expect(q.years).toBeUndefined();
    expect(q.text).toBe("Blade Runner 2049");
    expect(isSmart(q)).toBe(false);
    expect(parse("2019 thrillers")).toMatchObject({ years: { from: 2019, to: 2019 }, genres: [["Thriller"]], text: "" });
  });

  it("maps everyday words to the server's genres", () => {
    expect(parse("scary movies").genres).toEqual([["Horror"]]);
    expect(parse("sci-fi").genres).toEqual([["Science Fiction", "Sci-Fi & Fantasy"]]);
    expect(parse("romcoms").genres).toEqual([["Romance"], ["Comedy"]]);
    expect(parse("isekai")).toMatchObject({ genres: [["Isekai"]], kinds: [] });
  });

  it("reads ratings, ranges and order", () => {
    expect(parse("horror rated 7.5+").minRating).toBe(7.5);
    expect(parse("highly rated dramas")).toMatchObject({ minRating: 7.5, sort: "rating" });
    expect(parse("movies between 2010 and 2015").years).toEqual({ from: 2010, to: 2015 });
    expect(parse("films before 1980").years).toEqual({ from: 1800, to: 1979 });
    expect(parse("recent anime")).toMatchObject({ years: { from: 2024, to: 2026 }, sort: "newest", kinds: ["Anime"] });
    expect(parse("classics")).toMatchObject({ years: { from: 1800, to: 1979 } });
  });

  it("keeps the title words beside filters", () => {
    const q = parse("batman movies from the 90s");
    expect(q.text).toBe("batman");
    expect(q.kinds).toEqual(["Movie"]);
    expect(q.years).toEqual({ from: 1990, to: 1999 });
  });

  it("marks where each chip was said", () => {
    const input = "90s comedies";
    const q = parse(input);
    expect(q.chips.map((c) => input.slice(...c.span))).toEqual(["90s", "comedies"]);
  });

  it("reads durations", () => {
    expect(parseDuration("90 min")).toBe(90);
    expect(parseDuration("1h30")).toBe(90);
    expect(parseDuration("an hour and a half")).toBe(90);
    expect(parseDuration("two hours")).toBe(120);
  });
});

describe("fuzzy titles", () => {
  const titles = [
    { id: "1", name: "Frieren: Beyond Journey's End", original: "Sousou no Frieren" },
    { id: "2", name: "Interstellar" },
    { id: "3", name: "Spider-Man: Into the Spider-Verse" },
    { id: "4", name: "The Office" },
    { id: "5", name: "Inception" },
  ];

  it("finds a title despite typos", () => {
    expect(fuzzyFind("frieran", titles)[0]?.entry.id).toBe("1");
    expect(fuzzyFind("intresteller", titles)[0]?.entry.id).toBe("2");
    expect(fuzzyFind("spiderman into the spiderverse", titles)[0]?.entry.id).toBe("3");
    expect(fuzzyFind("sousou no frieren", titles)[0]?.entry.id).toBe("1");
  });

  it("doesn't match unrelated titles", () => {
    expect(fuzzyFind("office", titles).map((r) => r.entry.id)).toEqual(["4"]);
    expect(fuzzyFind("zzz", titles)).toEqual([]);
    expect(titleScore("dune", "Inception")).toBe(0);
  });
});

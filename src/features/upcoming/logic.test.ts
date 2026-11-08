import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { entryFor, entryKey, newArrivals, notificationsFor, parseRef, parseSchedule, pickCandidates, showRef, sortEntries, type UpcomingEntry } from "./logic";

const NOW = new Date(2026, 10, 4, 12, 0);
const day = (offset: number) => new Date(2026, 10, 4 + offset, 21, 0).toISOString();
const date = (offset: number) => {
  const d = new Date(2026, 10, 4 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const series = (id: string, extra: Partial<BaseItem> = {}): BaseItem => ({
  Id: id,
  Name: id,
  Type: "Series",
  Status: "Continuing",
  ProviderIds: { Tvdb: "12345" },
  UserData: { PlayedPercentage: 40 },
  ...extra,
});

describe("show lookup ids", () => {
  it("prefers TVDB, falls back to IMDb, and rejects anything malformed", () => {
    expect(showRef({ ProviderIds: { Tvdb: "81189", Imdb: "tt0903747" } })).toBe("tvdb:81189");
    expect(showRef({ ProviderIds: { Imdb: "tt0903747" } })).toBe("imdb:tt0903747");
    expect(showRef({ ProviderIds: { Tvdb: "81189&x=1", Imdb: "../evil" } })).toBeNull();
    expect(showRef({})).toBeNull();
    expect(parseRef("tvdb:81189")).toEqual({ key: "thetvdb", value: "81189" });
    expect(parseRef("tvdb:1/../2")).toBeNull();
    expect(parseRef("other:1")).toBeNull();
  });
});

describe("pickCandidates", () => {
  it("checks shows you follow that haven't ended", () => {
    const picked = pickCandidates(
      [
        series("started"),
        series("ended", { Status: "Ended" }),
        series("untouched", { UserData: {} }),
        series("favourite", { UserData: { IsFavorite: true } }),
        series("listed", { UserData: {} }),
        series("caught-up", { UserData: { Played: true } }),
        series("no-ids", { ProviderIds: {} }),
        { ...series("movie"), Type: "Movie" },
      ],
      new Set(["listed"]),
    );
    expect(picked.map((c) => c.seriesId)).toEqual(["started", "favourite", "listed", "caught-up"]);
  });
});

describe("parseSchedule", () => {
  it("keeps the next episode and seasons", () => {
    const s = parseSchedule({
      id: 1,
      status: "Running",
      _embedded: {
        nextepisode: { season: 2, number: 4, airstamp: day(1) },
        previousepisode: { season: 2, number: 3, airdate: date(-6) },
        seasons: [{ number: 1, premiereDate: "2025-01-01" }, { number: 2, premiereDate: "2026-10-01" }, { number: 3 }],
      },
    });
    expect(s?.next).toEqual({ season: 2, number: 4, airstamp: day(1) });
    expect(s?.previous).toEqual({ season: 2, number: 3, airstamp: date(-6) });
    expect(s?.seasons).toEqual([{ number: 1, premiereDate: "2025-01-01" }, { number: 2, premiereDate: "2026-10-01" }, { number: 3, premiereDate: undefined }]);
  });

  it("drops malformed and hostile fields", () => {
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule({ id: "1" })).toBeNull();
    const s = parseSchedule({
      id: 2,
      status: { evil: true },
      _embedded: { nextepisode: { season: "2", airstamp: "<script>" }, seasons: [{ number: -1 }, { number: 1.5 }, "x", { number: 2, premiereDate: "not a date" }] },
    });
    expect(s).toEqual({ status: "", next: undefined, seasons: [{ number: 2, premiereDate: undefined }] });
  });
});

describe("entryFor", () => {
  const base = { status: "Running", seasons: [{ number: 1, premiereDate: "2024-01-01" }, { number: 2, premiereDate: "2026-10-01" }] };

  it("shows the next episode, marking season premieres", () => {
    expect(entryFor("s", { ...base, next: { season: 2, number: 6, airstamp: day(2) } }, NOW)).toEqual({ seriesId: "s", kind: "episode", season: 2, episode: 6, date: day(2) });
    expect(entryFor("s", { ...base, next: { season: 3, number: 1, airstamp: day(30) } }, NOW)?.kind).toBe("premiere");
  });

  it("announces a season that has no episodes scheduled yet", () => {
    expect(entryFor("s", { ...base, seasons: [...base.seasons, { number: 3 }] }, NOW)).toEqual({ seriesId: "s", kind: "season", season: 3, date: undefined });
    expect(entryFor("s", { ...base, seasons: [...base.seasons, { number: 3, premiereDate: date(90) }] }, NOW)).toEqual({ seriesId: "s", kind: "premiere", season: 3, date: date(90) });
  });

  it("shows nothing for a show between seasons with nothing announced, or that ended", () => {
    expect(entryFor("s", base, NOW)).toBeNull();
    expect(entryFor("s", { ...base, status: "Ended", seasons: [...base.seasons, { number: 3 }] }, NOW)).toBeNull();
  });

  it("ignores a stale 'next' episode that already aired", () => {
    expect(entryFor("s", { ...base, next: { season: 2, number: 2, airstamp: day(-3) } }, NOW)).toBeNull();
  });

  it("keeps an episode that aired today until the day is over, then moves on", () => {
    // TVmaze moves "next" on as soon as an episode airs.
    const show = { ...base, previous: { season: 2, number: 2, airstamp: new Date(2026, 10, 4, 9, 0).toISOString() }, next: { season: 2, number: 3, airstamp: day(7) } };
    expect(entryFor("s", show, NOW)).toMatchObject({ season: 2, episode: 2 });
    expect(entryFor("s", show, new Date(2026, 10, 5, 0, 30))).toMatchObject({ season: 2, episode: 3 });
    expect(entryFor("s", show, new Date(2026, 10, 6, 12, 0))).toMatchObject({ season: 2, episode: 3 });
  });

  it("drops episodes already in the library", () => {
    const have = (id: string, season: number, ep: number) => id === "s" && season === 2 && ep === 2;
    const show = { ...base, previous: { season: 2, number: 2, airstamp: new Date(2026, 10, 4, 9, 0).toISOString() }, next: { season: 2, number: 3, airstamp: day(7) } };
    expect(entryFor("s", show, NOW, have)).toMatchObject({ season: 2, episode: 3 });
    expect(entryFor("s", { ...base, next: { season: 2, number: 2, airstamp: day(1) } }, NOW, have)).toBeNull();
  });
});

describe("sortEntries", () => {
  it("puts dated entries first, soonest first", () => {
    const e = (id: string, d?: string): UpcomingEntry => ({ seriesId: id, kind: d ? "episode" : "season", season: 1, date: d });
    expect(sortEntries([e("tba"), e("later", day(5)), e("soon", day(1))]).map((x) => x.seriesId)).toEqual(["soon", "later", "tba"]);
  });
});

describe("notificationsFor", () => {
  const today: UpcomingEntry = { seriesId: "a", kind: "episode", season: 2, episode: 5, date: day(0) };
  const announced: UpcomingEntry = { seriesId: "b", kind: "season", season: 3 };

  it("announces episodes airing today, once", () => {
    expect(notificationsFor(null, [today], {}, NOW)).toEqual([today]);
    expect(notificationsFor(null, [today], { [entryKey(today)]: 1 }, NOW)).toEqual([]);
  });

  it("announces a new season only when it changed since the last check", () => {
    // First check ever: nothing to compare with, so no flood of old news.
    expect(notificationsFor(null, [announced], {}, NOW)).toEqual([]);
    expect(notificationsFor({ b: { seriesId: "b", kind: "episode", season: 2, episode: 9, date: day(-30) } }, [announced], {}, NOW)).toEqual([announced]);
    expect(notificationsFor({ b: null }, [announced], {}, NOW)).toEqual([announced]);
    expect(notificationsFor({ b: announced }, [announced], {}, NOW)).toEqual([]);
    // A show checked for the first time isn't news either.
    expect(notificationsFor({}, [announced], {}, NOW)).toEqual([]);
  });
});

describe("NEW badges", () => {
  const ep = (id: string, seriesId: string, s: number, e: number, addedDaysAgo: number, airedDaysAgo: number, extra: Partial<BaseItem> = {}): BaseItem => ({
    Id: id,
    Name: id,
    Type: "Episode",
    SeriesId: seriesId,
    ParentIndexNumber: s,
    IndexNumber: e,
    DateCreated: new Date(NOW.getTime() - addedDaysAgo * 86_400_000).toISOString(),
    PremiereDate: new Date(NOW.getTime() - airedDaysAgo * 86_400_000).toISOString(),
    UserData: { Played: false },
    ...extra,
  });

  it("calls out a new season, new episodes, and a brand-new series", () => {
    const badges = newArrivals(
      [ep("a1", "A", 3, 1, 2, 3), ep("a2", "A", 3, 2, 1, 1), ep("b5", "B", 2, 5, 1, 2), ep("b6", "B", 2, 6, 1, 1), ep("c1", "C", 1, 1, 1, 1), ep("d4", "D", 1, 4, 1, 1)],
      NOW,
    );
    expect(badges.get("A")).toEqual({ badge: "New season", latest: expect.objectContaining({ Id: "a2" }) });
    expect(badges.get("B")?.badge).toBe("New episodes");
    expect(badges.get("C")?.badge).toBe("New series");
    expect(badges.get("D")?.badge).toBe("New episode");
  });

  it("ignores old shows added today, old additions, specials and what you've watched", () => {
    const badges = newArrivals(
      [
        ep("old", "A", 1, 1, 1, 400),
        ep("stale", "B", 2, 1, 30, 31),
        ep("special", "C", 0, 1, 1, 1),
        ep("seen", "D", 2, 3, 1, 1, { UserData: { Played: true } }),
        ep("virtual", "E", 2, 3, 1, 1, { LocationType: "Virtual" }),
      ],
      NOW,
    );
    expect(badges.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { absoluteNumbers, aniListIdOf, checkNeeded, locate, parseEpisodeTitles, isSettled, mergePages, SETTLE_MS, tailPage, WEEKLY_MS, fillerEpisodeIds, hasAnimeIds, isTvEntry, malIdOf, parseEpisodePage, parseSequel, pickSearchMatch } from "./logic";

const ep = (id: string, s: number, e: number): BaseItem => ({ Id: id, Name: id, Type: "Episode", ParentIndexNumber: s, IndexNumber: e });

describe("ids", () => {
  it("reads MyAnimeList and AniList ids and rejects anything malformed", () => {
    expect(malIdOf({ MyAnimeList: "20" })).toBe(20);
    expect(malIdOf({ Mal: "20&x" })).toBeNull();
    expect(aniListIdOf({ AniList: "20" })).toBe(20);
    expect(hasAnimeIds({ AniDB: "239" })).toBe(true);
    expect(hasAnimeIds({ Tvdb: "1" })).toBe(false);
  });
});

describe("search match", () => {
  const results = {
    data: [
      { mal_id: 1, title: "Naruto", year: 2002, title_synonyms: [] },
      { mal_id: 2, title: "Naruto", year: 2023 },
      { mal_id: 3, title: "Boruto: Naruto Next Generations", year: 2017 },
    ],
  };
  it("needs the same title and start year", () => {
    expect(pickSearchMatch(results, "Naruto", 2002)).toBe(1);
    expect(pickSearchMatch(results, "Naruto", 1990)).toBeNull();
    expect(pickSearchMatch(results, "Bleach", 2004)).toBeNull();
  });
  it("matches other titles, ignoring punctuation and accents", () => {
    expect(pickSearchMatch({ data: [{ mal_id: 9, title: "Shingeki no Kyojin", title_english: "Attack on Titan", year: 2013 }] }, "Attack on Titan!", 2013)).toBe(9);
  });
});

describe("episode lists", () => {
  it("collects filler episodes and paging", () => {
    const page = { data: [{ mal_id: 1, filler: false }, { mal_id: 2, filler: true }, { mal_id: 3, filler: true, recap: false }], pagination: { has_next_page: true } };
    expect(parseEpisodePage(page)).toEqual({ filler: [2, 3], first: 1, last: 3, more: true });
    expect(parseEpisodePage({})).toBeNull();
  });
  it("finds a TV sequel", () => {
    const rel = { data: [{ relation: "Adaptation", entry: [{ type: "manga", mal_id: 5 }] }, { relation: "Sequel", entry: [{ type: "anime", mal_id: 7 }] }] };
    expect(parseSequel(rel)).toBe(7);
    expect(isTvEntry({ data: { type: "TV" } })).toBe(true);
    expect(isTvEntry({ data: { type: "Movie" } })).toBe(false);
  });
});

describe("numbering", () => {
  it("runs on across seasons, unshaken by a missing file, skipping specials", () => {
    const n = absoluteNumbers([ep("a", 1, 1), ep("b", 1, 3), ep("c", 2, 1), ep("sp", 0, 1)]);
    expect(n.get("a")).toBe(1);
    expect(n.get("b")).toBe(3);
    expect(n.get("c")).toBe(4);
    expect(n.has("sp")).toBe(false);
  });
  it("maps filler across a chain of MyAnimeList entries", () => {
    const eps = [ep("s1e2", 1, 2), ep("s1e3", 1, 3), ep("s2e1", 2, 1), ep("s2e2", 2, 2)];
    // Season 1 has 3 episodes in the library; entry one has 3 with #2 filler, entry two has #2 filler.
    const ids = fillerEpisodeIds(eps, [
      { malId: 1, episodes: 3, filler: [2] },
      { malId: 2, episodes: 2, filler: [2] },
    ]);
    expect([...ids].sort()).toEqual(["s1e2", "s2e2"]);
  });
});

describe("jikan-edge's camelCase format", () => {
  it("reads episodes, paging, a flat sequel list and start dates", () => {
    const page = { data: [{ number: 1, filler: false }, { number: 2, filler: true }], meta: { pagination: { hasNextPage: false } } };
    expect(parseEpisodePage(page)).toEqual({ filler: [2], first: 1, last: 2, more: false });
    expect(parseSequel({ data: [{ relation: "Sequel", malId: 22043, type: "anime" }, { relation: "Adaptation", malId: 598, type: "manga" }] })).toBe(22043);
    expect(pickSearchMatch({ data: [{ malId: 20, title: "Naruto", startDate: "2002-10-03" }] }, "Naruto", 2002)).toBe(20);
  });
});

describe("keeping a saved list current", () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 10, 6);
  const run = (episodes: number, extra: object = {}) => ({ at: NOW - DAY, parts: [{ malId: 1, episodes, filler: [3] }], libraryEpisodes: episodes, ...extra });

  it("reads only the newest page again, keeping earlier filler and taking back a mark that was removed", () => {
    expect(tailPage({ episodes: 220 })).toBe(3);
    expect(tailPage({ episodes: 100 })).toBe(1);
    expect(tailPage({ episodes: 0 })).toBe(1);
    const saved = { malId: 1, episodes: 205, filler: [26, 150, 201, 204] };
    expect(mergePages(saved, [{ first: 201, last: 212, filler: [201, 210], more: false }])).toEqual({ malId: 1, episodes: 212, filler: [26, 150, 201, 210] });
    expect(mergePages(saved, [])).toBe(saved);
  });

  it("checks right away when the library has episodes past the list", () => {
    expect(checkNeeded(run(12, { status: "Ended", settled: true }), { episodes: 24, status: "Ended" }, NOW)).toBe("newEpisodes");
  });

  it("doesn't keep asking while MyAnimeList hasn't listed new episodes, but tries again a week on", () => {
    const waiting = { ...run(12), libraryEpisodes: 13, status: "Continuing" };
    expect(checkNeeded(waiting, { episodes: 13, status: "Continuing" }, NOW)).toBe("none");
    expect(checkNeeded({ ...waiting, at: NOW - WEEKLY_MS }, { episodes: 13, status: "Continuing" }, NOW)).toBe("newEpisodes");
  });

  it("rechecks a show that's still airing weekly", () => {
    expect(checkNeeded(run(12, { status: "Continuing" }), { episodes: 12, status: "Continuing" }, NOW)).toBe("none");
    expect(checkNeeded(run(12, { status: "Continuing", at: NOW - 8 * DAY }), { episodes: 12, status: "Continuing" }, NOW)).toBe("weekly");
  });

  it("checks a finished show once more a month after its last episode, then never", () => {
    const lastEpisode = NOW - 40 * DAY;
    const checkedEarly = run(12, { status: "Ended", at: NOW - 35 * DAY });
    expect(checkNeeded(checkedEarly, { episodes: 12, newestAdded: lastEpisode, status: "Ended" }, NOW)).toBe("final");
    expect(checkNeeded({ ...checkedEarly, at: NOW - 5 * DAY, settled: true }, { episodes: 12, newestAdded: lastEpisode, status: "Ended" }, NOW)).toBe("none");
    expect(checkNeeded(run(12, { status: "Ended", at: NOW - 400 * DAY }), { episodes: 12, newestAdded: NOW - 10 * DAY, status: "Ended" }, NOW)).toBe("none");
    expect(isSettled("Ended", NOW - SETTLE_MS, NOW)).toBe(true);
    expect(isSettled("Ended", NOW - DAY, NOW)).toBe(false);
    expect(isSettled("Continuing", 0, NOW)).toBe(false);
  });
});

describe("episode titles", () => {
  it("reads titles from either service's format", () => {
    expect(parseEpisodeTitles({ data: [{ mal_id: 1, title: "Rebirth" }, { mal_id: 2, title: "", title_romanji: "Taiketsu" }] })).toEqual({ 1: "Rebirth", 2: "Taiketsu" });
    expect(parseEpisodeTitles({ data: [{ number: 3, title: " Dealings " }] })).toEqual({ 3: "Dealings" });
    expect(parseEpisodeTitles({})).toEqual({});
  });
  it("finds the entry and number for a running episode number", () => {
    const parts = [
      { malId: 6702, episodes: 175 },
      { malId: 22043, episodes: 102 },
    ];
    expect(locate(1, parts)).toEqual({ malId: 6702, number: 1 });
    expect(locate(176, parts)).toEqual({ malId: 22043, number: 1 });
    expect(locate(400, parts)).toBeNull();
  });
});

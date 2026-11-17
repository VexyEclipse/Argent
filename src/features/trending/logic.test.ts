import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/api/libraryIndex";
import { baseTitle, editDistance } from "@/api/titles";
import { buildLookup, findOwned, isBearerToken, parseAniList, parseTmdb, pickTmdbTrailer, plainText, rankList, type TrendEntry } from "./logic";

const lib = (e: Partial<IndexEntry> & Pick<IndexEntry, "id" | "name">): IndexEntry => ({ type: "Series", ids: {}, anime: false, ...e });

function anime(over: Partial<TrendEntry> & { title: string }): TrendEntry {
  return {
    key: `anilist:${over.title}`,
    kind: "anime",
    rank: 1,
    titles: [over.title],
    genres: [],
    format: "series",
    url: "",
    ids: {},
    related: { anilist: [], mal: [], titles: [] },
    ...over,
  };
}

function film(over: Partial<TrendEntry> & { title: string }): TrendEntry {
  return { ...anime(over), key: `tmdb-movie:${over.title}`, kind: "movies", format: "movie", ...over };
}

describe("titles", () => {
  it("drops a season or part, not a number that's part of the name", () => {
    expect(baseTitle("Jujutsu Kaisen Season 2")).toBe("Jujutsu Kaisen");
    expect(baseTitle("Attack on Titan: The Final Season Part 2")).toBe("Attack on Titan");
    expect(baseTitle("Mushoku Tensei: Jobless Reincarnation 2nd Season")).toBe("Mushoku Tensei: Jobless Reincarnation");
    expect(baseTitle("Overlord IV")).toBe("Overlord");
    expect(baseTitle("Chitose Is in the Ramune Bottle 2nd Cour")).toBe("Chitose Is in the Ramune Bottle");
    expect(baseTitle("Kaiju No. 8")).toBe("Kaiju No. 8");
  });

  it("counts a swap of two letters as one typo", () => {
    expect(editDistance("frieran", "frieren")).toBe(1);
    expect(editDistance("interstellar", "intresteller")).toBe(2);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });
});

describe("parseAniList", () => {
  const json = {
    data: {
      Page: {
        media: [
          {
            id: 154587,
            idMal: 52991,
            format: "TV",
            seasonYear: 2023,
            episodes: 28,
            averageScore: 91,
            genres: ["Adventure", "Drama"],
            description: "An elf mage&#039;s journey.<br><br><i>(Source: Crunchyroll)</i>",
            siteUrl: "https://anilist.co/anime/154587",
            title: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End", native: "葬送のフリーレン" },
            synonyms: ["Frieren at the Funeral"],
            coverImage: { extraLarge: "https://img/cover.jpg" },
            bannerImage: "https://img/banner.jpg",
            trailer: { id: "qgQsKxgWqQ8", site: "youtube" },
            studios: { nodes: [{ name: "Madhouse" }] },
            relations: { edges: [{ relationType: "PREQUEL", node: { id: 1, idMal: 2, type: "ANIME", title: { romaji: "Earlier" } } }] },
          },
          { id: 2, title: {} },
          { id: 3, format: "MOVIE", title: { romaji: "A Film" } },
        ],
      },
    },
  };

  it("reads titles, art, score and the trailer", () => {
    const [frieren, movie] = parseAniList(json);
    expect(frieren.title).toBe("Frieren: Beyond Journey's End");
    expect(frieren.titles).toContain("Sousou no Frieren");
    expect(frieren.titles).toContain("Frieren at the Funeral");
    expect(frieren.score).toBe(9.1);
    expect(frieren.trailer).toBe("qgQsKxgWqQ8");
    expect(frieren.studio).toBe("Madhouse");
    expect(frieren.overview).toBe("An elf mage's journey.\n\n(Source: Crunchyroll)");
    expect(frieren.ids).toEqual({ anilist: "154587", mal: "52991" });
    expect(frieren.related).toEqual({ anilist: ["1"], mal: ["2"], titles: ["Earlier"] });
    expect(movie).toMatchObject({ rank: 2, format: "movie", title: "A Film" });
  });

  it("returns nothing for an unexpected answer", () => {
    expect(parseAniList(null)).toEqual([]);
    expect(parseAniList({ errors: [] })).toEqual([]);
  });
});

describe("parseTmdb", () => {
  it("builds image urls and genre names, and leaves anime out of Series", () => {
    const json = {
      results: [
        {
          id: 1,
          name: "Severance",
          original_name: "Severance",
          first_air_date: "2022-02-17",
          genre_ids: [18],
          vote_average: 8.4,
          vote_count: 900,
          poster_path: "/p.jpg",
        },
        { id: 2, name: "Dandadan", original_language: "ja", genre_ids: [16, 10759] },
        { id: 3, name: "Arcane", original_language: "en", genre_ids: [16] },
      ],
    };
    const out = parseTmdb(json, "series", { 18: "Drama" });
    expect(out.map((e) => e.title)).toEqual(["Severance", "Arcane"]);
    expect(out[0]).toMatchObject({
      key: "tmdb-tv:1",
      year: 2022,
      score: 8.4,
      genres: ["Drama"],
      poster: "https://image.tmdb.org/t/p/w342/p.jpg",
      format: "series",
    });
    expect(out[1].rank).toBe(2);
  });

  it("picks an official YouTube trailer", () => {
    const videos = {
      results: [
        { site: "YouTube", type: "Teaser", key: "teaser", official: true },
        { site: "Vimeo", type: "Trailer", key: "vimeo" },
        { site: "YouTube", type: "Trailer", key: "fan", official: false },
        { site: "YouTube", type: "Trailer", key: "main", official: true },
      ],
    };
    expect(pickTmdbTrailer(videos)).toBe("main");
  });

  it("tells a read-access token from a v3 key", () => {
    expect(isBearerToken("eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIxIn0.abc-_d")).toBe(true);
    expect(isBearerToken("0123456789abcdef0123456789abcdef")).toBe(false);
  });

  it("strips AniList's markup", () => {
    expect(plainText("A &amp; B<br />C")).toBe("A & B\nC");
  });
});

describe("findOwned", () => {
  const index = [
    lib({ id: "frieren", name: "Frieren: Beyond Journey's End", anime: true, ids: { AniList: "154587" } }),
    lib({ id: "jjk", name: "Jujutsu Kaisen", anime: true, ids: { Tvdb: "377543" } }),
    lib({ id: "naruto", name: "Naruto", anime: true }),
    lib({ id: "dune84", name: "Dune", type: "Movie", year: 1984 }),
    lib({ id: "sev", name: "Severance", ids: { Tmdb: "95396" } }),
    lib({ id: "op-film", name: "One Piece Film: Red", type: "Movie", anime: true, year: 2022 }),
  ];
  const lookup = buildLookup(index);

  it("finds a title by its AniList or TMDB id", () => {
    expect(findOwned(anime({ title: "Something Else", ids: { anilist: "154587" } }), lookup)).toBe("frieren");
    expect(findOwned(film({ title: "Severance", kind: "series", format: "series", ids: { tmdb: "95396" } }), lookup)).toBe("sev");
  });

  it("finds a new season of a show you have", () => {
    expect(findOwned(anime({ title: "Jujutsu Kaisen Season 3" }), lookup)).toBe("jjk");
    expect(findOwned(anime({ title: "Jujutsu Kaisen: The Culling Game Part 1" }), lookup)).toBe("jjk");
  });

  it("doesn't mistake a different show or a remake for yours", () => {
    expect(findOwned(anime({ title: "Naruto Shippuden" }), lookup)).toBeUndefined();
    expect(findOwned(film({ title: "Dune", year: 2021 }), lookup)).toBeUndefined();
    expect(findOwned(film({ title: "Dune", year: 1984 }), lookup)).toBe("dune84");
  });

  it("compares titles in any script, not just their digits", () => {
    const withLion = buildLookup([...index, lib({ id: "lion", name: "March Comes In Like a Lion", original: "3月のライオン", anime: true })]);
    const apothecary = anime({ title: "The Apothecary Diaries Season 3", titles: ["The Apothecary Diaries Season 3", "薬屋のひとりごと 第3期"] });
    expect(findOwned(apothecary, withLion)).toBeUndefined();
    expect(findOwned(anime({ title: "March Comes In Like a Lion", titles: ["3月のライオン"] }), withLion)).toBe("lion");
  });

  it("matches films to films and shows to shows", () => {
    expect(findOwned(anime({ title: "One Piece Film: Red", format: "movie", year: 2022 }), lookup)).toBe("op-film");
    expect(findOwned(anime({ title: "One Piece Film: Red", format: "series" }), lookup)).toBeUndefined();
  });
});

describe("rankList", () => {
  const entries = ["a", "b", "c", "d"].map((t, i) => anime({ title: t, key: t, rank: i + 1 }));

  it("keeps everything when titles you don't have are shown", () => {
    const owned = new Map([["b", "B"]]);
    expect(rankList(entries, owned, { includeNotOwned: true, limit: 3 }).map((r) => [r.rank, r.entry.key, r.ownedId])).toEqual([
      [1, "a", undefined],
      [2, "b", "B"],
      [3, "c", undefined],
    ]);
  });

  it("numbers only yours from 1 otherwise, each title once", () => {
    const owned = new Map([
      ["b", "B"],
      ["c", "B"],
      ["d", "D"],
    ]);
    expect(rankList(entries, owned, { includeNotOwned: false, limit: 10 }).map((r) => [r.rank, r.ownedId])).toEqual([
      [1, "B"],
      [2, "D"],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { copyIds, hasCopies, looksUnnamed, mergeDuplicateEpisodes, noteCopies, unwatchedCount } from "./duplicates";
import type { BaseItem } from "./types";

const ep = (Id: string, s: number, e: number, extra: Partial<BaseItem> = {}): BaseItem => ({ Id, Name: Id, Type: "Episode", ParentIndexNumber: s, IndexNumber: e, ...extra });

describe("duplicate episodes", () => {
  it("keeps the copy with artwork, in order, and remembers the others", () => {
    const list = mergeDuplicateEpisodes([
      ep("e2", 1, 2),
      ep("e3-real", 1, 3, { ImageTags: { Primary: "t" }, MediaSources: [{ Id: "m", Path: "D:\\a.mkv", SupportsDirectPlay: true, SupportsDirectStream: true, SupportsTranscoding: true, MediaStreams: [] }] }),
      ep("e3-ghost", 1, 3, { Overview: "Dove", MediaSources: [{ Id: "m2", Path: "D:\\Test\\a.mkv", SupportsDirectPlay: true, SupportsDirectStream: true, SupportsTranscoding: true, MediaStreams: [] }] }),
      ep("e3-ghost2", 1, 3, { Overview: "Dove" }),
      ep("e4", 1, 4),
    ]);
    expect(list.map((e) => e.Id)).toEqual(["e2", "e3-real", "e4"]);
    expect(list[1].Copies).toEqual([
      { Id: "e3-ghost", Path: "D:\\Test\\a.mkv" },
      { Id: "e3-ghost2", Path: undefined },
    ]);
    expect(copyIds(list[1])).toEqual(["e3-real", "e3-ghost", "e3-ghost2"]);
    expect(list[0].Copies).toBeUndefined();
  });

  it("is watched if any copy is, and resumes where one was left", () => {
    const [merged] = mergeDuplicateEpisodes([
      ep("a", 1, 1, { ImageTags: { Primary: "t" }, UserData: { Played: false } }),
      ep("b", 1, 1, { UserData: { Played: true } }),
    ]);
    expect(merged.Id).toBe("a");
    expect(merged.UserData?.Played).toBe(true);
    const [resumed] = mergeDuplicateEpisodes([ep("a", 1, 1, { ImageTags: { Primary: "t" } }), ep("b", 1, 1, { UserData: { PlaybackPositionTicks: 500, PlayedPercentage: 40 } })]);
    expect(resumed.UserData?.PlaybackPositionTicks).toBe(500);
  });

  it("lets a real file replace a missing-episode placeholder, and leaves other placeholders and specials alone", () => {
    const list = mergeDuplicateEpisodes([ep("v1", 1, 1, { LocationType: "Virtual" }), ep("r1", 1, 1), ep("v2", 1, 2, { LocationType: "Virtual" }), ep("s1", 0, 1), ep("x", 1, 1, {})]);
    expect(list.map((e) => e.Id)).toEqual(["r1", "v2", "s1"]);
    expect(list[0].Copies?.map((c) => c.Id)).toEqual(["x"]);
  });

  it("never merges episodes without a number, or a double episode with a single one", () => {
    const list = mergeDuplicateEpisodes([ep("a", 1, 1), { Id: "n1", Name: "n1", Type: "Episode" }, { Id: "n2", Name: "n2", Type: "Episode" }, ep("ab", 1, 1, { IndexNumberEnd: 2 })]);
    expect(list.map((e) => e.Id)).toEqual(["a", "n1", "n2", "ab"]);
  });
});

describe("choosing and completing a copy", () => {
  const source = (path: string, types: ("Video" | "Audio")[]) => ({
    Id: path,
    Path: path,
    SupportsDirectPlay: true,
    SupportsDirectStream: true,
    SupportsTranscoding: true,
    MediaStreams: types.map((Type, Index) => ({ Index, Type })),
  });

  it("prefers a whole file over a picture, and borrows the picture", () => {
    const [kept] = mergeDuplicateEpisodes([
      ep("broken", 1, 2, { ImageTags: { Primary: "pic" }, MediaSources: [source("a.mkv", ["Video"])] }),
      ep("whole", 1, 2, { MediaSources: [source("b.mkv", ["Video", "Audio"])] }),
    ]);
    expect(kept.Id).toBe("whole");
    expect(kept.ImageTags?.Primary).toBe("pic");
    expect(kept.PrimaryImageItemId).toBe("broken");
  });

  it("prefers the copy with a picture when both are whole, and takes a proper title from the other", () => {
    const [kept] = mergeDuplicateEpisodes([
      ep("titled", 1, 2, { Name: "Confrontation", SeriesName: "Death Note", Overview: "L meets…" }),
      ep("pictured", 1, 2, { Name: "Death Note - 02", SeriesName: "Death Note", ImageTags: { Primary: "pic" } }),
    ]);
    expect(kept.Id).toBe("pictured");
    expect(kept.Name).toBe("Confrontation");
    expect(kept.Overview).toBe("L meets…");
    expect(kept.PrimaryImageItemId).toBeUndefined();
  });

  it("recognises titles that are only a file name, from titles in your library", () => {
    const unnamed = (Name: string, SeriesName: string) => looksUnnamed({ Name, SeriesName });
    expect(unnamed("Death Note - 01", "Death Note")).toBe(true);
    expect(unnamed("Attack on Titan - 01 (2013)", "Attack on Titan")).toBe(true);
    expect(unnamed("Dragon Ball GT", "Dragon Ball GT")).toBe(true);
    expect(unnamed("S01E17-EMBER", "That Time I Got Reincarnated as a Slime")).toBe(true);
    expect(unnamed("[Judas] Black Summoner - S01E01", "Black Summoner")).toBe(true);
    expect(unnamed("[Cleo]91_Days_-_01_(Dual Audio_10bit_BD1080p_x265)", "91 Days")).toBe(true);
    expect(unnamed("Episode 3", "Alien 9")).toBe(true);
    expect(unnamed("Pokémon S03E39 - Forest Grumps", "Pokémon")).toBe(false);
    expect(unnamed("Pokemon - 433 - Odd Pokémon Out", "Pokémon")).toBe(false);
    expect(unnamed("Kaiju No. 8 Captured", "Kaiju No. 8")).toBe(false);
    expect(unnamed("03 - Dove", "Tokyo Ghoul")).toBe(false);
    expect(unnamed("Rebirth", "Death Note")).toBe(false);
    expect(unnamed("Berserk: Episode 15 (The Decisive Battle)", "Berserk")).toBe(false);
    expect(unnamed("Demon Slayer S04E07", "Demon Slayer: Kimetsu no Yaiba")).toBe(true);
    expect(unnamed("D.Gray-man_-_100_(Dual Audio_10bit_DVD480p", "D.Gray-man")).toBe(true);
    expect(unnamed("[Reaktor] Fullmetal Alchemist Brotherhood - E53", "Fullmetal Alchemist: Brotherhood")).toBe(true);
    expect(unnamed("Ghost in the Shell (S.A.C) - S02 E18 - DI - Trans Parent", "Ghost in The Shell Collection")).toBe(false);
    expect(unnamed("Drifters 14v2 OVA Bring on a War", "Drifters")).toBe(false);
    expect(unnamed("S01E12-Overload", "SAKAMOTO DAYS")).toBe(false);
    expect(unnamed("Lazarus.S01E06.1080p.Dual.Audio.WEBRip.DD+.x265-EMBER", "Lazarus")).toBe(true);
  });
});

describe("counting episodes once", () => {
  it("counts unwatched episodes, not copies or placeholders", () => {
    const merged = mergeDuplicateEpisodes([
      ep("a1", 1, 1, { UserData: { Played: true } }),
      ep("a2", 1, 1),
      ep("b1", 1, 2),
      ep("b2", 1, 2),
      ep("v", 1, 3, { LocationType: "Virtual" }),
    ]);
    expect(unwatchedCount(merged)).toBe(1);
  });

  it("remembers shows with copies, and forgets one only when its whole list has none", () => {
    const withCopy = mergeDuplicateEpisodes([ep("a", 1, 1), ep("b", 1, 1)]);
    const clean = mergeDuplicateEpisodes([ep("a", 1, 1)]);
    noteCopies("show", withCopy, false);
    expect(hasCopies("show")).toBe(true);
    noteCopies("show", clean, false);
    expect(hasCopies("show")).toBe(true);
    noteCopies("show", clean, true);
    expect(hasCopies("show")).toBe(false);
  });
});

describe("copies left behind by a removed library folder", () => {
  // Windows paths as Jellyfin reports them; a trailing separator or forward slashes don't matter.
  const roots = ["X:\\Library\\Shows\\", "Y:/Library/More"];
  const at = (path: string) => [{ Id: path, Path: path, SupportsDirectPlay: true, SupportsDirectStream: true, SupportsTranscoding: true, MediaStreams: [] }];

  it("shows the copy still in the library, with its own picture, and takes the title from the left-over copy", () => {
    const [kept] = mergeDuplicateEpisodes(
      [
        ep("gone", 1, 1, { Name: "Rebirth", SeriesName: "Death Note", Overview: "Light…", ImageTags: { Primary: "old" }, MediaSources: at("X:\\Old\\Death Note\\01.mkv") }),
        ep("here", 1, 1, { Name: "Death Note - 01", SeriesName: "Death Note", ImageTags: { Primary: "thumb" }, MediaSources: at("X:\\Library\\Shows\\Death Note\\01.mkv") }),
      ],
      roots,
    );
    expect(kept.Id).toBe("here");
    expect(kept.ImageTags?.Primary).toBe("thumb");
    expect(kept.Name).toBe("Rebirth");
    expect(kept.BorrowedName).toBe(true);
  });

  it("never borrows a picture from a copy whose folder is gone", () => {
    const [kept] = mergeDuplicateEpisodes(
      [
        ep("gone", 1, 1, { ImageTags: { Primary: "old" }, MediaSources: at("X:/Old/a.mkv") }),
        ep("here", 1, 1, { MediaSources: at("Y:/Library/More/a.mkv") }),
      ],
      roots,
    );
    expect(kept.Id).toBe("here");
    expect(kept.ImageTags?.Primary).toBeUndefined();
  });
});

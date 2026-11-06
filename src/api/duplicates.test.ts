import { describe, expect, it } from "vitest";
import { copyIds, mergeDuplicateEpisodes } from "./duplicates";
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

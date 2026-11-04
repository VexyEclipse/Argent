import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { earlierUnwatched } from "./episodes";

const ep = (id: string, season: number, played = false, extra: Partial<BaseItem> = {}): BaseItem => ({
  Id: id,
  Name: id,
  Type: "Episode",
  ParentIndexNumber: season,
  UserData: { Played: played },
  ...extra,
});

describe("earlierUnwatched", () => {
  const list = [ep("sp1", 0), ep("a", 1, true), ep("b", 1), ep("c", 2), ep("gone", 2, false, { LocationType: "Virtual" }), ep("d", 2), ep("e", 2)];

  it("returns unwatched episodes before the target across seasons", () => {
    expect(earlierUnwatched(list, "d").map((e) => e.Id)).toEqual(["b", "c"]);
  });

  it("skips specials, missing episodes and the target itself", () => {
    expect(earlierUnwatched(list, "b").map((e) => e.Id)).toEqual([]);
    expect(earlierUnwatched(list, "e").map((e) => e.Id)).toEqual(["b", "c", "d"]);
  });

  it("is empty for the first episode or an unknown id", () => {
    expect(earlierUnwatched(list, "a")).toEqual([]);
    expect(earlierUnwatched(list, "zzz")).toEqual([]);
  });
});

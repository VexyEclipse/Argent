import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { pickEpisode, pickSomething } from "./shuffle";

const item = (id: string, extra: Partial<BaseItem> = {}): BaseItem => ({ Id: id, Name: id, Type: "Movie", ...extra });

describe("play something", () => {
  it("prefers unwatched titles and never repeats the last pick", () => {
    const items = [item("a", { UserData: { Played: true } }), item("b"), item("c")];
    expect(pickSomething(items, undefined, () => 0)?.Id).toBe("b");
    expect(pickSomething(items, "b", () => 0)?.Id).toBe("c");
  });

  it("falls back to watched titles when everything has been seen", () => {
    const items = [item("a", { UserData: { Played: true } })];
    expect(pickSomething(items, undefined, () => 0.5)?.Id).toBe("a");
  });
});

describe("episode shuffle", () => {
  const eps = ["1", "2", "3", "4"].map((id) => item(id, { Type: "Episode" }));

  it("skips what already came up and the episode playing now", () => {
    expect(pickEpisode(eps, ["1", "2"], "3", () => 0)?.Id).toBe("4");
  });

  it("starts over once everything has come up, and never plays virtual episodes", () => {
    expect(pickEpisode(eps, ["1", "2", "3", "4"], "1", () => 0)?.Id).toBe("2");
    expect(pickEpisode([item("v", { Type: "Episode", LocationType: "Virtual" })], [], undefined, () => 0)).toBeNull();
  });
});

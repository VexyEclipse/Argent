import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { canFixEpisodes, targets } from "./episodeFixes";

const item = (Id: string, Type: string, extra: Partial<BaseItem> = {}): BaseItem => ({ Id, Name: Id, Type, ...extra });

describe("what the episode fixes cover", () => {
  it("takes a whole show, seasons by number, and single episodes, per show", () => {
    const t = targets([
      item("bleach", "Series"),
      item("s2", "Season", { SeriesId: "naruto", SeriesName: "Naruto", IndexNumber: 2 }),
      item("e5", "Episode", { SeriesId: "naruto", SeriesName: "Naruto" }),
    ]);
    expect(t.get("bleach")).toMatchObject({ name: "bleach", whole: true });
    expect(t.get("naruto")).toMatchObject({ name: "Naruto", whole: false });
    expect([...t.get("naruto")!.seasons]).toEqual([2]);
    expect([...t.get("naruto")!.episodes]).toEqual(["e5"]);
  });

  it("is offered only for shows, seasons and episodes", () => {
    expect(canFixEpisodes([item("m", "Movie")])).toBe(false);
    expect(canFixEpisodes([item("m", "Movie"), item("s", "Series")])).toBe(true);
  });
});

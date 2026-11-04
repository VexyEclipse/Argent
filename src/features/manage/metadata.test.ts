import { describe, expect, it } from "vitest";
import type { BaseItem } from "@/api/types";
import { changesOf, toForm } from "./MetadataEditor";

const item = {
  Id: "m1",
  Name: "Night Harbor",
  Type: "Movie",
  Overview: "A ferry pilot.",
  Taglines: ["First", "Second"],
  Genres: ["Drama"],
  Tags: ["4k"],
  Studios: [{ Name: "A24", Id: "st1" }],
  ProviderIds: { Imdb: "tt1234567", Tmdb: "42", TvMaze: "9" },
  PremiereDate: "2024-03-12T00:00:00.0000000Z",
  ProductionYear: 2024,
  CommunityRating: 7.4,
  People: [{ Name: "Someone", Id: "p1", Type: "Actor" }],
  LockData: false,
} as BaseItem & Record<string, unknown>;

describe("metadata editor changes", () => {
  it("changes nothing when nothing was edited", () => {
    const form = toForm(item);
    expect(changesOf(item, form, { ...form })).toEqual({});
  });

  it("sends only the edited fields", () => {
    const form = toForm(item);
    expect(changesOf(item, form, { ...form, Name: "  Night Harbour  ", CommunityRating: "8" })).toEqual({ Name: "Night Harbour", CommunityRating: 8 });
  });

  it("keeps other providers' ids and existing studio ids", () => {
    const form = toForm(item);
    const out = changesOf(item, form, { ...form, Tmdb: "", Tvdb: "777", Studios: ["A24", "Neon"] });
    expect(out.ProviderIds).toEqual({ Imdb: "tt1234567", TvMaze: "9", Tvdb: "777" });
    expect(out.Studios).toEqual([{ Name: "A24", Id: "st1" }, { Name: "Neon" }]);
  });

  it("keeps extra taglines when the first one changes", () => {
    const form = toForm(item);
    expect(changesOf(item, form, { ...form, Tagline: "New" }).Taglines).toEqual(["New", "Second"]);
  });

  it("clears numbers and dates to null rather than garbage", () => {
    const form = toForm(item);
    const out = changesOf(item, form, { ...form, ProductionYear: "", PremiereDate: "", CriticRating: "abc" });
    expect(out.ProductionYear).toBeNull();
    expect(out.PremiereDate).toBeNull();
    expect(out.CriticRating).toBeNull();
  });

  it("round-trips dates as UTC days", () => {
    const form = toForm(item);
    expect(form.PremiereDate).toBe("2024-03-12");
    expect(changesOf(item, form, { ...form, PremiereDate: "2024-03-15" }).PremiereDate).toBe("2024-03-15T00:00:00.000Z");
  });
});

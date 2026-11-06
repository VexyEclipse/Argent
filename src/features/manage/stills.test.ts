import { describe, expect, it } from "vitest";
import { pickStill } from "./stills";

describe("choosing an episode still", () => {
  it("prefers TheMovieDb, then the best rated, then the largest", () => {
    const still = pickStill([
      { ProviderName: "TheTVDB", Url: "tvdb", Width: 1920, Height: 1080, CommunityRating: 9 },
      { ProviderName: "TheMovieDb", Url: "small", Width: 1280, Height: 720 },
      { ProviderName: "TheMovieDb", Url: "large", Width: 1920, Height: 1080 },
    ]);
    expect(still?.Url).toBe("large");
  });

  it("skips tall pictures and ones without an address", () => {
    expect(pickStill([{ ProviderName: "TheMovieDb", Url: "poster", Width: 600, Height: 900 }, { ProviderName: "TheMovieDb" }])).toBeNull();
    expect(pickStill([{ ProviderName: "Other", Url: "wide", Width: 1280, Height: 720 }])?.Url).toBe("wide");
    expect(pickStill([])).toBeNull();
  });
});

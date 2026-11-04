import { describe, expect, it } from "vitest";
import { canIdentify, identifyBody } from "./manage";

describe("identify", () => {
  it("searches by name, year and only the ids that were filled in", () => {
    expect(identifyBody("s1", { name: "  Severance ", year: 2022, providerIds: { Tvdb: " 371980 ", Imdb: "", Tmdb: "   " } })).toEqual({
      ItemId: "s1",
      IncludeDisabledProviders: true,
      SearchInfo: { Name: "Severance", Year: 2022, ProviderIds: { Tvdb: "371980" } },
    });
  });

  it("leaves the year out when it isn't a number", () => {
    expect(identifyBody("m1", { name: "Dune", year: NaN, providerIds: {} }).SearchInfo.Year).toBeUndefined();
    expect(identifyBody("m1", { name: "Dune", providerIds: {} }).SearchInfo.Year).toBeUndefined();
  });

  it("only offers types Jellyfin can identify", () => {
    expect(canIdentify({ Type: "Movie" })).toBe(true);
    expect(canIdentify({ Type: "Series" })).toBe(true);
    expect(canIdentify({ Type: "BoxSet" })).toBe(true);
    expect(canIdentify({ Type: "Episode" })).toBe(false);
    expect(canIdentify({ Type: "Season" })).toBe(false);
  });
});

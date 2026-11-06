import { describe, expect, it } from "vitest";
import { matchKey, needsStill, pickStill } from "./stills";

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

describe("when an episode still needs its still", () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 10, 6);
  const ep = (Id: string, addedDaysAgo: number, extra: object = {}) => ({
    Id,
    Type: "Episode",
    ParentIndexNumber: 1,
    DateCreated: new Date(NOW - addedDaysAgo * DAY).toISOString(),
    ...extra,
  });
  const none = { doneHere: new Set<string>(), seasons: {}, rematched: false };

  it("is fetched once: not again on this device, nor on another once its season is done", () => {
    expect(needsStill(ep("a", 10), "show", none)).toBe(true);
    expect(needsStill(ep("a", 10), "show", { ...none, doneHere: new Set(["a"]) })).toBe(false);
    expect(needsStill(ep("a", 10), "show", { ...none, seasons: { "show:1": NOW - 5 * DAY } })).toBe(false);
  });

  it("is fetched for an episode added after its season was done", () => {
    expect(needsStill(ep("new", 1), "show", { ...none, seasons: { "show:1": NOW - 5 * DAY } })).toBe(true);
  });

  it("is fetched again when the show was re-identified, and never for placeholders", () => {
    expect(needsStill(ep("a", 10), "show", { doneHere: new Set(["a"]), seasons: { "show:1": NOW }, rematched: true })).toBe(true);
    expect(needsStill(ep("v", 1, { LocationType: "Virtual" }), "show", none)).toBe(false);
  });

  it("notices a different match, but not the same ids in another order", () => {
    expect(matchKey({ Tvdb: "121361", Tmdb: "1399" })).toBe(matchKey({ Tmdb: "1399", Tvdb: "121361" }));
    expect(matchKey({ Tmdb: "1399" })).not.toBe(matchKey({ Tmdb: "1400" }));
    expect(matchKey(undefined)).toBe("");
  });
});

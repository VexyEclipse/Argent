import { describe, expect, it } from "vitest";
import { airDateLabel, seasonTotal } from "./format";

describe("airDateLabel", () => {
  const now = new Date(2026, 10, 4, 15, 0); // Wednesday 4 Nov 2026, local time

  it("names the nearest days", () => {
    expect(airDateLabel(new Date(2026, 10, 4, 21, 0).toISOString(), now)).toBe("Today");
    expect(airDateLabel(new Date(2026, 10, 5, 1, 0).toISOString(), now)).toBe("Tomorrow");
    expect(airDateLabel(new Date(2026, 10, 3, 9, 0).toISOString(), now)).toBe("Yesterday");
  });

  it("uses the weekday within a week, then a date", () => {
    const weekday = new Date(2026, 10, 7).toLocaleDateString(undefined, { weekday: "long" });
    expect(airDateLabel(new Date(2026, 10, 7, 20, 0).toISOString(), now)).toBe(weekday);
    expect(airDateLabel(new Date(2026, 10, 20).toISOString(), now)).not.toMatch(/day$/);
  });

  it("is empty for missing or bad dates", () => {
    expect(airDateLabel(undefined, now)).toBe("");
    expect(airDateLabel("nope", now)).toBe("");
  });
});

describe("seasonTotal", () => {
  it("counts numbered seasons once each, and not Specials or folders that aren't seasons", () => {
    const s = (Name: string, IndexNumber?: number) => ({ Name, IndexNumber });
    expect(seasonTotal([s("Specials", 0), s("Season 1", 1), s("Original"), s("Season Unknown")])).toBe(1);
    // Jellyfin lists a season once per folder it's in.
    expect(seasonTotal([s("Season 1", 1), s("Season 1", 1), s("Season 2", 2)])).toBe(2);
    // A folder named for a season Jellyfin didn't number counts as that season.
    expect(seasonTotal([s("Season 1", 1), s("Part 2")])).toBe(2);
    expect(seasonTotal([s("Season 1", 1), s("Season 2", 2), s("Part 2")])).toBe(2);
    expect(seasonTotal([s("Specials", 0)])).toBe(0);
  });
});

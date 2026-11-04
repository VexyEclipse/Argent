import { describe, expect, it } from "vitest";
import { airDateLabel } from "./format";

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

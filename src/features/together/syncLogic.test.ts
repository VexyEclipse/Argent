import { describe, expect, it } from "vitest";
import { bestOffset, driftFix, groupPosition, sampleOffset, toLocal, type SyncCommand } from "./syncLogic";

describe("clock offset", () => {
  it("measures a server running 5 s ahead over a 100 ms round trip", () => {
    // Sent at 1000 local; server got it at 6050 and replied at 6050; arrived at 1100 local.
    expect(sampleOffset({ sentAt: 1000, receivedAt: 1100, serverReceived: 6050, serverSent: 6050 })).toEqual({ offset: 5000, delay: 100 });
  });
  it("trusts the quickest round trip", () => {
    const best = bestOffset([
      { sentAt: 0, receivedAt: 900, serverReceived: 5700, serverSent: 5700 },
      { sentAt: 0, receivedAt: 40, serverReceived: 5020, serverSent: 5020 },
    ]);
    expect(best).toEqual({ offset: 5000, delay: 40 });
  });
  it("has no answer without samples", () => expect(bestOffset([])).toBeNull());
});

describe("group position", () => {
  const unpause: SyncCommand = { Command: "Unpause", When: new Date(10_000).toISOString(), PositionTicks: 600 * 10_000_000, PlaylistItemId: "p" };
  it("converts server time to local", () => expect(toLocal(unpause.When, 2000)).toBe(8000));
  it("advances from the unpause moment", () => expect(groupPosition(unpause, 2000, 11_000)).toBeCloseTo(603));
  it("holds before the unpause moment", () => expect(groupPosition(unpause, 0, 5_000)).toBe(600));
  it("stays put while paused", () => expect(groupPosition({ ...unpause, Command: "Pause" }, 0, 99_000)).toBe(600));
});

describe("drift", () => {
  it("leaves tiny drift alone", () => expect(driftFix(100.05, 100)).toEqual({ kind: "none" }));
  it("slows down when ahead and speeds up when behind", () => {
    expect(driftFix(100.5, 100)).toEqual({ kind: "rate", rate: 0.95 });
    expect(driftFix(99.5, 100)).toEqual({ kind: "rate", rate: 1.05 });
  });
  it("seeks when far off", () => expect(driftFix(90, 100)).toEqual({ kind: "seek", to: 100 }));
});

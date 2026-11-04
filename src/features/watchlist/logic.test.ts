import { describe, expect, it } from "vitest";
import { addEntry, emptyWatchlist, mergeCustomPrefs, normalise, removeEntry, sortedIds, toCustomPrefs } from "./logic";

const dune = { name: "Dune", type: "Movie" as const };
const severance = { name: "Severance", type: "Series" as const };

describe("watchlist", () => {
  it("adds and removes, remembering when a title was taken off", () => {
    let s = addEntry(emptyWatchlist(), "a", dune, 100);
    expect(s.items.a).toEqual({ ...dune, addedAt: 100 });
    s = removeEntry(s, "a", 200);
    expect(s.items.a).toBeUndefined();
    expect(s.removed.a).toBe(200);
    s = addEntry(s, "a", dune, 300);
    expect(s.removed.a).toBeUndefined();
  });

  it("lists the newest additions first", () => {
    let s = addEntry(emptyWatchlist(), "a", dune, 100);
    s = addEntry(s, "b", severance, 200);
    expect(sortedIds(s)).toEqual(["b", "a"]);
  });

  it("round-trips through server prefs", () => {
    let s = addEntry(emptyWatchlist(), "a", dune, 100);
    s = addEntry(s, "b", severance, 200);
    s = removeEntry(s, "b", 300);
    expect(mergeCustomPrefs(emptyWatchlist(), toCustomPrefs(s))).toEqual(s);
  });

  it("keeps the latest change from either device", () => {
    const here = addEntry(emptyWatchlist(), "a", dune, 100);
    // Another device removed it later: the removal wins.
    expect(mergeCustomPrefs(here, { "w:a": JSON.stringify({ removedAt: 150 }) }).items.a).toBeUndefined();
    // A stale removal from before it was added here doesn't.
    expect(mergeCustomPrefs(here, { "w:a": JSON.stringify({ removedAt: 50 }) }).items.a?.addedAt).toBe(100);
    // A re-add elsewhere after a local removal brings it back.
    const removed = removeEntry(here, "a", 200);
    expect(mergeCustomPrefs(removed, { "w:a": JSON.stringify({ ...dune, addedAt: 250 }) }).items.a?.addedAt).toBe(250);
  });

  it("ignores unrelated and malformed prefs", () => {
    const merged = mergeCustomPrefs(emptyWatchlist(), { "r:x": "{}", "w:a": "not json", "w:b": JSON.stringify({ name: "" }), "w:c": null });
    expect(merged).toEqual(emptyWatchlist());
  });

  it("drops malformed local data", () => {
    const s = normalise({ items: { a: { ...dune, addedAt: 1 }, b: { name: "x" } }, removed: { c: 5, d: "no" } });
    expect(Object.keys(s.items)).toEqual(["a"]);
    expect(s.removed).toEqual({ c: 5 });
    expect(normalise(null)).toEqual(emptyWatchlist());
  });
});

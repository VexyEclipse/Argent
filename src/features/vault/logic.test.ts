import { describe, expect, it } from "vitest";
import {
  applyScan,
  emptyVault,
  filterRows,
  forget,
  hideTag,
  importInto,
  markResetPeak,
  mergeCustomPrefs,
  normalise,
  parseImport,
  privateTag,
  rows,
  setHidden,
  shortSeasons,
  statsOf,
  statusOf,
  summariseEpisodes,
  toCsv,
  toCustomPrefs,
  toJson,
  visibilityOf,
  withVisibility,
  type ScanTitle,
} from "./logic";

const show = (over: Partial<ScanTitle> = {}): ScanTitle => ({
  id: "s1",
  type: "Series",
  name: "Severance",
  year: 2022,
  ids: { Tvdb: "371980" },
  perSeason: { "1": 9, "2": 10 },
  watched: 4,
  ...over,
});
const film = (over: Partial<ScanTitle> = {}): ScanTitle => ({ id: "m1", type: "Movie", name: "Dune", year: 2021, ids: { Tmdb: "438631" }, minutes: 155, ...over });

const ALICE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const BOB = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

describe("library check", () => {
  it("adds every title it finds, counting episodes and seasons", () => {
    const { state, changed, newlyMissing } = applyScan(emptyVault(), [show(), film()], 1000);
    expect(changed).toBe(true);
    expect(newlyMissing).toEqual([]);
    expect(state.entries.s1).toMatchObject({ name: "Severance", episodes: 19, seasons: 2, most: 19, watched: 4, added: 1000, seen: 1000 });
    // Per-season peaks are only kept once they differ from today's counts.
    expect(state.entries.s1.peak).toBeUndefined();
    expect(state.entries.m1).toMatchObject({ name: "Dune", minutes: 155 });
    expect(statusOf(state.entries.s1)).toBe("library");
  });

  it("dates a first-seen title by when Jellyfin added it", () => {
    const { state, added } = applyScan(emptyVault(), [film({ created: 400 }), show({ created: 5000 })], 1000);
    expect(added).toBe(2);
    expect(state.entries.m1.added).toBe(400);
    // Never in the future.
    expect(state.entries.s1.added).toBe(1000);
  });

  it("marks a title missing once, keeping everything about it", () => {
    const first = applyScan(emptyVault(), [show(), film()], 1000).state;
    const second = applyScan(first, [film()], 2000);
    expect(second.newlyMissing.map((e) => e.name)).toEqual(["Severance"]);
    expect(second.state.entries.s1).toMatchObject({ missing: 2000, episodes: 19, watched: 4 });
    expect(statusOf(second.state.entries.s1)).toBe("missing");
    // Still gone: not news again.
    const third = applyScan(second.state, [film()], 3000);
    expect(third.newlyMissing).toEqual([]);
    expect(third.state.entries.s1.missing).toBe(2000);
  });

  it("recognises a re-added title by its provider ids and keeps its place", () => {
    const first = applyScan(emptyVault(), [show()], 1000).state;
    const gone = applyScan(first, [], 2000).state;
    const back = applyScan(gone, [show({ id: "s1-new" })], 3000);
    expect(Object.keys(back.state.entries)).toEqual(["s1"]);
    expect(back.state.entries.s1).toMatchObject({ id: "s1-new", added: 1000 });
    expect(back.state.entries.s1.missing).toBeUndefined();
    expect(back.returned.map((e) => e.name)).toEqual(["Severance"]);
  });

  it("falls back to name and year, but never mixes a film with a show", () => {
    const first = applyScan(emptyVault(), [show({ ids: {} })], 1000).state;
    const back = applyScan(first, [show({ id: "x", ids: {} }), film({ id: "y", name: "Severance", year: 2022, ids: {} })], 2000).state;
    expect(back.entries.s1.id).toBe("x");
    expect(back.entries.y.type).toBe("Movie");
  });

  it("flags a show that lost episodes, naming the short seasons", () => {
    const first = applyScan(emptyVault(), [show()], 1000).state;
    const after = applyScan(first, [show({ perSeason: { "1": 9, "2": 4 } })], 2000).state;
    expect(statusOf(after.entries.s1)).toBe("incomplete");
    expect(after.entries.s1).toMatchObject({ episodes: 13, most: 19 });
    expect(shortSeasons(after.entries.s1)).toEqual([{ season: "2", now: 4, had: 10 }]);
    expect(after.entries.s1.peak).toEqual({ "1": 9, "2": 10 });
    // Episodes back: the peak folds away again.
    const healed = applyScan(after, [show()], 3000).state;
    expect(statusOf(healed.entries.s1)).toBe("library");
    expect(healed.entries.s1.peak).toBeUndefined();
  });

  it("takes the new count as complete after you delete a season in Argent", () => {
    const first = applyScan(emptyVault(), [show()], 1000).state;
    const marked = markResetPeak(first, ["s1"], 1500);
    const after = applyScan(marked, [show({ perSeason: { "1": 9 } })], 2000).state;
    expect(statusOf(after.entries.s1)).toBe("library");
    expect(after.entries.s1.resetPeak).toBeUndefined();
  });

  it("only reports a change worth syncing when something other than the time moved", () => {
    const first = applyScan(emptyVault(), [show()], 1000).state;
    const again = applyScan(first, [show()], 2000);
    expect(again.changed).toBe(false);
    expect(again.state.entries.s1.seen).toBe(2000);
    expect(again.state.entries.s1.at).toBe(1000);
  });

  it("starts fresh when a title deleted in Argent comes back at the same path", () => {
    const first = applyScan(emptyVault(), [film()], 1000).state;
    const deleted = forget(first, ["m1"], 1500);
    expect(deleted.entries.m1).toBeUndefined();
    const back = applyScan(deleted, [film()], 2000).state;
    expect(back.entries.m1.added).toBe(2000);
    expect(back.removed.m1).toBeUndefined();
  });

  it("reads who a title is hidden from, and puts the tags back on a re-added title", () => {
    const tags = withVisibility(["Keep me"], [BOB]);
    const first = applyScan(emptyVault(), [film({ tags })], 1000, { tags: true }).state;
    expect(first.entries.m1.hiddenFrom).toEqual([BOB.slice(0, 8)]);
    const gone = applyScan(first, [], 2000, { tags: true }).state;
    const back = applyScan(gone, [film({ id: "m2", tags: [] })], 3000, { tags: true });
    expect(back.reapply).toEqual([{ key: "m1", itemId: "m2", hiddenFrom: [BOB.slice(0, 8)], owner: undefined }]);
    // Same item, tags removed elsewhere (jellyfin-web): the server is right.
    const cleared = applyScan(first, [film({ tags: [] })], 2000, { tags: true });
    expect(cleared.reapply).toEqual([]);
    expect(cleared.state.entries.m1.hiddenFrom).toBeUndefined();
  });

  it("hides a private title from users added since", () => {
    const tags = withVisibility([], [BOB], ALICE);
    const users = [ALICE, BOB, "99999999aaaa"].map((u) => u.slice(0, 8));
    const r = applyScan(emptyVault(), [film({ tags })], 1000, { tags: true, users });
    expect(r.state.entries.m1.owner).toBe(ALICE.slice(0, 8));
    expect(r.reapply).toEqual([{ key: "m1", itemId: "m1", hiddenFrom: [BOB.slice(0, 8), "99999999"].sort(), owner: ALICE.slice(0, 8) }]);
  });
});

describe("episodes", () => {
  it("counts each episode once, double episodes as two, and only watched ones still there", () => {
    const eps = [
      { Id: "1", SeriesId: "s", ParentIndexNumber: 1, IndexNumber: 1, UserData: { Played: true, LastPlayedDate: "2026-01-02T00:00:00Z" } },
      { Id: "1b", SeriesId: "s", ParentIndexNumber: 1, IndexNumber: 1 },
      { Id: "2", SeriesId: "s", ParentIndexNumber: 1, IndexNumber: 2, IndexNumberEnd: 3, Name: "Double", UserData: { Played: true, LastPlayedDate: "2026-02-01T00:00:00Z" } },
      { Id: "v", SeriesId: "s", ParentIndexNumber: 2, IndexNumber: 1, LocationType: "Virtual" },
      { Id: "sp", SeriesId: "s", ParentIndexNumber: 0 },
    ];
    const s = summariseEpisodes(eps).get("s")!;
    expect(s.perSeason).toEqual({ "1": 3, "0": 1 });
    expect(s.watched).toBe(3);
    expect(s.last).toEqual({ code: "S1 · E2", name: "Double", at: Date.parse("2026-02-01T00:00:00Z") });
  });
});

describe("visibility tags", () => {
  it("replaces only Argent's own tags", () => {
    const tags = withVisibility(["Anime", hideTag(ALICE)], [BOB], ALICE);
    expect(tags).toEqual(["Anime", privateTag(ALICE), hideTag(BOB)]);
    expect(visibilityOf(tags)).toEqual({ hiddenFrom: [BOB.slice(0, 8)], owner: ALICE.slice(0, 8) });
    expect(withVisibility(tags, [])).toEqual(["Anime"]);
  });

  it("uses lower-case tags Jellyfin's blocked-tag check matches", () => {
    expect(hideTag("A1B2C3D4-E5F6-0000-0000-000000000000")).toBe("argent-hidden-a1b2c3d4");
  });
});

describe("sync", () => {
  it("round-trips through server prefs, tombstones included", () => {
    let s = applyScan(emptyVault(), [show(), film()], 1000).state;
    s = forget(s, ["m1"], 2000);
    expect(mergeCustomPrefs(emptyVault(), toCustomPrefs(s))).toEqual(s);
  });

  it("lets the newer change win and keeps the earliest first-seen date", () => {
    const a = applyScan(emptyVault(), [show()], 1000).state;
    const b = setHidden(applyScan(emptyVault(), [show()], 500).state, "s1", true, 3000);
    const merged = mergeCustomPrefs(a, toCustomPrefs(b));
    expect(merged.entries.s1).toMatchObject({ hidden: true, added: 500 });
    // An older deletion doesn't remove a newer entry.
    const stale = mergeCustomPrefs(a, { "v:s1": JSON.stringify({ removedAt: 10 }) });
    expect(stale.entries.s1).toBeDefined();
  });

  it("drops malformed entries", () => {
    expect(normalise({ entries: { a: { id: "a" }, b: null }, removed: { c: "x" } })).toEqual(emptyVault());
  });
});

describe("the list", () => {
  const state = (() => {
    let s = applyScan(emptyVault(), [show(), film(), film({ id: "m2", name: "The Arrival", ids: { Tmdb: "1" } })], 1000).state;
    s = applyScan(s, [show({ perSeason: { "1": 9 } }), film({ id: "m2", name: "The Arrival", ids: { Tmdb: "1" } })], 2000).state;
    return setHidden(s, "m2", true);
  })();

  it("filters by status, kind and search, keeping hidden titles to themselves", () => {
    const all = rows(state);
    const names = (f: Parameters<typeof filterRows>[1]) => filterRows(all, f).map((r) => r.entry.name);
    const base = { filter: "all", kind: "all", query: "", sort: "name" } as const;
    expect(names(base)).toEqual(["Dune", "Severance"]);
    expect(names({ ...base, filter: "missing" })).toEqual(["Dune"]);
    expect(names({ ...base, filter: "incomplete" })).toEqual(["Severance"]);
    expect(names({ ...base, filter: "library" })).toEqual(["Severance"]);
    expect(names({ ...base, filter: "hidden" })).toEqual(["The Arrival"]);
    expect(names({ ...base, kind: "Movie" })).toEqual(["Dune"]);
    expect(names({ ...base, query: "sever" })).toEqual(["Severance"]);
  });

  it("counts what's there", () => {
    expect(statsOf(rows(state))).toMatchObject({ shows: 1, movies: 1, library: 1, missing: 1, incomplete: 1, hidden: 1, episodes: 9 });
  });

  it("exports JSON that imports back as missing until checked", () => {
    const parsed = parseImport(toJson(state));
    expect(parsed && Object.keys(parsed.entries).sort()).toEqual(["m1", "m2", "s1"]);
    const { state: merged, added } = importInto(emptyVault(), parsed!, 5000);
    expect(added).toBe(3);
    expect(merged.entries.s1.missing).toBe(5000);
    expect(parseImport("{}")).toBeNull();
  });

  it("exports CSV with quoting", () => {
    const csv = toCsv(rows(applyScan(emptyVault(), [film({ name: 'Crouching "Tiger", Hidden' })], 0).state));
    expect(csv.split("\r\n")[1]).toMatch(/^"Crouching ""Tiger"", Hidden",Movie,2021,In library,/);
  });
});

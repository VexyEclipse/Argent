import { describe, expect, it } from "vitest";
import type { MediaSegment } from "@/api/types";
import { autoSkipNow, skipLabel } from "./playerLogic";
import {
  chapterSegments,
  cleanSkipName,
  continueJump,
  editedRange,
  formatSkipTime,
  parseSkipTime,
  correctedRange,
  isIntroJump,
  JUMP_WINDOW_MS,
  learnedSegment,
  matchedRange,
  recordJump,
  savedSkips,
  seasonKey,
  withFoundSegments,
  type Jump,
} from "./skipLearning";

const T = 10_000_000;
const ch = (start: number, Name?: string) => ({ StartPositionTicks: start * T, Name });
const span = (s: MediaSegment) => [s.Type, s.StartTicks / T, s.EndTicks / T];

describe("chapterSegments", () => {
  // A typical anime episode: cold open, OP, part A, part B, ED, preview.
  const anime = [ch(0, "Prologue"), ch(95, "Opening"), ch(185, "Part A"), ch(700, "Part B"), ch(1290, "Ending"), ch(1380, "Preview")];

  it("reads the opening, ending and preview", () => {
    expect(chapterSegments(anime, 1410, true, "e").map(span)).toEqual([
      ["Intro", 95, 185],
      ["Outro", 1290, 1380],
      ["Preview", 1380, 1410],
    ]);
  });

  it("marks them as found in the chapters", () => {
    expect(chapterSegments(anime, 1410, true, "e").every((s) => s.Source === "chapter" && s.ItemId === "e")).toBe(true);
  });

  it("understands numbered and annotated names", () => {
    const names = ["OP2", "OP - Unravel", "Opening (Creditless)", "Opening Theme", "オープニング"];
    for (const name of names) expect(chapterSegments([ch(0, "Cold open"), ch(60, name), ch(150, "Part A")], 1400, true, "e").map((s) => s.Type), name).toEqual(["Intro"]);
  });

  it("ignores ordinary chapter names", () => {
    expect(chapterSegments([ch(0, "Chapter 1"), ch(90, "Chapter 2"), ch(600, "Introduction"), ch(900, "Cold Open")], 1400, true, "e")).toEqual([]);
    expect(chapterSegments([ch(0, "Prologue"), ch(90, "Edward's Story")], 1400, true, "e")).toEqual([]);
  });

  it("takes an Intro chapter for the cold open it usually is", () => {
    // Releases name the part before the opening "Intro".
    expect(chapterSegments([ch(0, "Intro"), ch(59, "Opening"), ch(149, "Part A"), ch(1443, "Ending")], 1534, true, "e").map(span)).toEqual([
      ["Intro", 59, 149],
      ["Outro", 1443, 1534],
    ]);
    expect(chapterSegments([ch(0, "Intro"), ch(104, "Part A")], 1400, true, "e")).toEqual([]);
  });

  it("reads the credits between start and end markers", () => {
    const marked = [ch(0, "Prologue"), ch(173, "Opening"), ch(275, "Episode"), ch(1325, "Credits Start"), ch(1415, "Credits End"), ch(1430, "Preview End")];
    expect(chapterSegments(marked, 1440, true, "e").map(span)).toEqual([
      ["Intro", 173, 275],
      ["Outro", 1325, 1415],
    ]);
    const withPreview = [ch(0, "Episode"), ch(1851, "Credits Start"), ch(1915, "Credits End"), ch(1916, "Preview Start"), ch(1921, "Preview End")];
    expect(chapterSegments(withPreview, 1926, true, "e").map(span)).toEqual([
      ["Outro", 1851, 1915],
      ["Preview", 1916, 1921],
    ]);
  });

  it("knows PV and Next as previews", () => {
    expect(chapterSegments([ch(0, "Main EP"), ch(1345, "ED"), ch(1435, "PV")], 1442, true, "e").map(span)).toEqual([
      ["Outro", 1345, 1435],
      ["Preview", 1435, 1442],
    ]);
    expect(chapterSegments([ch(0, "Avant"), ch(342, "Part A"), ch(1325, "ED"), ch(1415, "Next")], 1422, true, "e").map((s) => s.Type)).toEqual(["Outro", "Preview"]);
  });

  it("doesn't take an opening played at the end of an episode", () => {
    expect(chapterSegments([ch(0, "Avant"), ch(219, "Part A"), ch(1304, "OP"), ch(1394, "Part C")], 1440, true, "e")).toEqual([]);
  });

  it("finds a recap at the start", () => {
    expect(chapterSegments([ch(0, "Previously on Severance"), ch(70, "Episode")], 3000, true, "e").map(span)).toEqual([["Recap", 0, 70]]);
  });

  it("doesn't take a credits chapter with a scene after it", () => {
    const withScene = [ch(0), ch(90, "OP"), ch(180), ch(1290, "ED"), ch(1380, "Epilogue")];
    expect(chapterSegments(withScene, 1420, true, "e").map((s) => s.Type)).toEqual(["Intro"]);
  });

  it("reads a film's end credits but not a chapter called Ending", () => {
    const film = [ch(0, "Start"), ch(5400, "Ending"), ch(6600, "End Credits")];
    expect(chapterSegments(film, 7100, false, "f").map(span)).toEqual([["Outro", 6600, 7100]]);
  });

  it("skips chapters that are the wrong length or in the wrong half", () => {
    // A 9-minute "Opening" is a mislabelled chapter; an opening near the end isn't one.
    expect(chapterSegments([ch(0), ch(60, "Opening"), ch(600)], 1400, true, "e")).toEqual([]);
    expect(chapterSegments([ch(0), ch(1000, "Opening"), ch(1090)], 1400, true, "e")).toEqual([]);
    // Without a duration the last chapter has no end.
    expect(chapterSegments([ch(0), ch(1300, "Preview")], 0, true, "e")).toEqual([]);
  });

  it("takes only the first of each kind", () => {
    expect(chapterSegments([ch(0), ch(60, "OP"), ch(150), ch(300, "OP"), ch(390)], 1400, true, "e").map(span)).toEqual([["Intro", 60, 150]]);
  });
});

describe("withFoundSegments", () => {
  const seg = (Type: MediaSegment["Type"], Source?: MediaSegment["Source"]): MediaSegment => ({ Id: `${Type}-${Source}`, ItemId: "e", Type, StartTicks: 0, EndTicks: 60 * T, Source });

  it("waits for the server", () => expect(withFoundSegments(undefined, [seg("Intro", "chapter")])).toBeUndefined());

  it("keeps the server's own and adds kinds it lacks", () => {
    const server = [seg("Intro")];
    expect(withFoundSegments(server, [seg("Intro", "chapter"), seg("Outro", "chapter")])!.map((s) => s.Id)).toEqual(["Intro-undefined", "Outro-chapter"]);
  });

  it("prefers a chapter's opening to a learned one", () => {
    expect(withFoundSegments([], [seg("Intro", "chapter"), seg("Intro", "learned")])!.map((s) => s.Source)).toEqual(["chapter"]);
  });

  it("returns the server's list as is when nothing is added", () => {
    const server = [seg("Intro")];
    expect(withFoundSegments(server, [])).toBe(server);
  });
});

describe("seasonKey", () => {
  it("is the season", () => expect(seasonKey({ Type: "Episode", SeriesId: "s", SeasonId: "s2" })).toBe("s2"));
  it("falls back to the show and season number", () => expect(seasonKey({ Type: "Episode", SeriesId: "s", ParentIndexNumber: 2 })).toBe("s:2"));
  it("is nothing for a film", () => expect(seasonKey({ Type: "Movie" })).toBeUndefined());
});

describe("continueJump", () => {
  it("joins quick presses of → into one jump", () => {
    let open = continueJump(null, 40, 50, 0);
    for (let i = 1; i < 9; i++) open = continueJump(open, 40 + i * 10 + 0.4, 50 + i * 10, i * 500);
    expect(open).toEqual({ from: 40, to: 130, at: 4000 });
  });

  it("starts again after a pause", () => {
    const open = continueJump(null, 40, 50, 0);
    expect(continueJump(open, 50, 60, JUMP_WINDOW_MS + 1)).toEqual({ from: 50, to: 60, at: JUMP_WINDOW_MS + 1 });
  });

  it("starts again from somewhere else", () => {
    const open = continueJump(null, 40, 50, 0);
    expect(continueJump(open, 300, 320, 1000)?.from).toBe(300);
  });

  it("takes a nudge back after overshooting", () => {
    const open = continueJump(null, 40, 160, 0);
    expect(continueJump(open, 160, 150, 1000)).toEqual({ from: 40, to: 150, at: 1000 });
  });

  it("drops a jump that ends up going back", () => {
    expect(continueJump(null, 100, 90, 0)).toBeNull();
    expect(continueJump(continueJump(null, 40, 50, 0), 50, 30, 500)).toBeNull();
  });
});

describe("isIntroJump", () => {
  it("is an intro-length jump near the start", () => expect(isIntroJump(40, 130, 1420)).toBe(true));
  it("isn't a short nudge or a long leap", () => {
    expect(isIntroJump(40, 50, 1420)).toBe(false);
    expect(isIntroJump(40, 600, 1420)).toBe(false);
  });
  it("isn't late in the episode", () => {
    expect(isIntroJump(800, 890, 1420)).toBe(false);
    expect(isIntroJump(800, 890, 5000)).toBe(false);
  });
});

describe("learning a season's intro", () => {
  const jump = (ep: string, from: number, to: number): Jump => ({ ep, from, to, at: 0 });

  it("needs two episodes", () => {
    const one = recordJump(undefined, jump("e1", 40, 130));
    expect(matchedRange(one, jump("e1", 40, 130))).toBeUndefined();
    const again = recordJump(one, jump("e1", 41, 131));
    expect(again.jumps).toHaveLength(1);
    expect(matchedRange(again, jump("e1", 41, 131))).toBeUndefined();
  });

  it("offers only what both jumps passed over", () => {
    const entry = recordJump(recordJump(undefined, jump("e1", 38, 131)), jump("e2", 42, 127));
    expect(matchedRange(entry, jump("e2", 42, 127))).toEqual({ start: 42, end: 127 });
  });

  it("doesn't match jumps over different parts", () => {
    const entry = recordJump(recordJump(undefined, jump("e1", 40, 130)), jump("e2", 95, 185));
    expect(matchedRange(entry, jump("e2", 95, 185))).toBeUndefined();
  });

  it("doesn't offer again once a season has a skip", () => {
    const entry = { ...recordJump(recordJump(undefined, jump("e1", 40, 130)), jump("e2", 40, 130)), range: { start: 40, end: 130 } };
    expect(matchedRange(entry, jump("e2", 40, 130))).toBeUndefined();
  });

  it("keeps the latest few jumps", () => {
    let entry = recordJump(undefined, jump("e0", 40, 130));
    for (let i = 1; i < 10; i++) entry = recordJump(entry, jump(`e${i}`, 40, 130));
    expect(entry.jumps.map((j) => j.ep)).toEqual(["e4", "e5", "e6", "e7", "e8", "e9"]);
  });
});

describe("learnedSegment", () => {
  const entry = { jumps: [], range: { start: 42, end: 127 } };
  it("is an intro in every episode of the season", () => {
    const s = learnedSegment(entry, "e7", 1420)!;
    expect(span(s)).toEqual(["Intro", 42, 127]);
    expect(s.Source).toBe("learned");
    expect(s.ItemId).toBe("e7");
  });
  it("is nothing before it's confirmed", () => expect(learnedSegment({ jumps: [] }, "e7", 1420)).toBeUndefined());
  it("leaves out an episode too short for it", () => expect(learnedSegment(entry, "e7", 200)).toBeUndefined());

  it("goes anywhere in episodes as long as the one it was saved in", () => {
    const ending = { jumps: [], range: { start: 1290, end: 1380 }, ref: 1420 };
    expect(learnedSegment(ending, "e7", 1440)).toBeDefined();
    expect(learnedSegment(ending, "e7", 2840)).toBeUndefined();
    expect(learnedSegment({ ...ending, range: { start: 40, end: 130 } }, "e7", 600)).toBeUndefined();
  });

  it("asks first unless set to skip automatically, whatever the setting for intros", () => {
    const run = (s: MediaSegment, intro: boolean) => autoSkipNow([s], 50, { intro, credits: true }, { hasNext: true, done: new Set() });
    const asks = learnedSegment(entry, "e7", 1420)!;
    expect(asks.Auto).toBeUndefined();
    expect(run(asks, true)).toBeUndefined();
    const auto = learnedSegment({ ...entry, auto: true }, "e7", 1420)!;
    expect(run(auto, false)).toBe(auto);
    const chapter = { ...asks, Source: "chapter" as const };
    expect(run(chapter, true)).toBe(chapter);
    expect(run(chapter, false)).toBeUndefined();
  });

  it("carries its name for the Skip card", () => {
    expect(learnedSegment({ ...entry, name: "Opening" }, "e7", 1420)?.Label).toBe("Opening");
    expect(skipLabel("Intro", "Opening")).toBe("Skip Opening");
    expect(skipLabel("Intro", undefined)).toBe("Skip Intro");
  });

  it("tidies names", () => {
    expect(cleanSkipName("  Theme   song ")).toBe("Theme song");
    expect(cleanSkipName("intro")).toBeUndefined();
    expect(cleanSkipName("   ")).toBeUndefined();
    expect(cleanSkipName("x".repeat(40))).toHaveLength(24);
  });
});

describe("editing a skip by hand", () => {
  const range = { start: 42.4, end: 132.8 };

  it("moves one edge", () => {
    expect(editedRange(range, "start", 41.9, 1420)).toEqual({ start: 41.9, end: 132.8 });
    expect(editedRange(range, "end", 133.33, 1420)).toEqual({ start: 42.4, end: 133.3 });
  });

  it("keeps the edges in order and inside the episode", () => {
    expect(editedRange(range, "start", 200, 1420)).toEqual({ start: 131.8, end: 132.8 });
    expect(editedRange(range, "end", 10, 1420)).toEqual({ start: 42.4, end: 43.4 });
    expect(editedRange(range, "start", -3, 1420)).toEqual({ start: 0, end: 132.8 });
    expect(editedRange(range, "end", 5000, 1420)).toEqual({ start: 42.4, end: 1420 });
  });

  it("allows a short skip set by hand", () => {
    expect(learnedSegment({ jumps: [], range: { start: 0, end: 6.5 } }, "e", 1420)?.EndTicks).toBe(6.5 * T);
  });

  it("shows times to the tenth of a second", () => {
    expect(formatSkipTime(132.8)).toBe("2:12.8");
    expect(formatSkipTime(42.96)).toBe("0:43.0");
    expect(formatSkipTime(3723.5)).toBe("1:02:03.5");
    expect(formatSkipTime(-1)).toBe("0:00.0");
  });

  it("reads typed times", () => {
    expect(parseSkipTime("2:12.8")).toBe(132.8);
    expect(parseSkipTime(" 132,8 ")).toBe(132.8);
    expect(parseSkipTime("1:02:03")).toBe(3723);
    expect(parseSkipTime("0:42.")).toBe(42);
  });

  it("refuses what isn't a time", () => {
    for (const bad of ["", "abc", "1:75", "1:2:3:4", "-5", "1::2", "2:12.8s"]) expect(parseSkipTime(bad), bad).toBeUndefined();
  });

  it("round-trips", () => {
    for (const t of [0, 9.9, 42.4, 132.8, 3599.9]) expect(parseSkipTime(formatSkipTime(t))).toBe(t);
  });
});

describe("correctedRange", () => {
  const range = { start: 40, end: 130 };
  it("ends where the viewer went back to", () => expect(correctedRange(range, 118)).toEqual({ start: 40, end: 118 }));
  it("leaves it when they went back to watch it all", () => expect(correctedRange(range, 41)).toBeUndefined());
  it("leaves it when they didn't land inside it", () => {
    expect(correctedRange(range, 130)).toBeUndefined();
    expect(correctedRange(range, 20)).toBeUndefined();
  });
});

describe("savedSkips", () => {
  const r = { start: 40, end: 130 };
  it("lists seasons with a skip, by show and season", () => {
    const map = {
      a: { jumps: [], range: r, show: "Mob Psycho 100", seasonName: "Season 10" },
      b: { jumps: [], range: r, show: "Mob Psycho 100", seasonName: "Season 2" },
      c: { jumps: [], range: r, show: "Frieren", seasonName: "Season 1" },
      d: { jumps: [{ ep: "e", from: 1, to: 50, at: 0 }] },
      e: { jumps: [], range: r },
    };
    expect(savedSkips(map).map((s) => s.key)).toEqual(["c", "b", "a", "e"]);
  });
});

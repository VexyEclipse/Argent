import { describe, expect, it } from "vitest";
import type { MediaSegment } from "@/api/types";
import { activeSkip, missingTrack, shouldAskStillWatching, startTicks, subtitleChange, toggledSubtitle, upNextAt } from "./playerLogic";

const T = 10_000_000;
const seg = (Type: MediaSegment["Type"], start: number, end: number): MediaSegment => ({ Id: Type, ItemId: "i", Type, StartTicks: start * T, EndTicks: end * T });

describe("startTicks", () => {
  const item = { UserData: { PlaybackPositionTicks: 600 * T, PlayedPercentage: 40 } };
  it("resumes by default", () => expect(startTicks(item as never, null)).toBe(600 * T));
  it("honours ?start=", () => expect(startTicks(item as never, "0")).toBe(0));
  it("starts over when basically finished", () => expect(startTicks({ UserData: { PlaybackPositionTicks: 5000 * T, PlayedPercentage: 97 } } as never, null)).toBe(0));
  it("ignores a broken ?start=", () => expect(startTicks(item as never, "abc")).toBe(600 * T));
});

describe("subtitleChange", () => {
  const state = { subtitleIndex: 3, textTracks: [{ index: 3 }, { index: 4 }], assTracks: [{ index: 5 }] };
  it("switches between drawn subtitles instantly", () => {
    expect(subtitleChange(state, 4)).toBe("local");
    expect(subtitleChange(state, 5)).toBe("local");
    expect(subtitleChange(state, -1)).toBe("local");
  });
  it("needs a new stream for an image subtitle", () => expect(subtitleChange(state, 7)).toBe("reload"));
  it("needs a new stream to drop a burned-in subtitle", () => expect(subtitleChange({ ...state, subtitleIndex: 7 }, -1)).toBe("reload"));
  it("C toggles off, then on to the first text track", () => {
    expect(toggledSubtitle(state)).toBe(-1);
    expect(toggledSubtitle({ ...state, subtitleIndex: -1 })).toBe(3);
  });
});

describe("segments", () => {
  const segments = [seg("Intro", 60, 150), seg("Outro", 1300, 1400)];
  it("offers to skip the intro, except in its last second", () => {
    expect(activeSkip(segments, 80)?.Type).toBe("Intro");
    expect(activeSkip(segments, 149.5)).toBeUndefined();
    expect(activeSkip(segments, 1350)).toBeUndefined();
  });
  it("shows Up Next at the credits, else 30 s from the end", () => {
    expect(upNextAt(segments, 1400)).toBe(1300);
    expect(upNextAt([], 1400)).toBe(1370);
  });
});

describe("missingTrack", () => {
  const ok = { hasAudioTrack: true, audioBytes: 1000, mozHasAudio: null, videoFrames: 200 };
  it("passes healthy playback", () => expect(missingTrack(ok)).toBeNull());
  it("spots silence in Chromium and Firefox", () => {
    expect(missingTrack({ ...ok, audioBytes: 0 })).toBe("audio");
    expect(missingTrack({ ...ok, audioBytes: null, mozHasAudio: false })).toBe("audio");
  });
  it("doesn't call a silent file silent", () => expect(missingTrack({ ...ok, hasAudioTrack: false, audioBytes: 0 })).toBeNull());
  it("spots a missing picture", () => expect(missingTrack({ ...ok, videoFrames: 0 })).toBe("picture"));
  it("ignores counters that aren't reported", () => expect(missingTrack({ hasAudioTrack: true, audioBytes: null, mozHasAudio: null, videoFrames: null })).toBeNull());
});

it("asks if anyone's watching after three unattended episodes", () => {
  expect(shouldAskStillWatching(2)).toBe(false);
  expect(shouldAskStillWatching(3)).toBe(true);
});

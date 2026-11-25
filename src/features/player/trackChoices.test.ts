import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BaseItem, MediaStream } from "@/api/types";
import { carriedTracks, describeTrack, matchTrack, rememberTrack } from "./trackChoices";

beforeAll(() => {
  // Kept in memory; never sent to a server.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) });
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => {} });
});

const sub = (Index: number, Language: string | undefined, Title?: string, extra: Partial<MediaStream> = {}): MediaStream => ({
  Index,
  Type: "Subtitle",
  Language,
  Title,
  Codec: "ass",
  ...extra,
});
const audio = (Index: number, Language: string): MediaStream => ({ Index, Type: "Audio", Language, Codec: "aac" });

// Two files of one show: the same kinds of track, numbered differently.
const ep1: MediaStream[] = [audio(1, "eng"), audio(2, "jpn"), sub(3, "eng", "Full [BD]"), sub(4, "eng", "Signs", { IsForced: true })];
const ep2: MediaStream[] = [audio(1, "jpn"), audio(2, "eng"), sub(5, "eng", "Signs", { IsForced: true }), sub(6, "eng", "Full [BD]")];
const episode = (Id: string): BaseItem => ({ Id, Name: Id, Type: "Episode", SeriesId: "show" });

describe("subtitle and audio carried across episodes", () => {
  it("finds the same kind of track in another file", () => {
    expect(matchTrack(ep2, "Subtitle", describeTrack(ep1[2]))).toBe(6);
    expect(matchTrack(ep2, "Subtitle", describeTrack(ep1[3]))).toBe(5);
    expect(matchTrack(ep2, "Audio", describeTrack(ep1[1]))).toBe(1);
    // Another title in the same language still beats the server's default.
    expect(matchTrack([sub(7, "eng", "English (Full)")], "Subtitle", describeTrack(ep1[2]))).toBe(7);
    // No track in that language: the server's default stands.
    expect(matchTrack([sub(8, "spa")], "Subtitle", describeTrack(ep1[2]))).toBeUndefined();
  });

  it("starts the next episode with what was picked in the last, off included", () => {
    rememberTrack("u1", episode("e1"), ep1, "Audio", 2);
    rememberTrack("u1", episode("e1"), ep1, "Subtitle", 4);
    expect(carriedTracks("u1", episode("e2"), ep2, {})).toEqual({ audioIndex: 1, subtitleIndex: 5 });
    rememberTrack("u1", episode("e2"), ep2, "Subtitle", -1);
    expect(carriedTracks("u1", episode("e3"), ep1, {})).toEqual({ audioIndex: 2, subtitleIndex: -1 });
  });

  it("follows the user's Jellyfin settings, and leaves films and other users alone", () => {
    rememberTrack("u2", episode("e1"), ep1, "Subtitle", 3);
    expect(carriedTracks("u2", episode("e2"), ep2, { RememberSubtitleSelections: false })).toEqual({});
    expect(carriedTracks("u2", { ...episode("m"), Type: "Movie" }, ep2, {})).toEqual({});
    expect(carriedTracks("u3", episode("e2"), ep2, {})).toEqual({});
  });
});

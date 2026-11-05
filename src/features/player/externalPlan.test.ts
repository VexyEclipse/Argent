import { describe, expect, it } from "vitest";
import type { MediaSource, MediaStream } from "@/api/types";
import type { NativeCapabilities } from "@/platform/android";
import { buildExternalRequest, indexOfOrdinal, mpvProfile, nativeProfile, ordinalOf } from "./externalPlan";

const caps = (over: Partial<NativeCapabilities> = {}): NativeCapabilities => ({
  sdk: 34,
  model: "TV",
  tv: true,
  video: { h264: true, hevc: true, hevc10: true, av1: false, vp9: true, vp8: true, mpeg2: false, vc1: false },
  hdr: { hdr10: true, hlg: true, dolbyVision: false, hdr10plus: false },
  audio: { aac: true, mp3: true, opus: true, flac: true, vorbis: true, alac: false, ac3: true, eac3: true, truehd: false, dts: false, dtshd: false, pcm: true },
  passthrough: { ac3: true, eac3: true, truehd: false, dts: false, dtshd: false },
  maxChannels: 6,
  display: { width: 3840, height: 2160, refreshRates: [60, 50, 24] },
  ...over,
});

describe("nativeProfile", () => {
  it("direct-plays what the device decodes or passes through", () => {
    const p = nativeProfile(caps(), 120_000_000);
    const video = p.DirectPlayProfiles[0];
    expect(video.Container).toContain("mkv");
    expect(video.VideoCodec).toBe("h264,hevc,vp9,vp8");
    expect(video.AudioCodec).toContain("eac3");
    expect(video.AudioCodec).not.toContain("truehd");
  });
  it("lets the server tone-map only the HDR formats the TV lacks", () => {
    const hevc = nativeProfile(caps(), 1).CodecProfiles.find((c) => c.Codec === "hevc")!;
    const range = hevc.Conditions.find((c) => c.Property === "VideoRangeType")!.Value;
    expect(range.split("|")).toEqual(["SDR", "HDR10", "DOVIWithHDR10", "HLG", "DOVIWithHLG"]);
    const dv = nativeProfile(caps({ hdr: { hdr10: true, hlg: false, dolbyVision: true, hdr10plus: false } }), 1).CodecProfiles.find((c) => c.Codec === "hevc")!;
    expect(dv.Conditions.find((c) => c.Property === "VideoRangeType")!.Value).toContain("DOVI|");
  });
  it("keeps image subtitles inside the file", () => {
    const subs = nativeProfile(caps(), 1).SubtitleProfiles;
    expect(subs.find((s) => s.Format === "pgssub")?.Method).toBe("Embed");
  });
  it("mpv direct-plays anything", () => expect(mpvProfile(1).DirectPlayProfiles).toEqual([{ Type: "Video" }, { Type: "Audio" }]));
});

const s = (x: Partial<MediaStream> & Pick<MediaStream, "Index" | "Type">) => x as MediaStream;
const source: MediaSource = {
  Id: "src",
  SupportsDirectPlay: true,
  SupportsDirectStream: true,
  SupportsTranscoding: true,
  MediaStreams: [
    s({ Index: 0, Type: "Video", RealFrameRate: 23.976 }),
    s({ Index: 1, Type: "Audio", Language: "jpn" }),
    s({ Index: 2, Type: "Audio", Language: "eng" }),
    s({ Index: 3, Type: "Subtitle", Codec: "ass", Language: "eng" }),
    s({ Index: 4, Type: "Subtitle", Codec: "PGSSUB", Language: "eng" }),
    s({ Index: 5, Type: "Subtitle", Codec: "srt", IsExternal: true, DeliveryUrl: "/Videos/x/Subtitles/5/0/Stream.srt", Language: "fre", DisplayTitle: "French" }),
  ],
};

describe("track ordinals", () => {
  it("maps Jellyfin indexes to the file's own track order and back", () => {
    expect(ordinalOf(source, "Audio", 2)).toBe(1);
    expect(ordinalOf(source, "Subtitle", 4)).toBe(1);
    expect(indexOfOrdinal(source, "Audio", 1)).toBe(2);
    expect(indexOfOrdinal(source, "Subtitle", -1)).toBe(-1);
    expect(indexOfOrdinal(source, "Subtitle", undefined)).toBeUndefined();
  });
});

describe("buildExternalRequest", () => {
  const base = {
    url: "http://server/stream",
    method: "DirectPlay" as const,
    source,
    title: "Show",
    startSeconds: 30,
    durationSeconds: 1400,
    hasPrevious: false,
    matchFrameRate: true,
    authorise: (u: string) => `http://server${u}?ApiKey=k`,
  };
  it("picks the file's own tracks for Direct Play", () => {
    const r = buildExternalRequest({ ...base, audioIndex: 2, subtitleIndex: 4 });
    expect(r.audio).toEqual({ ordinal: 1, language: "eng" });
    expect(r.subtitleChoice).toEqual({ kind: "embedded", ordinal: 1, language: "eng" });
    expect(r.frameRate).toBe(23.976);
  });
  it("hands sidecar subtitles over as files", () => {
    const r = buildExternalRequest({ ...base, subtitleIndex: 5 });
    expect(r.subtitles).toEqual([{ index: 5, url: "http://server/Videos/x/Subtitles/5/0/Stream.srt?ApiKey=k", label: "French", language: "fre", mime: "application/x-subrip" }]);
    expect(r.subtitleChoice).toEqual({ kind: "external", index: 5 });
  });
  it("only offers Up Next when there is a next episode", () => {
    expect(buildExternalRequest({ ...base, upNextAt: 1370 }).upNextAt).toBeUndefined();
    expect(buildExternalRequest({ ...base, upNextAt: 1370, nextTitle: "S1:E2" }).upNextAt).toBe(1370);
  });
});

import { describe, expect, it } from "vitest";
import type { MediaSource, MediaStream } from "@/api/types";
import { asVtt, builtTracks, deliveryOf, pickSource, resolutionLabel, serverWork, versionLabel, versionOption, versionSpec } from "./streamPlan";

const stream = (s: Partial<MediaStream> & Pick<MediaStream, "Index" | "Type">): MediaStream => s as MediaStream;
const source = (s: Partial<MediaSource>): MediaSource => ({ Id: "a", SupportsDirectPlay: false, SupportsDirectStream: false, SupportsTranscoding: true, MediaStreams: [], ...s });

describe("pickSource", () => {
  const versions = [{ Id: "uhd" }, { Id: "hd" }];
  it("plays the version asked for", () => expect(pickSource(versions, "hd")?.Id).toBe("hd"));
  it("falls back to the first when the version is gone", () => expect(pickSource(versions, "gone")?.Id).toBe("uhd"));
  it("handles titles without versions", () => expect(pickSource([], "x")).toBeUndefined());
});

describe("version labels", () => {
  it("names a version by width, so a wide 1080p film is still 1080p", () => {
    expect(resolutionLabel(1920, 800)).toBe("1080p");
    expect(resolutionLabel(3840, 1600)).toBe("4K");
    expect(resolutionLabel(1280, 720)).toBe("720p");
    expect(resolutionLabel(undefined, undefined)).toBeUndefined();
  });
  it("prefers Jellyfin's name, then the resolution", () => {
    expect(versionLabel(source({ Name: "Director's Cut" }))).toBe("Director's Cut");
    expect(versionLabel(source({ MediaStreams: [stream({ Index: 0, Type: "Video", Width: 3840, Height: 2160 })] }))).toBe("4K");
    expect(versionLabel(source({}), 1)).toBe("Version 2");
  });
  it("describes resolution, codec, HDR and size", () => {
    const s = source({ Size: 52 * 1024 ** 3, MediaStreams: [stream({ Index: 0, Type: "Video", Width: 3840, Height: 2160, Codec: "hevc", VideoRangeType: "DOVIWithHDR10" })] });
    expect(versionSpec(s)).toBe("4K · HEVC · Dolby Vision · 52 GB");
  });
});

it("doesn't repeat the name in a version's details", () => {
  const hd = source({ Name: "1080p", Size: 2 * 1024 ** 3, MediaStreams: [stream({ Index: 0, Type: "Video", Width: 1920, Height: 800, Codec: "h264" })] });
  expect(versionOption(hd)).toEqual({ label: "1080p", detail: "H264 · 2.0 GB" });
  const uhd = source({ Name: "4K HDR", MediaStreams: [stream({ Index: 0, Type: "Video", Width: 3840, Codec: "hevc", VideoRangeType: "HDR10" })] });
  expect(versionOption(uhd)).toEqual({ label: "4K HDR", detail: "HEVC · HDR10" });
});

describe("serverWork", () => {
  const s = source({
    MediaStreams: [
      stream({ Index: 1, Type: "Audio", IsDefault: true }),
      stream({ Index: 2, Type: "Audio" }),
      stream({ Index: 3, Type: "Subtitle", DeliveryMethod: "External" }),
      stream({ Index: 4, Type: "Subtitle", DeliveryMethod: "Encode" }),
    ],
  });
  it("needs nothing for the file's default audio and a text subtitle", () => expect(serverWork(s, 1, 3)).toEqual({ audio: false, burnIn: false }));
  it("needs the server for another audio track", () => expect(serverWork(s, 2, -1).audio).toBe(true));
  it("needs the server to burn in an image subtitle", () => expect(serverWork(s, 1, 4).burnIn).toBe(true));
});

describe("deliveryOf", () => {
  it("prefers Direct Play, then Direct Stream, then Transcode", () => {
    expect(deliveryOf({ SupportsDirectPlay: true, SupportsDirectStream: true, TranscodingUrl: "/x" })).toBe("DirectPlay");
    expect(deliveryOf({ SupportsDirectPlay: false, SupportsDirectStream: true })).toBe("DirectStream");
    expect(deliveryOf({ SupportsDirectPlay: false, SupportsDirectStream: true, TranscodingUrl: "/x" })).toBe("Transcode");
    expect(deliveryOf({ SupportsDirectPlay: false, SupportsDirectStream: false })).toBeNull();
  });
});

describe("builtTracks", () => {
  it("reads the tracks and reasons from the transcode URL", () => {
    const r = builtTracks("/videos/1/master.m3u8?AudioStreamIndex=3&SubtitleStreamIndex=5&TranscodeReasons=VideoCodecNotSupported,AudioCodecNotSupported", { audioIndex: 1, subtitleIndex: 5 }, true);
    expect(r).toEqual({ audioIndex: 3, subtitleIndex: 5, reasons: ["VideoCodecNotSupported", "AudioCodecNotSupported"] });
  });
  it("reports subtitles off when a burn-in was dropped", () => expect(builtTracks("/x?AudioStreamIndex=1", { subtitleIndex: 5 }, true).subtitleIndex).toBe(-1));
  it("keeps the request for direct streams", () => expect(builtTracks(null, { audioIndex: 2, subtitleIndex: 4 }, false)).toEqual({ audioIndex: 2, subtitleIndex: 4, reasons: [] }));
});

it("asks for WebVTT", () => {
  expect(asVtt("/Videos/1/1/Subtitles/3/0/Stream.srt?ApiKey=x")).toBe("/Videos/1/1/Subtitles/3/0/Stream.vtt?ApiKey=x");
  expect(asVtt("/Videos/1/Stream.ass")).toBe("/Videos/1/Stream.vtt");
});

// What Argent asks of a player outside the page (the Android app's Media3 player, or mpv
// in the desktop app): the device profile the server plans the stream with, and the
// request the player opens. Pure, covered by externalPlan.test.ts.

import type { MediaSegment, MediaSource, MediaStream } from "@/api/types";
import type { NativeCapabilities } from "@/platform/android";
import type { PlayMethod } from "./streamPlan";

const TICKS = 10_000_000;

const list = (entries: [string, boolean | undefined][]) =>
  entries
    .filter(([, ok]) => ok)
    .map(([name]) => name)
    .join(",");

/**
 * A profile from what the Android device really decodes (MediaCodecList) and passes
 * through to a receiver (AudioCapabilities), including its HDR formats, so the server
 * only converts what the TV can't show.
 */
export function nativeProfile(caps: NativeCapabilities, maxBitrate: number) {
  const v = caps.video;
  const a = caps.audio;
  const video = list([
    ["h264", v.h264],
    ["hevc", v.hevc],
    ["av1", v.av1],
    ["vp9", v.vp9],
    ["vp8", v.vp8],
    ["mpeg2video", v.mpeg2],
    ["vc1", v.vc1],
  ]);
  const audio = list([
    ["aac", a.aac],
    ["mp3", a.mp3],
    ["mp2", a.mp3],
    ["opus", a.opus],
    ["flac", a.flac],
    ["vorbis", a.vorbis],
    ["alac", a.alac],
    ["ac3", a.ac3],
    ["eac3", a.eac3],
    ["truehd", a.truehd],
    ["dts", a.dts || a.dtshd],
    ["pcm_s16le", a.pcm],
    ["pcm_s24le", a.pcm],
  ]);
  const hlsVideo = list([
    ["hevc", v.hevc],
    ["h264", true],
    ["av1", v.av1],
  ]);
  const hlsAudio = list([
    ["aac", true],
    ["ac3", a.ac3],
    ["eac3", a.eac3],
    ["mp3", a.mp3],
    ["opus", a.opus],
    ["flac", a.flac],
  ]);
  const ranges = ["SDR"];
  if (caps.hdr.hdr10) ranges.push("HDR10", "DOVIWithHDR10");
  if (caps.hdr.hdr10plus) ranges.push("HDR10Plus", "DOVIWithHDR10Plus");
  if (caps.hdr.hlg) ranges.push("HLG", "DOVIWithHLG");
  if (caps.hdr.dolbyVision) ranges.push("DOVI", "DOVIWithSDR", "DOVIWithEL", "DOVIWithELHDR10Plus");
  const rangeCondition = { Condition: "EqualsAny", Property: "VideoRangeType", Value: [...new Set(ranges)].join("|"), IsRequired: false };
  const maxChannels = String(Math.max(2, caps.maxChannels || 2));

  return {
    Name: "Argent Android",
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: 200_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [
      { Container: "mp4,m4v,mov,mkv,webm,ts,mpegts,avi,flv,ogg,3gp", Type: "Video", VideoCodec: video, AudioCodec: audio },
      { Container: "mp3,aac,m4a,flac,ogg,opus,wav,webm,mka", Type: "Audio" },
    ],
    TranscodingProfiles: [
      {
        Container: "mp4",
        Type: "Video",
        VideoCodec: hlsVideo,
        AudioCodec: hlsAudio,
        Context: "Streaming",
        Protocol: "hls",
        MaxAudioChannels: maxChannels,
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
      { Container: "mp3", Type: "Audio", AudioCodec: "mp3", Context: "Streaming", Protocol: "http", MaxAudioChannels: "2" },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      {
        Type: "Video",
        Codec: "h264",
        Conditions: [
          { Condition: "LessThanEqual", Property: "VideoLevel", Value: "52", IsRequired: false },
          { Condition: "LessThanEqual", Property: "VideoBitDepth", Value: "8", IsRequired: false },
        ],
      },
      {
        Type: "Video",
        Codec: "hevc",
        Conditions: [
          { Condition: "EqualsAny", Property: "VideoProfile", Value: v.hevc10 ? "main|main 10" : "main", IsRequired: false },
          { Condition: "LessThanEqual", Property: "VideoBitDepth", Value: v.hevc10 ? "10" : "8", IsRequired: false },
          rangeCondition,
        ],
      },
      { Type: "Video", Codec: "av1", Conditions: [rangeCondition] },
      { Type: "VideoAudio", Conditions: [{ Condition: "LessThanEqual", Property: "AudioChannels", Value: maxChannels, IsRequired: false }] },
    ],
    // Media3 reads every common subtitle format from inside the file, including PGS and
    // VobSub, so nothing is burned in for Direct Play.
    SubtitleProfiles: [
      ...["srt", "subrip", "ass", "ssa", "vtt", "webvtt", "ttml", "pgssub", "pgs", "dvdsub", "dvbsub"].map((Format) => ({ Format, Method: "Embed" })),
      ...["srt", "subrip", "ass", "ssa", "vtt", "ttml"].map((Format) => ({ Format, Method: "External" })),
      { Format: "pgssub", Method: "Encode" },
      { Format: "dvdsub", Method: "Encode" },
    ],
    ResponseProfiles: [],
  };
}

/** mpv plays practically everything, so the server only converts to save bandwidth. */
export function mpvProfile(maxBitrate: number) {
  return {
    Name: "Argent mpv",
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: 400_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [{ Type: "Video" }, { Type: "Audio" }],
    TranscodingProfiles: [
      { Container: "ts", Type: "Video", VideoCodec: "hevc,h264", AudioCodec: "aac,ac3,eac3,mp3,opus,flac", Context: "Streaming", Protocol: "hls", MaxAudioChannels: "8", MinSegments: 1, BreakOnNonKeyFrames: true },
      { Container: "mp3", Type: "Audio", AudioCodec: "mp3", Context: "Streaming", Protocol: "http", MaxAudioChannels: "2" },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [
      ...["srt", "subrip", "ass", "ssa", "vtt", "webvtt", "ttml", "pgssub", "pgs", "dvdsub", "dvbsub", "sub", "smi", "mov_text"].map((Format) => ({ Format, Method: "Embed" })),
      ...["srt", "subrip", "ass", "ssa", "vtt", "ttml", "sub", "smi", "pgssub", "dvdsub"].map((Format) => ({ Format, Method: "External" })),
    ],
    ResponseProfiles: [],
  };
}

export interface ExternalSubtitle {
  /** Jellyfin's stream index, to report back which one is shown. */
  index: number;
  url: string;
  label: string;
  language?: string;
  /** Media3 MIME type of the file. */
  mime: string;
}

export type SubtitleChoice =
  | { kind: "off" }
  /** The nth subtitle track inside the file. */
  | { kind: "embedded"; ordinal: number; language?: string }
  /** One of `subtitles`, by Jellyfin index. */
  | { kind: "external"; index: number };

export interface ExternalRequest {
  url: string;
  title: string;
  subtitle?: string;
  startSeconds: number;
  durationSeconds: number;
  method: PlayMethod;
  /** The nth audio track inside the file (Direct Play); the stream's own track otherwise. */
  audio: { ordinal: number; language?: string };
  subtitles: ExternalSubtitle[];
  subtitleChoice: SubtitleChoice;
  /** Subtitle tracks inside the file; players number sidecar files after them. */
  embeddedSubtitleCount: number;
  /** Skippable parts (intro, recap…), seconds. */
  segments: { type: string; start: number; end: number }[];
  /** Up Next appears from here (seconds). */
  upNextAt?: number;
  next?: { title: string };
  hasPrevious: boolean;
  /** For matching the TV's refresh rate (frames per second). */
  frameRate?: number;
  /** Match the display's refresh rate to the video. */
  matchFrameRate: boolean;
  /** Dialogue boost and volume levelling (ignored when the sound goes to a receiver as is). */
  sound?: { dialogue: boolean; level: boolean };
}

const MIME: Record<string, string> = {
  srt: "application/x-subrip",
  subrip: "application/x-subrip",
  vtt: "text/vtt",
  webvtt: "text/vtt",
  ass: "text/x-ssa",
  ssa: "text/x-ssa",
  ttml: "application/ttml+xml",
};

const embedded = (streams: MediaStream[], type: MediaStream["Type"]) => streams.filter((s) => s.Type === type && !s.IsExternal);

/** Jellyfin stream index → the track's place among the file's own tracks of that type. */
export function ordinalOf(source: MediaSource, type: MediaStream["Type"], index: number | undefined): number {
  const i = embedded(source.MediaStreams, type).findIndex((s) => s.Index === index);
  return Math.max(0, i);
}

/** And back again, for reporting what the native player switched to. */
export function indexOfOrdinal(source: MediaSource, type: MediaStream["Type"], ordinal: number | undefined): number | undefined {
  if (ordinal === undefined || ordinal < 0) return ordinal === -1 ? -1 : undefined;
  return embedded(source.MediaStreams, type)[ordinal]?.Index;
}

export function buildExternalRequest(input: {
  url: string;
  method: PlayMethod;
  source: MediaSource;
  audioIndex?: number;
  subtitleIndex?: number;
  title: string;
  subtitle?: string;
  startSeconds: number;
  durationSeconds: number;
  segments?: readonly MediaSegment[];
  upNextAt?: number;
  nextTitle?: string;
  hasPrevious: boolean;
  matchFrameRate: boolean;
  sound?: { dialogue: boolean; level: boolean };
  /** Adds the access token to a server URL. */
  authorise: (url: string) => string;
}): ExternalRequest {
  const { source } = input;
  const streams = source.MediaStreams;
  const direct = input.method !== "Transcode";
  const subtitles: ExternalSubtitle[] = streams
    .filter((s) => s.Type === "Subtitle" && s.DeliveryUrl && (s.IsExternal || !direct) && MIME[(s.Codec ?? "").toLowerCase()])
    .map((s) => ({
      index: s.Index,
      url: input.authorise(s.DeliveryUrl!),
      label: s.DisplayTitle || s.Language || `Subtitle ${s.Index}`,
      language: s.Language,
      mime: MIME[(s.Codec ?? "").toLowerCase()],
    }));
  const chosen = streams.find((s) => s.Type === "Subtitle" && s.Index === input.subtitleIndex);
  let subtitleChoice: SubtitleChoice = { kind: "off" };
  if (chosen && subtitles.some((s) => s.index === chosen.Index)) subtitleChoice = { kind: "external", index: chosen.Index };
  else if (chosen && direct && !chosen.IsExternal)
    subtitleChoice = { kind: "embedded", ordinal: ordinalOf(source, "Subtitle", chosen.Index), language: chosen.Language };
  const audioStream = streams.find((s) => s.Type === "Audio" && s.Index === input.audioIndex);
  const video = streams.find((s) => s.Type === "Video");

  return {
    url: input.url,
    title: input.title,
    subtitle: input.subtitle,
    startSeconds: input.startSeconds,
    durationSeconds: input.durationSeconds,
    method: input.method,
    audio: { ordinal: direct ? ordinalOf(source, "Audio", input.audioIndex) : 0, language: audioStream?.Language },
    subtitles,
    subtitleChoice,
    embeddedSubtitleCount: direct ? embedded(streams, "Subtitle").length : 0,
    segments: (input.segments ?? [])
      .filter((s) => ["Intro", "Recap", "Preview", "Commercial"].includes(s.Type))
      .map((s) => ({ type: s.Type, start: s.StartTicks / TICKS, end: s.EndTicks / TICKS })),
    upNextAt: input.nextTitle ? input.upNextAt : undefined,
    next: input.nextTitle ? { title: input.nextTitle } : undefined,
    hasPrevious: input.hasPrevious,
    frameRate: video?.RealFrameRate ?? video?.AverageFrameRate,
    matchFrameRate: input.matchFrameRate,
    sound: input.sound,
  };
}

export interface ExternalState {
  position: number;
  paused: boolean;
  /** Ordinal of the audio track playing; -1/undefined when unknown. */
  audioOrdinal?: number;
  /** Ordinal of the embedded subtitle shown, -1 for none; or an external index. */
  subtitleOrdinal?: number;
  externalSubtitle?: number;
  buffering?: boolean;
}

export interface ExternalResult extends ExternalState {
  reason: "ended" | "stopped" | "next" | "previous" | "error";
  error?: string;
  /** Someone pressed a key or touched the screen during playback. */
  interacted: boolean;
}

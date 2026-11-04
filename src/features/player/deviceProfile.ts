import { canRenderAss } from "./assRenderer";

// Builds a Jellyfin DeviceProfile from what this browser can actually decode, so the
// server picks Direct Play, Direct Stream (remux) or Transcoding correctly.

let probe: HTMLVideoElement | null = null;

function can(type: string): boolean {
  probe ??= document.createElement("video");
  return probe.canPlayType(type).replace("no", "") !== "";
}

function mse(type: string): boolean {
  return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type);
}

const ua = navigator.userAgent;
const isChromium = /Chrome\/|Edg\//.test(ua) && !/OPR\//.test(ua);
const isFirefox = /Firefox\//.test(ua);
const isSafari = /Safari\//.test(ua) && !isChromium;
const isTizen = /Tizen/i.test(ua);
const isWebOS = /Web0S|webOS/i.test(ua);

export interface Capabilities {
  h264: boolean;
  hevc: boolean;
  /** 10-bit HEVC (Main 10): common on newer files, and missing where only 8-bit decodes. */
  hevc10: boolean;
  av1: boolean;
  av1_10: boolean;
  vp9: boolean;
  aac: boolean;
  mp3: boolean;
  opus: boolean;
  flac: boolean;
  ac3: boolean;
  eac3: boolean;
  dts: boolean;
  mkv: boolean;
  hlsNative: boolean;
  hlsMse: boolean;
}

export function capabilities(): Capabilities {
  const anyOf = (...types: string[]) => types.some((t) => can(t) || mse(t));
  return {
    h264: anyOf('video/mp4; codecs="avc1.640029"', 'video/mp4; codecs="avc1.42E01E"'),
    hevc: anyOf('video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"', 'video/mp4; codecs="hvc1.2.4.L153.B0"'),
    hevc10: anyOf('video/mp4; codecs="hvc1.2.4.L153.B0"', 'video/mp4; codecs="hev1.2.4.L153.B0"'),
    av1: anyOf('video/mp4; codecs="av01.0.05M.08"', 'video/mp4; codecs="av01.0.08M.10"'),
    av1_10: anyOf('video/mp4; codecs="av01.0.08M.10"'),
    vp9: anyOf('video/webm; codecs="vp9"', 'video/mp4; codecs="vp09.00.10.08"'),
    aac: anyOf('audio/mp4; codecs="mp4a.40.2"'),
    mp3: anyOf("audio/mpeg", 'audio/mp4; codecs="mp3"'),
    opus: anyOf('audio/webm; codecs="opus"', 'audio/mp4; codecs="opus"'),
    flac: anyOf("audio/flac", 'audio/mp4; codecs="flac"'),
    ac3: anyOf('audio/mp4; codecs="ac-3"'),
    eac3: anyOf('audio/mp4; codecs="ec-3"'),
    dts: isTizen || isWebOS,
    // Chromium's demuxer handles Matroska; Firefox and Safari do not reliably.
    mkv: isChromium || isTizen || isWebOS,
    hlsNative: can("application/vnd.apple.mpegurl") && (isSafari || isTizen || isWebOS),
    hlsMse: typeof MediaSource !== "undefined",
  };
}

export function buildDeviceProfile(maxBitrate: number, opts: { burnInAss?: boolean } = {}) {
  const c = capabilities();
  const video = ["h264", c.hevc && "hevc", c.av1 && "av1", c.vp9 && "vp9"].filter(Boolean).join(",");
  const audioMp4 = ["aac", c.mp3 && "mp3", c.opus && "opus", c.flac && "flac", c.ac3 && "ac3", c.eac3 && "eac3", c.dts && "dts"].filter(Boolean).join(",");
  const audioWebm = ["opus", "vorbis"].join(",");
  const hlsVideo = ["h264", c.hevc && "hevc", c.av1 && "av1"].filter(Boolean).join(",");
  const hlsAudio = ["aac", c.mp3 && "mp3", c.ac3 && "ac3", c.eac3 && "eac3", c.opus && "opus", c.flac && "flac"].filter(Boolean).join(",");

  const directPlay = [
    { Container: "mp4,m4v", Type: "Video", VideoCodec: video, AudioCodec: audioMp4 },
    { Container: "mov", Type: "Video", VideoCodec: "h264" + (c.hevc ? ",hevc" : ""), AudioCodec: audioMp4 },
    { Container: "webm", Type: "Video", VideoCodec: ["vp8", c.vp9 && "vp9", c.av1 && "av1"].filter(Boolean).join(","), AudioCodec: audioWebm },
    ...(c.mkv ? [{ Container: "mkv", Type: "Video", VideoCodec: video, AudioCodec: [audioMp4, "vorbis"].join(",") }] : []),
    { Container: "mp3", Type: "Audio" },
    { Container: "m4a,aac", Type: "Audio", AudioCodec: "aac" },
    { Container: "flac", Type: "Audio" },
    { Container: "webm,opus,ogg", Type: "Audio" },
  ];

  return {
    Name: "Argent",
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: 100_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: directPlay,
    TranscodingProfiles: [
      {
        Container: c.hlsMse && !isSafari ? "mp4" : "ts",
        Type: "Video",
        AudioCodec: hlsAudio,
        VideoCodec: hlsVideo,
        Context: "Streaming",
        Protocol: "hls",
        MaxAudioChannels: "6",
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
          { Condition: "NotEquals", Property: "IsAnamorphic", Value: "true", IsRequired: false },
          { Condition: "LessThanEqual", Property: "VideoLevel", Value: "52", IsRequired: false },
          { Condition: "LessThanEqual", Property: "VideoBitDepth", Value: "8", IsRequired: false },
        ],
      },
      // A 10-bit stream this device can't decode would load and never start, so the server
      // converts it instead.
      {
        Type: "Video",
        Codec: "hevc",
        Conditions: [
          { Condition: "EqualsAny", Property: "VideoProfile", Value: c.hevc10 ? "main|main 10" : "main", IsRequired: false },
          { Condition: "LessThanEqual", Property: "VideoBitDepth", Value: c.hevc10 ? "10" : "8", IsRequired: false },
        ],
      },
      {
        Type: "Video",
        Codec: "av1",
        Conditions: [{ Condition: "LessThanEqual", Property: "VideoBitDepth", Value: c.av1_10 ? "10" : "8", IsRequired: false }],
      },
    ],
    // Text subtitles are delivered as WebVTT tracks; image formats burn in.
    SubtitleProfiles: [
      { Format: "vtt", Method: "External" },
      { Format: "srt", Method: "External" },
      { Format: "subrip", Method: "External" },
      { Format: "ttml", Method: "External" },
      // ASS/SSA: drawn in the browser by libass when it can run, else burned in.
      ...(canRenderAss() && !opts.burnInAss
        ? [
            { Format: "ass", Method: "External" },
            { Format: "ssa", Method: "External" },
          ]
        : [
            { Format: "ass", Method: "Encode" },
            { Format: "ssa", Method: "Encode" },
          ]),
      { Format: "pgssub", Method: "Encode" },
      { Format: "pgs", Method: "Encode" },
      { Format: "dvdsub", Method: "Encode" },
      { Format: "dvbsub", Method: "Encode" },
    ],
    ResponseProfiles: [{ Type: "Video", Container: "m4v", MimeType: "video/mp4" }],
  };
}

export const QUALITY_OPTIONS: { label: string; bitrate: number }[] = [
  { label: "Auto", bitrate: 120_000_000 },
  { label: "4K · 60 Mbps", bitrate: 60_000_000 },
  { label: "1080p · 20 Mbps", bitrate: 20_000_000 },
  { label: "1080p · 10 Mbps", bitrate: 10_000_000 },
  { label: "720p · 6 Mbps", bitrate: 6_000_000 },
  { label: "720p · 4 Mbps", bitrate: 4_000_000 },
  { label: "480p · 2 Mbps", bitrate: 2_000_000 },
  { label: "360p · 720 kbps", bitrate: 720_000 },
];

export { isFirefox };

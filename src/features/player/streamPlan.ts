// Pure decisions behind a stream request: which version (media source) to play, whether a
// track choice needs a server-built stream, which delivery the server offered, and which
// tracks it really used. No network or DOM, so it's covered by streamPlan.test.ts.

import type { MediaSource, MediaStream } from "@/api/types";

export type PlayMethod = "DirectPlay" | "DirectStream" | "Transcode";

const FONT_TYPES = /font|opentype|truetype|.(ttf|otf|ttc|woff2?)/i;

/** The version to play: the one asked for if the item has it, else the first (Jellyfin's default). */
export function pickSource<T extends { Id: string }>(sources: readonly T[] | undefined, preferredId?: string | null): T | undefined {
  if (!sources?.length) return undefined;
  return (preferredId && sources.find((s) => s.Id === preferredId)) || sources[0];
}

const RES_LABELS: [number, string][] = [
  [3800, "4K"],
  [2500, "1440p"],
  [1900, "1080p"],
  [1200, "720p"],
  [700, "576p"],
  [0, "SD"],
];

export function resolutionLabel(width?: number, height?: number): string | undefined {
  if (!width && !height) return undefined;
  // Wide films are short for their width (1920×800 is still 1080p), so go by width.
  const w = width ?? Math.round((height ?? 0) * (16 / 9));
  return RES_LABELS.find(([min]) => w >= min)![1];
}

function videoOf(source: Pick<MediaSource, "MediaStreams">): MediaStream | undefined {
  return source.MediaStreams?.find((s) => s.Type === "Video");
}

/** A short description of a version: its resolution, codec and dynamic range. */
export function versionSpec(source: Pick<MediaSource, "MediaStreams" | "Size">): string {
  const v = videoOf(source);
  const range = v?.VideoRangeType && v.VideoRangeType !== "SDR" ? v.VideoRangeType.replace(/^DOVI.*/, "Dolby Vision") : undefined;
  const size = source.Size ? `${(source.Size / 1024 ** 3).toFixed(source.Size > 10 * 1024 ** 3 ? 0 : 1)} GB` : undefined;
  return [resolutionLabel(v?.Width, v?.Height), v?.Codec?.toUpperCase(), range, size].filter(Boolean).join(" · ");
}

/** What a version is called: its name in Jellyfin (from the file name), else its spec. */
export function versionLabel(source: Pick<MediaSource, "Name" | "MediaStreams" | "Size">, index = 0): string {
  return source.Name?.trim() || resolutionLabel(videoOf(source)?.Width, videoOf(source)?.Height) || `Version ${index + 1}`;
}

/** A version's name and, separately, what's not already in the name ("1080p" · "H264 · 2.0 GB"). */
export function versionOption(source: Pick<MediaSource, "Name" | "MediaStreams" | "Size">, index = 0): { label: string; detail: string } {
  const label = versionLabel(source, index);
  const detail = versionSpec(source)
    .split(" · ")
    .filter((part) => part && !label.toLowerCase().split(/\s+/).includes(part.toLowerCase()))
    .join(" · ");
  return { label, detail };
}

/**
 * Track choices a direct stream can't honour. Browsers play a file's own default audio
 * track, and can't draw image subtitles, so either needs a server-built stream.
 * The server echoes the requested track as DefaultAudioStreamIndex, so this compares
 * with the file's own default.
 */
export function serverWork(source: MediaSource, audioIndex?: number, subtitleIndex?: number) {
  const audio = source.MediaStreams.filter((s) => s.Type === "Audio");
  const fileDefault = (audio.find((s) => s.IsDefault) ?? audio[0])?.Index;
  const subtitle = source.MediaStreams.find((s) => s.Type === "Subtitle" && s.Index === subtitleIndex);
  return {
    audio: audioIndex !== undefined && audio.length > 1 && audioIndex !== fileDefault,
    burnIn: subtitle?.DeliveryMethod === "Encode",
  };
}

/** Same precedence as jellyfin-web: Direct Play, then Direct Stream, then Transcode. */
export function deliveryOf(source: Pick<MediaSource, "SupportsDirectPlay" | "SupportsDirectStream" | "TranscodingUrl">): PlayMethod | null {
  if (source.SupportsDirectPlay) return "DirectPlay";
  if (source.SupportsDirectStream && !source.TranscodingUrl) return "DirectStream";
  if (source.TranscodingUrl) return "Transcode";
  return null;
}

/** The tracks the server built a transcode with (its URL says), not just what was asked. */
export function builtTracks(transcodingUrl: string | null, asked: { audioIndex?: number; subtitleIndex?: number }, burnIn: boolean) {
  const params = transcodingUrl ? new URL(transcodingUrl, "http://x").searchParams : null;
  const audio = params?.get("AudioStreamIndex");
  const subtitle = params?.get("SubtitleStreamIndex");
  return {
    audioIndex: audio ? Number(audio) : asked.audioIndex,
    subtitleIndex: params && burnIn ? (subtitle ? Number(subtitle) : -1) : asked.subtitleIndex,
    reasons: params?.get("TranscodeReasons")?.split(",").filter(Boolean) ?? [],
  };
}

/** Subtitles the server hands out as files (sidecar or extracted), rather than burning in. */
export const clientDelivered = (s: MediaStream) =>
  s.Type === "Subtitle" && (s.DeliveryMethod === "External" || s.DeliveryMethod === "Hls") && Boolean(s.DeliveryUrl);

/** Browsers read WebVTT; Jellyfin converts a text subtitle when asked for .vtt. */
export const asVtt = (deliveryUrl: string) => deliveryUrl.replace(/\.(srt|subrip|ass|ssa|ttml)(\?|$)/i, ".vtt$2");

export function fontAttachments(source: MediaSource): string[] {
  return (source.MediaAttachments ?? []).filter((a) => a.DeliveryUrl && FONT_TYPES.test(`${a.MimeType ?? ""} ${a.FileName ?? ""}`)).map((a) => a.DeliveryUrl!);
}

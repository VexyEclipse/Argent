import { client, getEpisodes, getItemFull, getItems, getNextUp, getPlaybackInfo } from "@/api/jellyfin";
import type { BaseItem, MediaSource, MediaStream } from "@/api/types";
import { buildDeviceProfile, capabilities } from "./deviceProfile";

export type PlayMethod = "DirectPlay" | "DirectStream" | "Transcode";

export interface StreamOptions {
  startTicks: number;
  audioIndex?: number;
  subtitleIndex?: number;
  maxBitrate: number;
  /** Set after a direct-play failure so the server remuxes or transcodes instead. */
  disableDirectPlay?: boolean;
}

export interface StreamInfo {
  url: string;
  hls: boolean;
  method: PlayMethod;
  source: MediaSource;
  playSessionId: string;
  audioIndex?: number;
  subtitleIndex?: number;
  transcodeReasons: string[];
  /** Text subtitle tracks the browser renders itself. */
  textTracks: { index: number; label: string; language?: string; url: string }[];
}

/**
 * Resolve what to actually play: a series plays its next-up episode, a season its
 * first unwatched episode, a collection its first unwatched title.
 */
export async function resolvePlayable(id: string): Promise<BaseItem> {
  const item = await getItemFull(id);
  if (item.Type === "Series") {
    const next = (await getNextUp({ seriesId: id, limit: 1, enableRewatching: true })).Items[0];
    if (next) return getItemFull(next.Id);
    const eps = (await getEpisodes(id)).Items;
    const first = eps.find((e) => (e.ParentIndexNumber ?? 0) > 0) ?? eps[0];
    if (!first) throw new Error("This series has no playable episodes.");
    return getItemFull(first.Id);
  }
  if (item.Type === "Season") {
    const eps = (await getEpisodes(item.SeriesId!, item.Id)).Items;
    const target = eps.find((e) => !e.UserData?.Played) ?? eps[0];
    if (!target) throw new Error("This season has no playable episodes.");
    return getItemFull(target.Id);
  }
  if (item.Type === "BoxSet") {
    const children = (await getItems({ parentId: item.Id, sortBy: ["PremiereDate", "SortName"], sortOrder: "Ascending" })).Items;
    const target = children.find((c) => !c.UserData?.Played) ?? children[0];
    if (!target) throw new Error("This collection is empty.");
    return resolvePlayable(target.Id);
  }
  return item;
}

function withAuth(path: string): string {
  const c = client();
  const url = new URL(path.startsWith("http") ? path : `${c.serverUrl}${path}`);
  if (!url.searchParams.has("ApiKey") && !url.searchParams.has("api_key") && c.accessToken) url.searchParams.set("ApiKey", c.accessToken);
  return url.toString();
}

function textTracksOf(source: MediaSource): StreamInfo["textTracks"] {
  return source.MediaStreams.filter((s) => s.Type === "Subtitle" && (s.DeliveryMethod === "External" || s.DeliveryMethod === "Hls") && s.DeliveryUrl).map(
    (s) => ({
      index: s.Index,
      label: s.DisplayTitle || s.Language || `Subtitle ${s.Index}`,
      language: s.Language,
      url: withAuth(s.DeliveryUrl!.replace(/\.(srt|subrip|ass|ssa|ttml)(\?|$)/i, ".vtt$2")),
    }),
  );
}

export async function requestStream(item: BaseItem, opts: StreamOptions): Promise<StreamInfo> {
  const info = await getPlaybackInfo(item.Id, {
    DeviceProfile: buildDeviceProfile(opts.maxBitrate),
    MaxStreamingBitrate: opts.maxBitrate,
    StartTimeTicks: opts.startTicks,
    AudioStreamIndex: opts.audioIndex,
    SubtitleStreamIndex: opts.subtitleIndex,
    EnableDirectPlay: !opts.disableDirectPlay,
    EnableDirectStream: true,
    EnableTranscoding: true,
    AllowVideoStreamCopy: true,
    AllowAudioStreamCopy: true,
    AutoOpenLiveStream: true,
    AlwaysBurnInSubtitleWhenTranscoding: false,
  });

  if (info.ErrorCode) {
    const messages: Record<string, string> = {
      NotAllowed: "Your account isn't allowed to play this.",
      NoCompatibleStream: "The server couldn't produce a stream this device can play.",
      RateLimitExceeded: "The server's streaming limit has been reached.",
    };
    throw new Error(messages[info.ErrorCode] ?? `Playback failed (${info.ErrorCode}).`);
  }
  const source = info.MediaSources[0];
  if (!source) throw new Error("No playable media source.");

  const c = client();
  const audioIndex = opts.audioIndex ?? source.DefaultAudioStreamIndex;
  const subtitleIndex = opts.subtitleIndex ?? source.DefaultSubtitleStreamIndex;
  // A non-default audio track or burned-in subtitle needs the server to rebuild the stream.
  const needsServerAudio = audioIndex !== undefined && audioIndex !== source.DefaultAudioStreamIndex;

  // Browsers can't switch audio tracks in a file they direct-play, so ask for a remux.
  if (needsServerAudio && source.SupportsDirectPlay && !opts.disableDirectPlay) {
    return requestStream(item, { ...opts, audioIndex, disableDirectPlay: true });
  }

  // Same precedence as jellyfin-web: Direct Play, then Direct Stream, then Transcode.
  let url: string;
  let method: PlayMethod;
  let hls = false;
  if (source.SupportsDirectPlay) {
    method = "DirectPlay";
    url = c.url(`/Videos/${item.Id}/stream.${(source.Container || "mp4").split(",")[0]}`, {
      static: true,
      mediaSourceId: source.Id,
      deviceId: c.deviceId,
      PlaySessionId: info.PlaySessionId,
      Tag: source.ETag,
      ApiKey: c.accessToken ?? "",
    });
  } else if (source.SupportsDirectStream && !source.TranscodingUrl) {
    method = "DirectStream";
    url = c.url(`/Videos/${item.Id}/stream`, {
      static: true,
      mediaSourceId: source.Id,
      deviceId: c.deviceId,
      PlaySessionId: info.PlaySessionId,
      Tag: source.ETag,
      ApiKey: c.accessToken ?? "",
      audioStreamIndex: audioIndex,
    });
  } else if (source.TranscodingUrl) {
    url = withAuth(source.TranscodingUrl);
    hls = source.TranscodingSubProtocol === "hls" || /\.m3u8/.test(source.TranscodingUrl);
    method = "Transcode";
  } else {
    throw new Error("The server didn't offer a playable stream.");
  }

  const reasons = source.TranscodingUrl ? (new URL(withAuth(source.TranscodingUrl)).searchParams.get("TranscodeReasons")?.split(",") ?? []) : [];

  return {
    url,
    hls,
    method,
    source,
    playSessionId: info.PlaySessionId,
    audioIndex,
    subtitleIndex,
    transcodeReasons: reasons,
    textTracks: textTracksOf(source),
  };
}

export function streamsOfType(source: MediaSource | undefined, type: MediaStream["Type"]): MediaStream[] {
  return source?.MediaStreams.filter((s) => s.Type === type) ?? [];
}

/** Whether a subtitle can be shown client-side (WebVTT track) or must be burned in. */
export function subtitleIsText(stream: MediaStream): boolean {
  return (
    stream.DeliveryMethod === "External" || stream.DeliveryMethod === "Hls" || Boolean(stream.IsTextSubtitleStream && !/ass|ssa/i.test(stream.Codec ?? ""))
  );
}

export function needsHlsJs(): boolean {
  const c = capabilities();
  return !c.hlsNative && c.hlsMse;
}

/** Neighbouring episodes for prev/next navigation and autoplay. */
export async function episodeNeighbours(item: BaseItem): Promise<{ prev: BaseItem | null; next: BaseItem | null }> {
  if (item.Type !== "Episode" || !item.SeriesId) return { prev: null, next: null };
  const list = (await getEpisodes(item.SeriesId)).Items.filter((e) => e.LocationType !== "Virtual");
  const i = list.findIndex((e) => e.Id === item.Id);
  return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
}

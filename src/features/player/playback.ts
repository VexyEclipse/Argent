import { CARD_FIELDS, client, getEpisodes, getItemFull, getItems, getNextUp, getPlaybackInfo } from "@/api/jellyfin";
import type { BaseItem, MediaSource, MediaStream } from "@/api/types";
import { isAssCodec } from "./assRenderer";
import { buildDeviceProfile, capabilities } from "./deviceProfile";

const FONT_TYPES = /font|opentype|truetype|.(ttf|otf|ttc|woff2?)/i;

export type PlayMethod = "DirectPlay" | "DirectStream" | "Transcode";

export interface StreamOptions {
  startTicks: number;
  audioIndex?: number;
  subtitleIndex?: number;
  maxBitrate: number;
  /** Set after a direct-play failure so the server remuxes or transcodes instead. */
  disableDirectPlay?: boolean;
  /** Burn ASS/SSA in on the server (when the in-browser renderer can't run). */
  burnInSubtitles?: boolean;
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
  /** ASS/SSA tracks the browser renders with libass, keeping Direct Play. */
  assTracks: { index: number; url: string }[];
  /** Fonts embedded in the file, for ASS typesetting. */
  fonts: string[];
}

/**
 * Resolve what to actually play: a series plays its next-up episode, a season its
 * first unwatched episode, a collection its first unwatched title.
 */
/**
 * What "Play" means for a series: the episode left part-way, else Next Up, else the
 * first episode (a finished series starts over).
 */
export async function seriesPlayTarget(seriesId: string): Promise<BaseItem | null> {
  const [resumable, next] = await Promise.all([
    getItems({
      parentId: seriesId,
      recursive: true,
      includeItemTypes: ["Episode"],
      filters: ["IsResumable"],
      sortBy: ["DatePlayed"],
      sortOrder: "Descending",
      limit: 1,
      fields: CARD_FIELDS,
    }),
    getNextUp({ seriesId, limit: 1 }),
  ]);
  if (resumable.Items[0]) return resumable.Items[0];
  if (next.Items[0]) return next.Items[0];
  const eps = (await getEpisodes(seriesId)).Items;
  return eps.find((e) => (e.ParentIndexNumber ?? 0) > 0) ?? eps[0] ?? null;
}

export async function resolvePlayable(id: string): Promise<BaseItem> {
  const item = await getItemFull(id);
  if (item.Type === "Series") {
    const target = await seriesPlayTarget(id);
    if (!target) throw new Error("This series has no playable episodes.");
    return getItemFull(target.Id);
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

const clientDelivered = (s: MediaStream) => s.Type === "Subtitle" && (s.DeliveryMethod === "External" || s.DeliveryMethod === "Hls") && Boolean(s.DeliveryUrl);

function textTracksOf(source: MediaSource): StreamInfo["textTracks"] {
  return source.MediaStreams.filter((s) => clientDelivered(s) && !isAssCodec(s.Codec)).map((s) => ({
    index: s.Index,
    label: s.DisplayTitle || s.Language || `Subtitle ${s.Index}`,
    language: s.Language,
    url: withAuth(s.DeliveryUrl!.replace(/\.(srt|subrip|ass|ssa|ttml)(\?|$)/i, ".vtt$2")),
  }));
}

export async function requestStream(item: BaseItem, opts: StreamOptions): Promise<StreamInfo> {
  // The server only honours explicit track choices when the media source is named;
  // without it, it quietly substitutes the user's remembered tracks.
  const mediaSourceId = item.MediaSources?.[0]?.Id ?? item.Id;
  const info = await getPlaybackInfo(item.Id, {
    MediaSourceId: mediaSourceId,
    DeviceProfile: buildDeviceProfile(opts.maxBitrate, { burnInAss: opts.burnInSubtitles }),
    MaxStreamingBitrate: opts.maxBitrate,
    StartTimeTicks: opts.startTicks,
    AudioStreamIndex: opts.audioIndex,
    SubtitleStreamIndex: opts.subtitleIndex,
    EnableDirectPlay: !opts.disableDirectPlay,
    // A static direct stream can't swap audio or burn subtitles either.
    EnableDirectStream: !opts.disableDirectPlay,
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
  // Browsers play a file's own default audio track and can't draw image or styled
  // (ASS) subtitles. Either choice needs a server-built stream. Note the server echoes
  // the requested track back as "DefaultAudioStreamIndex", so compare with the file.
  const audioStreams = source.MediaStreams.filter((s) => s.Type === "Audio");
  const fileDefaultAudio = (audioStreams.find((s) => s.IsDefault) ?? audioStreams[0])?.Index;
  const needsServerAudio = audioIndex !== undefined && audioStreams.length > 1 && audioIndex !== fileDefaultAudio;
  const subtitle = source.MediaStreams.find((s) => s.Type === "Subtitle" && s.Index === subtitleIndex);
  const needsBurnIn = subtitle?.DeliveryMethod === "Encode";
  if ((needsServerAudio || needsBurnIn) && !opts.disableDirectPlay && (source.SupportsDirectPlay || !source.TranscodingUrl)) {
    return requestStream(item, { ...opts, audioIndex, subtitleIndex, disableDirectPlay: true });
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

  const params = method === "Transcode" && source.TranscodingUrl ? new URL(withAuth(source.TranscodingUrl)).searchParams : null;
  const reasons = params?.get("TranscodeReasons")?.split(",") ?? [];
  // Report the tracks the server actually built the stream with, not just what was asked.
  const urlAudio = params?.get("AudioStreamIndex");
  const urlSubtitle = params?.get("SubtitleStreamIndex");
  const actualAudio = urlAudio ? Number(urlAudio) : audioIndex;
  const actualSubtitle = params && needsBurnIn ? (urlSubtitle ? Number(urlSubtitle) : -1) : subtitleIndex;

  return {
    url,
    hls,
    method,
    source,
    playSessionId: info.PlaySessionId,
    audioIndex: actualAudio,
    subtitleIndex: actualSubtitle,
    transcodeReasons: reasons,
    textTracks: textTracksOf(source),
    assTracks: source.MediaStreams.filter((s) => clientDelivered(s) && isAssCodec(s.Codec)).map((s) => ({ index: s.Index, url: withAuth(s.DeliveryUrl!) })),
    fonts: (source.MediaAttachments ?? [])
      .filter((a) => a.DeliveryUrl && FONT_TYPES.test(`${a.MimeType ?? ""} ${a.FileName ?? ""}`))
      .map((a) => withAuth(a.DeliveryUrl!)),
  };
}

export function streamsOfType(source: MediaSource | undefined, type: MediaStream["Type"]): MediaStream[] {
  return source?.MediaStreams.filter((s) => s.Type === type) ?? [];
}

/** Whether a subtitle can be shown client-side (WebVTT track) or must be burned in. */
/** Whether a subtitle is shown client-side (WebVTT track or libass) rather than burned in. */
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

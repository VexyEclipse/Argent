import { CARD_FIELDS, client, getEpisodes, getItemFull, getItems, getNextUp, getPlaybackInfo } from "@/api/jellyfin";
import type { BaseItem, MediaSource, MediaStream } from "@/api/types";
import { logEvent } from "@/features/diagnostics/log";
import { isAssCodec } from "./assRenderer";
import { buildDeviceProfile, capabilities } from "./deviceProfile";
import { asVtt, builtTracks, clientDelivered, deliveryOf, fontAttachments, pickSource, serverWork, type PlayMethod } from "./streamPlan";

export type { PlayMethod };

export interface StreamOptions {
  startTicks: number;
  audioIndex?: number;
  subtitleIndex?: number;
  maxBitrate: number;
  /** Which version of the title to play (its media source id); the first when unset. */
  mediaSourceId?: string;
  /** Set after a direct-play failure so the server remuxes or transcodes instead. */
  disableDirectPlay?: boolean;
  /** Burn ASS/SSA in on the server (when the in-browser renderer can't run). */
  burnInSubtitles?: boolean;
  /** Set after a stream played without sound: the server converts the audio to AAC. */
  compatibleAudio?: boolean;
  /**
   * The device profile for a player other than this page's own (the Android app's native
   * player, mpv). Such a player picks audio and subtitle tracks within the file itself.
   */
  profile?: Record<string, unknown>;
}

export interface StreamInfo {
  url: string;
  hls: boolean;
  method: PlayMethod;
  source: MediaSource;
  /** Every version of the title, for the version menu. */
  versions: MediaSource[];
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

function textTracksOf(source: MediaSource): StreamInfo["textTracks"] {
  return source.MediaStreams.filter((s) => clientDelivered(s) && !isAssCodec(s.Codec)).map((s) => ({
    index: s.Index,
    label: s.DisplayTitle || s.Language || `Subtitle ${s.Index}`,
    language: s.Language,
    url: withAuth(asVtt(s.DeliveryUrl!)),
  }));
}

export async function requestStream(item: BaseItem, opts: StreamOptions): Promise<StreamInfo> {
  // The server only honours explicit track choices when the media source is named;
  // without it, it quietly substitutes the user's remembered tracks.
  const versions = item.MediaSources ?? [];
  const mediaSourceId = pickSource(versions, opts.mediaSourceId)?.Id ?? item.Id;
  const external = Boolean(opts.profile);
  const info = await getPlaybackInfo(item.Id, {
    MediaSourceId: mediaSourceId,
    DeviceProfile: opts.profile ?? buildDeviceProfile(opts.maxBitrate, { burnInAss: opts.burnInSubtitles, compatibleAudio: opts.compatibleAudio }),
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
    logEvent("playback", `PlaybackInfo error ${info.ErrorCode} for ${item.Id}`, "error");
    throw new Error(messages[info.ErrorCode] ?? `Playback failed (${info.ErrorCode}).`);
  }
  const source = info.MediaSources[0];
  if (!source) throw new Error("No playable media source.");

  const c = client();
  const audioIndex = opts.audioIndex ?? source.DefaultAudioStreamIndex;
  const subtitleIndex = opts.subtitleIndex ?? source.DefaultSubtitleStreamIndex;
  // A native player switches the file's own tracks itself, so only this page's player
  // needs the server to build a stream for a track choice.
  const work = external ? { audio: false, burnIn: false } : serverWork(source, audioIndex, subtitleIndex);
  if ((work.audio || work.burnIn) && !opts.disableDirectPlay && (source.SupportsDirectPlay || !source.TranscodingUrl)) {
    return requestStream(item, { ...opts, audioIndex, subtitleIndex, disableDirectPlay: true });
  }

  const method = deliveryOf(source);
  let url: string;
  if (method === "DirectPlay") {
    url = c.url(`/Videos/${item.Id}/stream.${(source.Container || "mp4").split(",")[0]}`, {
      static: true,
      mediaSourceId: source.Id,
      deviceId: c.deviceId,
      PlaySessionId: info.PlaySessionId,
      Tag: source.ETag,
      ApiKey: c.accessToken ?? "",
    });
  } else if (method === "DirectStream") {
    url = c.url(`/Videos/${item.Id}/stream`, {
      static: true,
      mediaSourceId: source.Id,
      deviceId: c.deviceId,
      PlaySessionId: info.PlaySessionId,
      Tag: source.ETag,
      ApiKey: c.accessToken ?? "",
      audioStreamIndex: audioIndex,
    });
  } else if (method === "Transcode") {
    url = withAuth(source.TranscodingUrl!);
  } else {
    throw new Error("The server didn't offer a playable stream.");
  }

  const transcodeUrl = method === "Transcode" ? url : null;
  const built = builtTracks(transcodeUrl, { audioIndex, subtitleIndex }, work.burnIn);
  logEvent(
    "playback",
    `${item.Type} ${item.Id}: ${method}${built.reasons.length ? ` (${built.reasons.join(", ")})` : ""}, ${source.Container}, source ${source.Id}${external ? ", external player" : ""}`,
  );

  return {
    url,
    hls: method === "Transcode" && (source.TranscodingSubProtocol === "hls" || /\.m3u8/.test(url)),
    method,
    source,
    versions: versions.length ? versions : [source],
    playSessionId: info.PlaySessionId,
    audioIndex: built.audioIndex,
    subtitleIndex: built.subtitleIndex,
    transcodeReasons: built.reasons,
    textTracks: textTracksOf(source),
    assTracks: source.MediaStreams.filter((s) => clientDelivered(s) && isAssCodec(s.Codec)).map((s) => ({ index: s.Index, url: withAuth(s.DeliveryUrl!) })),
    fonts: fontAttachments(source).map(withAuth),
  };
}

export function streamsOfType(source: MediaSource | undefined, type: MediaStream["Type"]): MediaStream[] {
  return source?.MediaStreams.filter((s) => s.Type === type) ?? [];
}

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

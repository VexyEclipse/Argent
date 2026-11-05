// Pure download rules: quality presets, what a downloaded title keeps, sizes, and the
// order things play in offline. No DOM, no network.

import type { BaseItem, MediaSegment, MediaSource, MediaStream } from "@/api/types";

export type QualityId = "original" | "high" | "standard" | "saver";

export interface QualityPreset {
  id: QualityId;
  label: string;
  detail: string;
  /** Video + audio bits per second for a converted copy; the file's own for Original. */
  bitrate: number;
  maxWidth: number;
}

export const QUALITIES: QualityPreset[] = [
  { id: "original", label: "Original", detail: "The file as it is, when this device can play it", bitrate: 0, maxWidth: 0 },
  { id: "high", label: "High", detail: "1080p", bitrate: 8_000_000, maxWidth: 1920 },
  { id: "standard", label: "Standard", detail: "720p, about a third of the size", bitrate: 3_000_000, maxWidth: 1280 },
  { id: "saver", label: "Data saver", detail: "480p, smallest", bitrate: 1_200_000, maxWidth: 854 },
];

export const qualityOf = (id: QualityId) => QUALITIES.find((q) => q.id === id) ?? QUALITIES[1];

export type DownloadState = "queued" | "downloading" | "done" | "failed" | "paused";

export interface SubtitleFile {
  index: number;
  label: string;
  language?: string;
  file: string;
}

/** A downloaded (or downloading) title and everything needed to play it with no server. */
export interface DownloadRecord {
  id: string;
  item: BaseItem;
  quality: QualityId;
  state: DownloadState;
  /** Bytes of the video saved so far. */
  bytes: number;
  /** Expected size: exact for Original, an estimate for converted copies. */
  total: number;
  error?: string;
  addedAt: number;
  mediaSourceId: string;
  audioIndex?: number;
  /** The subtitle to start with (a text track the user prefers), -1 for none. */
  subtitleIndex: number;
  /** File names in this account's downloads folder. */
  files: { video: string; mime: string; subtitles: SubtitleFile[]; poster?: string; thumb?: string };
  segments: MediaSegment[];
  /** Watch state while offline, sent to the server once it's reachable. */
  position: number;
  played: boolean;
  /** Watched offline and not yet sent to the server. */
  dirty?: boolean;
  lastPlayed?: string;
}

const PERSON_TYPES = new Set(["Actor", "GuestStar", "Director"]);

/**
 * What a download keeps of a title: enough for the downloads page, the player and the
 * pause screen, small enough that hundreds fit in storage. Server-only parts (trickplay,
 * image tags, chapter images) are dropped.
 */
export function offlineItem(item: BaseItem, source: MediaSource, audioIndex: number | undefined, subtitles: SubtitleFile[]): BaseItem {
  const video = source.MediaStreams.find((s) => s.Type === "Video");
  const audio = source.MediaStreams.find((s) => s.Type === "Audio" && s.Index === audioIndex) ?? source.MediaStreams.find((s) => s.Type === "Audio");
  const subtitleStreams: MediaStream[] = subtitles.map((s) => ({
    Index: s.index,
    Type: "Subtitle",
    Codec: "vtt",
    Language: s.language,
    DisplayTitle: s.label,
    IsExternal: true,
    IsTextSubtitleStream: true,
    DeliveryMethod: "External",
  }));
  return {
    Id: item.Id,
    Name: item.Name,
    Type: item.Type,
    OriginalTitle: item.OriginalTitle,
    Overview: item.Overview,
    Genres: item.Genres?.slice(0, 4),
    People: item.People?.filter((p) => PERSON_TYPES.has(p.Type))
      .slice(0, 12)
      .map((p) => ({ Name: p.Name, Id: p.Id, Type: p.Type, Role: p.Role })),
    ProductionYear: item.ProductionYear,
    PremiereDate: item.PremiereDate,
    OfficialRating: item.OfficialRating,
    CommunityRating: item.CommunityRating,
    RunTimeTicks: item.RunTimeTicks,
    SeriesId: item.SeriesId,
    SeriesName: item.SeriesName,
    SeasonId: item.SeasonId,
    SeasonName: item.SeasonName,
    IndexNumber: item.IndexNumber,
    IndexNumberEnd: item.IndexNumberEnd,
    ParentIndexNumber: item.ParentIndexNumber,
    Chapters: item.Chapters?.map((c) => ({ StartPositionTicks: c.StartPositionTicks, Name: c.Name })),
    UserData: item.UserData,
    MediaSources: [
      {
        Id: source.Id,
        Name: source.Name,
        Container: source.Container,
        Size: source.Size,
        RunTimeTicks: source.RunTimeTicks,
        SupportsDirectPlay: true,
        SupportsDirectStream: false,
        SupportsTranscoding: false,
        MediaStreams: [...(video ? [video] : []), ...(audio ? [audio] : []), ...subtitleStreams],
        DefaultAudioStreamIndex: audio?.Index,
      },
    ],
  };
}

/** Rough size of a converted copy: bitrate × running time. */
export function estimateBytes(item: Pick<BaseItem, "RunTimeTicks">, bitrate: number): number {
  const seconds = (item.RunTimeTicks ?? 0) / 10_000_000;
  return Math.round((bitrate / 8) * seconds);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(n / 1e6))} MB`;
}

/** 0–100. A converted copy's size is an estimate, so it holds at 99% until it's really done. */
export function percentOf(r: Pick<DownloadRecord, "bytes" | "total" | "state">): number {
  if (r.state === "done") return 100;
  if (!r.total) return 0;
  return Math.min(99, Math.floor((r.bytes / r.total) * 100));
}

const order = (i: BaseItem) => (i.ParentIndexNumber ?? 0) * 10_000 + (i.IndexNumber ?? 0);

/** Downloads grouped for the page: films, then each show with its episodes in order. */
export function groupDownloads(records: DownloadRecord[]): { movies: DownloadRecord[]; shows: { seriesId: string; name: string; episodes: DownloadRecord[] }[] } {
  const movies: DownloadRecord[] = [];
  const shows = new Map<string, { seriesId: string; name: string; episodes: DownloadRecord[] }>();
  for (const r of records) {
    if (r.item.Type === "Episode" && r.item.SeriesId) {
      const show = shows.get(r.item.SeriesId) ?? { seriesId: r.item.SeriesId, name: r.item.SeriesName ?? "Series", episodes: [] };
      show.episodes.push(r);
      shows.set(r.item.SeriesId, show);
    } else movies.push(r);
  }
  for (const s of shows.values()) s.episodes.sort((a, b) => order(a.item) - order(b.item));
  return {
    movies: movies.sort((a, b) => b.addedAt - a.addedAt),
    shows: [...shows.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Previous and next downloaded episodes of the same show (offline Up Next). */
export function offlineNeighbours(records: DownloadRecord[], id: string): { prev: BaseItem | null; next: BaseItem | null } {
  const me = records.find((r) => r.id === id);
  if (!me?.item.SeriesId) return { prev: null, next: null };
  const eps = records
    .filter((r) => r.state === "done" && r.item.SeriesId === me.item.SeriesId)
    .map((r) => r.item)
    .sort((a, b) => order(a) - order(b));
  const i = eps.findIndex((e) => e.Id === id);
  return { prev: i > 0 ? eps[i - 1] : null, next: i >= 0 && i < eps.length - 1 ? eps[i + 1] : null };
}

/** Where to start an offline title: its saved place unless it's basically finished. */
export function offlineStart(r: Pick<DownloadRecord, "position" | "item">): number {
  const runtime = r.item.RunTimeTicks ?? 0;
  return runtime && r.position / runtime > 0.95 ? 0 : r.position;
}

/** A finished title counts as watched (90% in, or into its credits). */
export function watchedAt(r: Pick<DownloadRecord, "item" | "segments">, ticks: number): boolean {
  const runtime = r.item.RunTimeTicks ?? 0;
  const outro = r.segments.find((s) => s.Type === "Outro")?.StartTicks;
  return Boolean(runtime && (ticks >= runtime * 0.9 || (outro !== undefined && ticks >= outro)));
}

/**
 * The device profile for a converted download: one progressive MP4 (H.264 and stereo AAC,
 * which every browser and phone plays), at most this size and bitrate. Subtitles come
 * separately as WebVTT files, so none are burned in.
 */
export function downloadProfile(preset: QualityPreset) {
  return {
    Name: "Argent download",
    MaxStreamingBitrate: preset.bitrate,
    MaxStaticBitrate: preset.bitrate,
    DirectPlayProfiles: [],
    TranscodingProfiles: [
      { Container: "mp4", Type: "Video", VideoCodec: "h264", AudioCodec: "aac", Context: "Streaming", Protocol: "http", MaxAudioChannels: "2" },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      {
        Type: "Video",
        Codec: "h264",
        Conditions: [
          { Condition: "LessThanEqual", Property: "Width", Value: String(preset.maxWidth), IsRequired: true },
          { Condition: "LessThanEqual", Property: "VideoBitDepth", Value: "8", IsRequired: true },
          { Condition: "LessThanEqual", Property: "VideoLevel", Value: "51", IsRequired: false },
        ],
      },
    ],
    SubtitleProfiles: [
      { Format: "vtt", Method: "External" },
      { Format: "srt", Method: "External" },
      { Format: "ass", Method: "External" },
      { Format: "ssa", Method: "External" },
    ],
  };
}

const MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm", mkv: "video/x-matroska" };

/** The file extension and type for a saved video. */
export function videoFileType(container: string | undefined): { ext: string; mime: string } {
  const ext = (container ?? "mp4").split(",")[0].toLowerCase();
  return { ext: MIME[ext] ? ext : "mp4", mime: MIME[ext] ?? "video/mp4" };
}

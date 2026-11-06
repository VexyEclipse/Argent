// Downloads for watching offline. Each title is saved to this device's private storage
// (the origin private file system) as a video file plus its subtitles and artwork, one at
// a time, in a worker. The list of downloads and their watch state live in localStorage
// per account; watching offline is sent to the server once it's reachable again.

import { useEffect, useSyncExternalStore } from "react";
import { client, getItemFull, getItems, getMediaSegments, getPlaybackInfo, stopEncoding, updateUserData } from "@/api/jellyfin";
import { landscapeImage, posterImage } from "@/api/images";
import type { BaseItem, MediaSegment } from "@/api/types";
import { useAuth, type Account } from "@/auth/AuthProvider";
import { logEvent } from "@/features/diagnostics/log";
import { buildDeviceProfile } from "@/features/player/deviceProfile";
import { rememberedVersion } from "@/features/player/prefs";
import { pickSource } from "@/features/player/streamPlan";
import { downloadProfile, estimateBytes, offlineItem, qualityOf, videoFileType, watchedAt, type DownloadRecord, type QualityId, type SubtitleFile } from "./logic";
import type { WorkerReply, WorkerRequest } from "./worker";

const ROOT = "argent-downloads";
const PREFS_KEY = "argent.downloadQuality";
/** Progress is saved to storage this often while downloading (it's kept in memory between). */
const PERSIST_EVERY_MS = 4000;

// ---- support ---------------------------------------------------------------------------

/** Private file storage and workers need a secure page: the apps, https, or localhost. */
export function downloadsSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof navigator.storage?.getDirectory === "function" && typeof Worker !== "undefined";
}

export function readQualityChoice(): QualityId {
  try {
    const v = localStorage.getItem(PREFS_KEY);
    if (v === "original" || v === "high" || v === "standard" || v === "saver") return v;
  } catch {
    /* ignore */
  }
  return "high";
}

export function saveQualityChoice(q: QualityId) {
  try {
    localStorage.setItem(PREFS_KEY, q);
  } catch {
    /* ignore */
  }
}

// ---- records ---------------------------------------------------------------------------

const accountKey = (a: Pick<Account, "serverId" | "userId">) => `${a.serverId}-${a.userId}`;
const storageKey = (key: string) => `argent.downloads.${key}`;

let active = "";
let records: DownloadRecord[] = [];
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => listeners.forEach((fn) => fn());

function load(key: string): DownloadRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(key)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let persistTimer = 0;
function persist(now = true) {
  const save = () => {
    try {
      localStorage.setItem(storageKey(active), JSON.stringify(records));
    } catch {
      logEvent("downloads", "Couldn't save the download list (storage full)", "warn");
    }
  };
  window.clearTimeout(persistTimer);
  if (now) save();
  else persistTimer = window.setTimeout(save, PERSIST_EVERY_MS);
}

function update(id: string, patch: Partial<DownloadRecord> | ((r: DownloadRecord) => Partial<DownloadRecord>), save = true) {
  records = records.map((r) => (r.id === id ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r));
  emit();
  persist(save);
}

/** Switches to an account's downloads (sign-in, user switch, offline start). */
function selectAccount(account: Account | null) {
  const key = account ? accountKey(account) : "";
  if (key !== active) {
    active = key;
    records = key ? load(key) : [];
    // A download cut off when the app closed carries on from the queue.
    records = records.map((r) => (r.state === "downloading" ? { ...r, state: "queued" } : r));
  }
}

export const readDownloads = () => records;
export const findDownload = (id: string) => records.find((r) => r.id === id);

/** This account's downloads, newest last. */
export function useDownloads(): DownloadRecord[] {
  return useSyncExternalStore(subscribe, readDownloads);
}

export function useDownload(id: string | undefined): DownloadRecord | undefined {
  return useSyncExternalStore(subscribe, () => (id ? findDownload(id) : undefined));
}

// ---- files -----------------------------------------------------------------------------

async function folder(create = true): Promise<FileSystemDirectoryHandle | null> {
  try {
    let dir = await navigator.storage.getDirectory();
    for (const part of [ROOT, active]) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  } catch {
    return null;
  }
}

const urls = new Map<string, string>();

/** A blob URL for a saved file (kept until the file is deleted), or null if it's missing. */
export async function fileUrl(name: string | undefined, type?: string): Promise<string | null> {
  if (!name) return null;
  const known = urls.get(`${active}/${name}`);
  if (known) return known;
  try {
    const file = await (await (await folder(false))!.getFileHandle(name)).getFile();
    const url = URL.createObjectURL(type ? file.slice(0, file.size, type) : file);
    urls.set(`${active}/${name}`, url);
    return url;
  } catch {
    return null;
  }
}

async function deleteFiles(r: DownloadRecord) {
  const dir = await folder(false);
  const names = [r.files.video, r.files.poster, r.files.thumb, ...r.files.subtitles.map((s) => s.file)].filter(Boolean) as string[];
  for (const name of names) {
    const key = `${active}/${name}`;
    const url = urls.get(key);
    if (url) URL.revokeObjectURL(url);
    urls.delete(key);
    await dir?.removeEntry(name).catch(() => {});
  }
}

/** Space used and left on this device for downloads. */
export async function storageEstimate(): Promise<{ used: number; free: number } | null> {
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage ?? 0, free: Math.max(0, (e.quota ?? 0) - (e.usage ?? 0)) };
  } catch {
    return null;
  }
}

// ---- the worker ------------------------------------------------------------------------

let worker: Worker | null = null;
const jobs = new Map<string, { onProgress: (bytes: number, total?: number) => void; resolve: (bytes: number) => void; reject: (e: Error & { cancelled?: boolean }) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const m = e.data;
    const job = jobs.get(m.job);
    if (!job) return;
    if (m.type === "progress") job.onProgress(m.bytes, m.total);
    else {
      jobs.delete(m.job);
      if (m.type === "done") job.resolve(m.bytes);
      else job.reject(Object.assign(new Error(m.message), { cancelled: m.cancelled }));
    }
  };
  return worker;
}

function saveFile(job: string, url: string, file: string, resume: boolean, onProgress: (bytes: number, total?: number) => void = () => {}): Promise<number> {
  return new Promise((resolve, reject) => {
    jobs.set(job, { onProgress, resolve, reject });
    getWorker().postMessage({ type: "fetch", job, url, dir: `${ROOT}/${active}`, file, resume } satisfies WorkerRequest);
  });
}

// ---- planning: what to fetch -------------------------------------------------------------

function withAuth(path: string): string {
  const c = client();
  const url = new URL(path.startsWith("http") ? path : `${c.serverUrl}${path}`);
  if (c.accessToken && !url.searchParams.has("ApiKey") && !url.searchParams.has("api_key")) url.searchParams.set("ApiKey", c.accessToken);
  return url.toString();
}

interface Plan {
  item: BaseItem;
  url: string;
  /** A conversion's session, to stop it on the server when cancelled. */
  playSessionId?: string;
  resumable: boolean;
  quality: QualityId;
  total: number;
  mediaSourceId: string;
  audioIndex?: number;
  subtitleIndex: number;
  video: { file: string; mime: string };
  subtitles: (SubtitleFile & { url: string })[];
  poster?: string;
  thumb?: string;
  segments: MediaSegment[];
}

async function plan(r: DownloadRecord): Promise<Plan> {
  const full = await getItemFull(r.id);
  const source = pickSource(full.MediaSources ?? [], rememberedVersion(full.Id)) ?? full.MediaSources?.[0];
  if (!source) throw new Error("This title has no video file");
  let quality = r.quality;
  const common = { MediaSourceId: source.Id, AudioStreamIndex: r.audioIndex, SubtitleStreamIndex: -1, StartTimeTicks: 0 };
  let info = null;
  let url = "";
  let resumable = false;
  let total = 0;
  let container = "mp4";

  if (quality === "original") {
    info = await getPlaybackInfo(r.id, {
      ...common,
      DeviceProfile: buildDeviceProfile(200_000_000),
      MaxStreamingBitrate: 200_000_000,
      EnableDirectPlay: true,
      EnableDirectStream: false,
      EnableTranscoding: false,
    });
    const src = info.MediaSources[0];
    // An audio track this device can't play, or a format it can't open: convert instead.
    if (src?.SupportsDirectPlay && !info.ErrorCode && (r.audioIndex === undefined || r.audioIndex === src.DefaultAudioStreamIndex)) {
      container = src.Container ?? "mp4";
      const c = client();
      url = c.url(`/Videos/${r.id}/stream.${videoFileType(container).ext}`, { static: true, mediaSourceId: src.Id, deviceId: c.deviceId, Tag: src.ETag, ApiKey: c.accessToken ?? "" });
      resumable = true;
      total = src.Size ?? 0;
    } else quality = "high";
  }

  if (!url) {
    const preset = qualityOf(quality);
    info = await getPlaybackInfo(r.id, {
      ...common,
      DeviceProfile: downloadProfile(preset),
      MaxStreamingBitrate: preset.bitrate,
      EnableDirectPlay: false,
      EnableDirectStream: false,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
    });
    const src = info.MediaSources[0];
    if (info.ErrorCode === "NotAllowed") throw new Error("Your account isn't allowed to convert videos");
    if (!src?.TranscodingUrl || /\.m3u8/i.test(src.TranscodingUrl)) throw new Error("The server didn't offer a file to download");
    url = withAuth(src.TranscodingUrl);
    total = estimateBytes(full, preset.bitrate);
  }

  const src = info!.MediaSources[0];
  const audioIndex = r.audioIndex ?? src.DefaultAudioStreamIndex;
  const subtitles = src.MediaStreams.filter((s) => s.Type === "Subtitle" && s.IsTextSubtitleStream).map((s) => ({
    index: s.Index,
    label: s.DisplayTitle || s.Language || `Subtitle ${s.Index}`,
    language: s.Language,
    file: `${r.id}.${s.Index}.vtt`,
    url: withAuth(`/Videos/${r.id}/${src.Id}/Subtitles/${s.Index}/0/Stream.vtt`),
  }));
  const preferred = src.DefaultSubtitleStreamIndex;
  const { ext, mime } = videoFileType(container);
  const files = subtitles.map(({ url: _url, ...f }) => f);
  return {
    item: offlineItem(full, src, audioIndex, files),
    url,
    playSessionId: resumable ? undefined : info!.PlaySessionId,
    resumable,
    quality,
    total,
    mediaSourceId: src.Id,
    audioIndex,
    subtitleIndex: subtitles.some((s) => s.index === preferred) ? preferred! : -1,
    video: { file: `${r.id}.${ext}`, mime },
    subtitles,
    poster: posterImage(full, 320)?.url,
    thumb: landscapeImage(full, 640)?.url,
    segments: await getMediaSegments(r.id)
      .then((s) => s.Items)
      .catch(() => []),
  };
}

// ---- the queue ---------------------------------------------------------------------------

let running: { id: string; job: string; playSessionId?: string } | null = null;

async function process(r: DownloadRecord) {
  const job = `${r.id}-${Date.now()}`;
  running = { id: r.id, job };
  update(r.id, { state: "downloading", error: undefined });
  try {
    const p = await plan(r);
    running.playSessionId = p.playSessionId;
    // Carry on an Original file that was cut off; a new conversion starts over.
    const resume = p.resumable && r.quality === p.quality && r.files.video === p.video.file && r.bytes > 0;
    update(r.id, {
      item: { ...p.item, UserData: r.item.UserData },
      quality: p.quality,
      total: p.total,
      bytes: resume ? r.bytes : 0,
      mediaSourceId: p.mediaSourceId,
      audioIndex: p.audioIndex,
      subtitleIndex: p.subtitleIndex,
      segments: p.segments,
      files: { video: p.video.file, mime: p.video.mime, subtitles: p.subtitles.map(({ url: _url, ...f }) => f), poster: p.poster && `${r.id}.poster`, thumb: p.thumb && `${r.id}.thumb` },
    });
    // The small files first, so a title that's partly there still shows properly.
    const small: [string | undefined, string][] = [
      [p.poster, `${r.id}.poster`],
      [p.thumb, `${r.id}.thumb`],
      ...p.subtitles.map((s) => [s.url, s.file] as [string, string]),
    ];
    for (const [url, file] of small) if (url) await saveFile(`${job}-${file}`, url, file, false).catch(() => 0);
    if (running?.id !== r.id) return;
    const bytes = await saveFile(job, p.url, p.video.file, resume, (b, total) =>
      update(r.id, (cur) => ({ bytes: b, total: p.resumable && total ? total : Math.max(cur.total, b) }), false),
    );
    if (bytes < 1024) throw new Error("The server sent an empty file");
    update(r.id, { state: "done", bytes, total: bytes });
    logEvent("downloads", `Downloaded ${r.id} (${p.quality}, ${bytes} bytes)`);
  } catch (e) {
    const cancelled = (e as { cancelled?: boolean }).cancelled;
    if (!findDownload(r.id)) return; // removed while downloading
    update(r.id, { state: cancelled ? "paused" : "failed", error: cancelled ? undefined : e instanceof Error ? e.message : "Download failed" });
    if (!cancelled) logEvent("downloads", `Download of ${r.id} failed: ${e instanceof Error ? e.message : e}`, "warn");
  } finally {
    if (running?.playSessionId) stopEncoding(running.playSessionId).catch(() => {});
    if (running?.id === r.id) running = null;
    pump();
  }
}

/** Starts the next queued download, one at a time. */
function pump() {
  if (running || !active || !navigator.onLine) return;
  const next = records.find((r) => r.state === "queued");
  if (next) process(next);
}

// ---- actions ----------------------------------------------------------------------------

/** Queues titles (films or episodes) for download. Ones already downloaded or queued are left as they are. */
export function downloadItems(items: BaseItem[], opts: { quality: QualityId; audioIndex?: number }) {
  const now = Date.now();
  const fresh = items
    .filter((i) => (i.Type === "Movie" || i.Type === "Episode" || i.Type === "Video") && i.LocationType !== "Virtual" && !findDownload(i.Id))
    .map(
      (i, n): DownloadRecord => ({
        id: i.Id,
        item: { Id: i.Id, Name: i.Name, Type: i.Type, SeriesId: i.SeriesId, SeriesName: i.SeriesName, IndexNumber: i.IndexNumber, ParentIndexNumber: i.ParentIndexNumber, RunTimeTicks: i.RunTimeTicks, UserData: i.UserData },
        quality: opts.quality,
        state: "queued",
        bytes: 0,
        total: opts.quality === "original" ? (i.MediaSources?.[0]?.Size ?? 0) : estimateBytes(i, qualityOf(opts.quality).bitrate),
        addedAt: now + n,
        mediaSourceId: "",
        audioIndex: opts.audioIndex,
        subtitleIndex: -1,
        files: { video: "", mime: "video/mp4", subtitles: [] },
        segments: [],
        position: i.UserData?.PlaybackPositionTicks ?? 0,
        played: Boolean(i.UserData?.Played),
      }),
    );
  if (!fresh.length) return 0;
  records = [...records, ...fresh];
  emit();
  persist();
  navigator.storage.persist?.().catch(() => {});
  pump();
  return fresh.length;
}

export async function removeDownload(id: string) {
  const r = findDownload(id);
  if (!r) return;
  if (running?.id === id) {
    getWorker().postMessage({ type: "cancel", job: running.job } satisfies WorkerRequest);
    running = null;
  }
  records = records.filter((x) => x.id !== id);
  emit();
  persist();
  await deleteFiles(r);
  pump();
}

export function retryDownload(id: string) {
  update(id, { state: "queued", error: undefined });
  pump();
}

export function pauseDownload(id: string) {
  if (running?.id === id) getWorker().postMessage({ type: "cancel", job: running.job } satisfies WorkerRequest);
  else update(id, { state: "paused" });
}

// ---- watch state offline -----------------------------------------------------------------

/** Saves where you are in a downloaded title; sent to the server when it's reachable. */
export function saveOfflineProgress(id: string, ticks: number) {
  update(id, (r) => {
    const played = r.played || watchedAt(r, ticks);
    return { position: watchedAt(r, ticks) ? 0 : ticks, played, dirty: true, lastPlayed: new Date().toISOString() };
  });
}

let syncing = false;

/** Sends offline watching to the server, then refreshes downloads with the server's own watch state. */
export async function syncOfflineProgress() {
  if (syncing || !active || !navigator.onLine) return;
  syncing = true;
  try {
    for (const r of records.filter((x) => x.dirty)) {
      try {
        await updateUserData(r.id, { PlaybackPositionTicks: r.played ? 0 : r.position, Played: r.played, LastPlayedDate: r.lastPlayed });
        update(r.id, { dirty: false });
      } catch {
        return; // still unreachable: try again later
      }
    }
    // Picked up where you left off on another device? Start downloads from there too.
    const clean = records.filter((r) => !r.dirty && r.state === "done").map((r) => r.id);
    for (let i = 0; i < clean.length; i += 100) {
      const ids = clean.slice(i, i + 100);
      const items = (await getItems({ ids, enableImageTypes: [], fields: [] })).Items;
      for (const it of items) {
        const r = findDownload(it.Id);
        if (!r || r.dirty) continue;
        const position = it.UserData?.PlaybackPositionTicks ?? 0;
        const played = Boolean(it.UserData?.Played);
        // A title fixed on the server since (a file name replaced by the real title) follows too.
        const renamed = it.Name && it.Name !== r.item.Name;
        if (position !== r.position || played !== r.played || renamed)
          update(r.id, { position, played, item: { ...r.item, Name: it.Name || r.item.Name, UserData: it.UserData } });
      }
    }
  } catch {
    /* offline */
  } finally {
    syncing = false;
  }
}

/** Keeps downloads running for the signed-in (or offline) account: resumes the queue and syncs watch state. */
export function useDownloadsRunner() {
  const { account, status } = useAuth();
  selectAccount(account);
  useEffect(() => {
    if (!account || !downloadsSupported()) return;
    if (status === "signedIn") {
      pump();
      syncOfflineProgress();
    }
    const online = () => {
      pump();
      syncOfflineProgress();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [account, status]);
}

/** Whether an account has finished downloads (to offer offline mode when its server is unreachable). */
export function hasDownloads(account: Pick<Account, "serverId" | "userId">): boolean {
  return load(accountKey(account)).some((r) => r.state === "done");
}

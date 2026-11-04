// Library management endpoints (administrators): editing, images, subtitles, refresh,
// collections, playlists and deletion. Permissions are enforced by the server; the UI
// only offers these to administrators.

import { client, getItemFull, getItems } from "./jellyfin";
import type { BaseItem, ItemsResult } from "./types";

function uid(): string {
  const id = client().userId;
  if (!id) throw new Error("No signed-in user");
  return id;
}

// ---- metadata ----------------------------------------------------------------------

export interface MetadataEditorInfo {
  ParentalRatingOptions?: { Name: string; Value?: number }[];
}

export const getMetadataEditorInfo = (id: string) => client().request<MetadataEditorInfo>(`/Items/${id}/MetadataEditor`);

/**
 * Saves edits. The server replaces the item with what it's sent, so this always starts
 * from the item's full current data and changes only the edited fields: nothing the
 * editor doesn't show (cast, provider ids, locked fields…) is lost.
 */
export async function updateItemMetadata(id: string, changes: Partial<BaseItem> & Record<string, unknown>) {
  const current = await getItemFull(id);
  const { UserData: _userData, ...rest } = current as BaseItem & Record<string, unknown>;
  await client().request<void>(`/Items/${id}`, { method: "POST", body: { ...rest, ...changes } });
}

// ---- identify (fix a wrong match) --------------------------------------------------------------

/** Item types Jellyfin can re-identify, mapped to its search endpoint. */
const IDENTIFY_TYPES: Record<string, string> = { Movie: "Movie", Series: "Series", BoxSet: "BoxSet", MusicVideo: "MusicVideo", Trailer: "Trailer" };

export const canIdentify = (item: Pick<BaseItem, "Type">) => item.Type in IDENTIFY_TYPES;

export interface RemoteSearchResult {
  Name?: string;
  ProviderIds?: Record<string, string>;
  ProductionYear?: number;
  PremiereDate?: string;
  ImageUrl?: string;
  SearchProviderName?: string;
  Overview?: string;
  [k: string]: unknown;
}

export interface IdentifyQuery {
  name: string;
  year?: number;
  providerIds: Record<string, string>;
}

/** The request body for a provider search; empty ids and a missing year are left out. */
export function identifyBody(itemId: string, q: IdentifyQuery) {
  const providerIds = Object.fromEntries(Object.entries(q.providerIds).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  return {
    ItemId: itemId,
    // Like Jellyfin's own Identify: ask every provider, enabled for this library or not.
    IncludeDisabledProviders: true,
    SearchInfo: { Name: q.name.trim(), Year: q.year && Number.isFinite(q.year) ? q.year : undefined, ProviderIds: providerIds },
  };
}

/** Searches metadata providers for the title an item should be. */
export function searchForMatch(item: Pick<BaseItem, "Id" | "Type">, q: IdentifyQuery) {
  const type = IDENTIFY_TYPES[item.Type];
  if (!type) throw new Error("This kind of item can't be identified.");
  return client().request<RemoteSearchResult[]>(`/Items/RemoteSearch/${type}`, { method: "POST", body: identifyBody(item.Id, q) });
}

/** Re-identifies the item as the chosen result; the server then refreshes its metadata. */
export const applyMatch = (id: string, result: RemoteSearchResult, replaceImages: boolean) =>
  client().request<void>(`/Items/RemoteSearch/Apply/${id}`, { method: "POST", query: { replaceAllImages: replaceImages }, body: result });

// ---- refresh & delete ----------------------------------------------------------------------

export type RefreshMode = "scan" | "missing" | "replace";

/** The three modes Jellyfin offers: new/changed files, missing metadata, or replace everything. */
export function refreshItem(id: string, mode: RefreshMode, opts: { replaceImages?: boolean; regenerateTrickplay?: boolean } = {}) {
  const full = mode !== "scan";
  return client().request<void>(`/Items/${id}/Refresh`, {
    method: "POST",
    query: {
      metadataRefreshMode: full ? "FullRefresh" : "Default",
      imageRefreshMode: full ? "FullRefresh" : "Default",
      replaceAllMetadata: mode === "replace",
      replaceAllImages: full && Boolean(opts.replaceImages),
      regenerateTrickplay: full && Boolean(opts.regenerateTrickplay),
    },
  });
}

/** Permanently deletes the item's files from the server (a collection: just the collection). */
export const deleteItem = (id: string) => client().request<void>(`/Items/${id}`, { method: "DELETE" });

// ---- images --------------------------------------------------------------------------------

export interface ImageInfo {
  ImageType: string;
  ImageIndex?: number;
  ImageTag?: string;
  Width?: number;
  Height?: number;
  Size?: number;
}

export interface RemoteImage {
  ProviderName?: string;
  Url?: string;
  ThumbnailUrl?: string;
  Width?: number;
  Height?: number;
  CommunityRating?: number;
  VoteCount?: number;
  Language?: string;
}

export const getItemImages = (id: string) => client().request<ImageInfo[]>(`/Items/${id}/Images`);

export const getRemoteImages = (id: string, type: string, includeAllLanguages = false) =>
  client().request<{ Images: RemoteImage[]; TotalRecordCount: number }>(`/Items/${id}/RemoteImages`, {
    query: { type, includeAllLanguages, limit: 60 },
  });

export const downloadRemoteImage = (id: string, type: string, imageUrl: string) =>
  client().request<void>(`/Items/${id}/RemoteImages/Download`, { method: "POST", query: { type, imageUrl } });

export const deleteItemImage = (id: string, type: string, index?: number) =>
  client().request<void>(index === undefined ? `/Items/${id}/Images/${type}` : `/Items/${id}/Images/${type}/${index}`, { method: "DELETE" });

const readBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Uploads an image file (the server expects the bytes base64-encoded). */
export async function uploadItemImage(id: string, type: string, file: File) {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  const c = client();
  const response = await fetch(c.url(`/Items/${id}/Images/${type}`), {
    method: "POST",
    headers: { Authorization: c.authorizationHeader(), "Content-Type": file.type },
    body: await readBase64(file),
  });
  if (!response.ok) throw new Error(`Upload failed (${response.status})`);
}

// ---- subtitles ----------------------------------------------------------------------------

export interface RemoteSubtitle {
  Id: string;
  ProviderName?: string;
  Name?: string;
  Format?: string;
  Author?: string;
  Comment?: string;
  CommunityRating?: number;
  DownloadCount?: number;
  IsHashMatch?: boolean;
  Forced?: boolean;
  HearingImpaired?: boolean;
  MachineTranslated?: boolean;
  AiTranslated?: boolean;
}

export const searchRemoteSubtitles = (id: string, language: string) =>
  client().request<RemoteSubtitle[]>(`/Items/${id}/RemoteSearch/Subtitles/${encodeURIComponent(language)}`);

export const downloadRemoteSubtitle = (id: string, subtitleId: string) =>
  client().request<void>(`/Items/${id}/RemoteSearch/Subtitles/${encodeURIComponent(subtitleId)}`, { method: "POST" });

export const deleteSubtitle = (id: string, index: number) => client().request<void>(`/Videos/${id}/Subtitles/${index}`, { method: "DELETE" });

export async function uploadSubtitle(id: string, file: File, opts: { language: string; forced: boolean; hearingImpaired: boolean }) {
  const format = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["srt", "vtt", "ass", "ssa", "sub"].includes(format)) throw new Error("Use an .srt, .vtt, .ass, .ssa or .sub file.");
  await client().request<void>(`/Videos/${id}/Subtitles`, {
    method: "POST",
    body: { Language: opts.language, Format: format, IsForced: opts.forced, IsHearingImpaired: opts.hearingImpaired, Data: await readBase64(file) },
  });
}

// ---- collections & playlists --------------------------------------------------------------

export const getCollections = () =>
  getItems({ includeItemTypes: ["BoxSet"], recursive: true, sortBy: ["SortName"], sortOrder: "Ascending", limit: 500, enableImageTypes: ["Primary"] });

export const addToCollection = (collectionId: string, ids: string[]) =>
  client().request<void>(`/Collections/${collectionId}/Items`, { method: "POST", query: { ids } });

export const createCollection = (name: string, ids: string[]) =>
  client().request<{ Id: string }>("/Collections", { method: "POST", query: { name, ids, isLocked: false } });

export const getPlaylists = () =>
  client().request<ItemsResult>("/Items", {
    query: { userId: uid(), includeItemTypes: ["Playlist"], recursive: true, sortBy: ["SortName"], sortOrder: "Ascending", limit: 500, enableImageTypes: ["Primary"] },
  });

export const addToPlaylist = (playlistId: string, ids: string[]) =>
  client().request<void>(`/Playlists/${playlistId}/Items`, { method: "POST", query: { ids, userId: uid() } });

export const createPlaylist = (name: string, ids: string[]) =>
  client().request<{ Id: string }>("/Playlists", { method: "POST", body: { Name: name, Ids: ids, UserId: uid(), MediaType: "Video" } });

// ---- links -----------------------------------------------------------------------------------

/** The original file, as a download. Carries the access token, like Jellyfin's own link. */
export function downloadUrl(id: string): string {
  const c = client();
  return c.url(`/Items/${id}/Download`, { api_key: c.accessToken ?? undefined });
}

/** A direct stream for players like VLC or mpv. Carries the access token: not for sharing. */
export function streamUrl(item: Pick<BaseItem, "Id" | "MediaSources">): string {
  const c = client();
  const source = item.MediaSources?.[0];
  return c.url(`/Videos/${item.Id}/stream${source?.Container ? `.${source.Container.split(",")[0]}` : ""}`, {
    static: true,
    mediaSourceId: source?.Id ?? item.Id,
    api_key: c.accessToken ?? undefined,
  });
}

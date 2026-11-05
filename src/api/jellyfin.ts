import { JellyfinClient, type Query } from "./client";
import type {
  AuthenticationResult,
  BaseItem,
  ItemsResult,
  MediaSegment,
  PlaybackInfoResponse,
  PublicSystemInfo,
  QueryFilters,
  QueryFiltersLegacy,
  QuickConnectResult,
  SearchHint,
  User,
  UserItemData,
} from "./types";

// The active client. AuthProvider replaces it on sign-in, sign-out and user switch.
let active: JellyfinClient | null = null;

export function setClient(client: JellyfinClient | null) {
  active = client;
}

export function client(): JellyfinClient {
  if (!active) throw new Error("Jellyfin client is not initialised");
  return active;
}

function uid(): string {
  const id = client().userId;
  if (!id) throw new Error("No signed-in user");
  return id;
}

/** Fields needed to render a card (poster, title, year, progress, genres). */
export const CARD_FIELDS = ["PrimaryImageAspectRatio", "Genres", "ChildCount", "Overview"];
/** Fields the recommendation engine scores on. */
export const PROFILE_FIELDS = [
  "Genres",
  "People",
  "Studios",
  "Tags",
  "ProviderIds",
  "DateCreated",
  "ChildCount",
  "RecursiveItemCount",
  "PrimaryImageAspectRatio",
  "Overview",
];
/** Fields for full detail pages. */
export const DETAIL_FIELDS = [
  "Overview",
  "Genres",
  "People",
  "Studios",
  "Taglines",
  "Tags",
  "ExternalUrls",
  "ProviderIds",
  "RemoteTrailers",
  "LocalTrailerCount",
  "MediaSources",
  "MediaStreams",
  "ChildCount",
  "RecursiveItemCount",
  "DateCreated",
  "PrimaryImageAspectRatio",
  "Trickplay",
  "Chapters",
  "OriginalTitle",
];

const IMAGE_TYPES = ["Primary", "Backdrop", "Logo", "Thumb"];

// ---- Server & authentication ----------------------------------------------------

export const getPublicInfo = (c: JellyfinClient, signal?: AbortSignal) => c.request<PublicSystemInfo>("/System/Info/Public", { signal });

export const getPublicUsers = (c: JellyfinClient) => c.request<User[]>("/Users/Public");

export const authenticateByName = (c: JellyfinClient, username: string, password: string) =>
  c.request<AuthenticationResult>("/Users/AuthenticateByName", {
    method: "POST",
    body: { Username: username, Pw: password },
  });

export const quickConnectEnabled = (c: JellyfinClient) => c.request<boolean>("/QuickConnect/Enabled");
export const quickConnectInitiate = (c: JellyfinClient) => c.request<QuickConnectResult>("/QuickConnect/Initiate", { method: "POST" });
export const quickConnectState = (c: JellyfinClient, secret: string) => c.request<QuickConnectResult>("/QuickConnect/Connect", { query: { secret } });
export const authenticateWithQuickConnect = (c: JellyfinClient, secret: string) =>
  c.request<AuthenticationResult>("/Users/AuthenticateWithQuickConnect", {
    method: "POST",
    body: { Secret: secret },
  });

export const getMe = (c: JellyfinClient) => c.request<User>("/Users/Me");
export const logout = (c: JellyfinClient) => c.request<void>("/Sessions/Logout", { method: "POST" });

export const updateUserConfiguration = (config: User["Configuration"]) =>
  client().request<void>("/Users/Configuration", { method: "POST", query: { userId: uid() }, body: config });

// ---- Libraries & items ----------------------------------------------------------

export const getViews = () => client().request<ItemsResult>("/UserViews", { query: { userId: uid() } });

export interface ItemQuery extends Query {
  parentId?: string;
  includeItemTypes?: string[];
  excludeItemTypes?: string[];
  recursive?: boolean;
  sortBy?: string[];
  sortOrder?: string;
  limit?: number;
  startIndex?: number;
  fields?: string[];
  filters?: string[];
  genres?: string;
  years?: string;
  tags?: string;
  studios?: string;
  officialRatings?: string;
  personIds?: string[];
  person?: string;
  isPlayed?: boolean;
  isFavorite?: boolean;
  ids?: string[];
  searchTerm?: string;
  nameStartsWith?: string;
  hasOverview?: boolean;
  imageTypes?: string[];
  collapseBoxSetItems?: boolean;
  enableTotalRecordCount?: boolean;
}

export const getItems = (query: ItemQuery, signal?: AbortSignal) =>
  client().request<ItemsResult>("/Items", {
    query: {
      userId: uid(),
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      enableUserData: true,
      ...query,
    },
    signal,
  });

export const getItem = (id: string, fields = DETAIL_FIELDS) =>
  getItems({ ids: [id], fields, enableImageTypes: [...IMAGE_TYPES, "Banner"] }).then((r) => {
    const item = r.Items[0];
    if (!item) throw new Error("Item not found");
    return item;
  });

/** Single item with every field the server has (detail pages). */
export const getItemFull = (id: string) => client().request<BaseItem>(`/Items/${id}`, { query: { userId: uid() } });

export const getResume = (limit = 24, mediaTypes = "Video") =>
  client().request<ItemsResult>("/UserItems/Resume", {
    query: {
      userId: uid(),
      limit,
      mediaTypes,
      fields: CARD_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      enableUserData: true,
    },
  });

export const getNextUp = (opts: { limit?: number; seriesId?: string; enableRewatching?: boolean } = {}) =>
  client().request<ItemsResult>("/Shows/NextUp", {
    query: {
      userId: uid(),
      limit: opts.limit ?? 24,
      seriesId: opts.seriesId,
      fields: CARD_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      enableUserData: true,
      enableResumable: false,
      enableRewatching: opts.enableRewatching ?? false,
    },
  });

export const getLatest = (opts: { parentId?: string; includeItemTypes?: string[]; limit?: number } = {}) =>
  client().request<BaseItem[]>("/Items/Latest", {
    query: {
      userId: uid(),
      parentId: opts.parentId,
      includeItemTypes: opts.includeItemTypes,
      limit: opts.limit ?? 24,
      fields: CARD_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      enableUserData: true,
      groupItems: true,
    },
  });

export const getSimilar = (id: string, limit = 18) =>
  client().request<ItemsResult>(`/Items/${id}/Similar`, {
    query: { userId: uid(), limit, fields: CARD_FIELDS },
  });

export const getSeasons = (seriesId: string) =>
  client().request<ItemsResult>(`/Shows/${seriesId}/Seasons`, {
    query: { userId: uid(), fields: ["ChildCount", "Overview", "PrimaryImageAspectRatio"], enableUserData: true },
  });

export const getEpisodes = (seriesId: string, seasonId?: string) =>
  client().request<ItemsResult>(`/Shows/${seriesId}/Episodes`, {
    query: {
      userId: uid(),
      seasonId,
      fields: ["Overview", "PrimaryImageAspectRatio", "MediaSources"],
      enableImageTypes: IMAGE_TYPES,
      enableUserData: true,
    },
  });

export const getLocalTrailers = (id: string) => client().request<BaseItem[]>(`/Items/${id}/LocalTrailers`, { query: { userId: uid() } });

/** Behind the scenes, deleted scenes, featurettes, interviews… */
export const getSpecialFeatures = (id: string) => client().request<BaseItem[]>(`/Items/${id}/SpecialFeatures`, { query: { userId: uid() } });

/** Episodes airing soon (future premiere dates the server knows about). */
export const getUpcoming = (limit = 24) =>
  client().request<ItemsResult>("/Shows/Upcoming", {
    query: {
      userId: uid(),
      limit,
      fields: [...CARD_FIELDS, "PremiereDate"],
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      enableUserData: true,
    },
  });

export const getGenres = (opts: { parentId?: string; includeItemTypes?: string[] } = {}) =>
  client().request<ItemsResult>("/Genres", {
    query: {
      userId: uid(),
      parentId: opts.parentId,
      includeItemTypes: opts.includeItemTypes,
      sortBy: ["SortName"],
      enableImageTypes: IMAGE_TYPES,
      fields: ["ItemCounts"],
    },
  });

export const getFilters = (opts: { parentId?: string; includeItemTypes?: string[] }) =>
  client().request<QueryFilters>("/Items/Filters2", {
    query: { userId: uid(), parentId: opts.parentId, includeItemTypes: opts.includeItemTypes },
  });

export const getLegacyFilters = (opts: { parentId?: string; includeItemTypes?: string[] }) =>
  client().request<QueryFiltersLegacy>("/Items/Filters", {
    query: { userId: uid(), parentId: opts.parentId, includeItemTypes: opts.includeItemTypes },
  });

export const searchHints = (searchTerm: string, opts: { limit?: number; includeItemTypes?: string[] } = {}, signal?: AbortSignal) =>
  client().request<{ SearchHints: SearchHint[]; TotalRecordCount: number }>("/Search/Hints", {
    query: {
      userId: uid(),
      searchTerm,
      limit: opts.limit ?? 60,
      includeItemTypes: opts.includeItemTypes,
      includePeople: true,
      includeMedia: true,
      includeGenres: true,
      includeStudios: false,
      includeArtists: false,
    },
    signal,
  });

export const getPersons = (searchTerm: string, limit = 24, signal?: AbortSignal) =>
  client().request<ItemsResult>("/Persons", {
    query: { userId: uid(), searchTerm, limit, enableImageTypes: ["Primary"], fields: ["PrimaryImageAspectRatio"] },
    signal,
  });

export const getMediaSegments = (id: string) => client().request<ItemsResult<MediaSegment>>(`/MediaSegments/${id}`);

// ---- User data ------------------------------------------------------------------

export const setFavorite = (id: string, favorite: boolean) =>
  client().request<UserItemData>(`/UserFavoriteItems/${id}`, {
    method: favorite ? "POST" : "DELETE",
    query: { userId: uid() },
  });

export const setPlayed = (id: string, played: boolean) =>
  client().request<UserItemData>(`/UserPlayedItems/${id}`, {
    method: played ? "POST" : "DELETE",
    query: { userId: uid() },
  });

/** Your own 0–10 score, shared with other Jellyfin clients. */
export const setUserRating = (id: string, rating: number | null) => updateUserData(id, { Rating: rating });

/** Changes your watch state directly: resume point, watched, last played (downloads, Continue Watching). */
export const updateUserData = (id: string, data: { Rating?: number | null; PlaybackPositionTicks?: number; Played?: boolean; LastPlayedDate?: string }) =>
  client().request<UserItemData>(`/UserItems/${id}/UserData`, {
    method: "POST",
    query: { userId: uid() },
    body: data,
  });

// ---- Playback -------------------------------------------------------------------

export const getPlaybackInfo = (id: string, body: Record<string, unknown>) =>
  client().request<PlaybackInfoResponse>(`/Items/${id}/PlaybackInfo`, {
    method: "POST",
    // Track choices also go in the query: the server reads them from there and
    // otherwise falls back to the user's remembered tracks.
    query: {
      userId: uid(),
      mediaSourceId: body.MediaSourceId as string | undefined,
      audioStreamIndex: body.AudioStreamIndex as number | undefined,
      subtitleStreamIndex: body.SubtitleStreamIndex as number | undefined,
      startTimeTicks: body.StartTimeTicks as number | undefined,
      maxStreamingBitrate: body.MaxStreamingBitrate as number | undefined,
      enableDirectPlay: body.EnableDirectPlay as boolean | undefined,
      enableDirectStream: body.EnableDirectStream as boolean | undefined,
    },
    body: { UserId: uid(), ...body },
  });

export const reportPlaybackStart = (body: Record<string, unknown>) => client().request<void>("/Sessions/Playing", { method: "POST", body });
export const reportPlaybackProgress = (body: Record<string, unknown>) => client().request<void>("/Sessions/Playing/Progress", { method: "POST", body });
export const reportPlaybackStopped = (body: Record<string, unknown>) =>
  // No keepalive: Chrome rejects keepalive requests that need a CORS preflight, which
  // every authenticated cross-origin call to Jellyfin does.
  client().request<void>("/Sessions/Playing/Stopped", { method: "POST", body });
export const pingPlayback = (playSessionId: string) => client().request<void>("/Sessions/Playing/Ping", { method: "POST", query: { playSessionId } });

export const stopEncoding = (playSessionId: string) =>
  client().request<void>("/Videos/ActiveEncodings", {
    method: "DELETE",
    query: { deviceId: client().deviceId, playSessionId },
  });

// ---- Plugin integrations --------------------------------------------------------

/** Media Bar plugin server config. Public endpoint; 404 when the plugin is absent. */
export const getMediaBarWebConfig = () => client().request<Record<string, unknown>>("/MediaBar/WebConfig");

/** The MediaBar curated list (avatars/list.txt), served by Jellyfin's web host. */
export const getMediaBarList = () => client().request<string>("/web/avatars/list.txt", { text: true, query: { userId: uid() } });

// Subset of the Jellyfin 10.11 API models that Argent reads. Field names match the
// server's JSON exactly; anything not listed here is simply ignored.

export type ItemType =
  | "Movie"
  | "Series"
  | "Season"
  | "Episode"
  | "BoxSet"
  | "Person"
  | "Genre"
  | "CollectionFolder"
  | "UserView"
  | "Folder"
  | "Playlist"
  | "Trailer"
  | "Video"
  | "MusicAlbum"
  | "Audio"
  | (string & {});

export type ImageType = "Primary" | "Backdrop" | "Logo" | "Thumb" | "Banner" | "Art" | "Disc";

export interface UserItemData {
  PlaybackPositionTicks?: number;
  PlayCount?: number;
  IsFavorite?: boolean;
  Played?: boolean;
  PlayedPercentage?: number;
  LastPlayedDate?: string;
  UnplayedItemCount?: number;
  Rating?: number;
  Likes?: boolean | null;
  Key?: string;
}

export interface NameIdPair {
  Name: string;
  Id: string;
}

export interface BaseItemPerson {
  Name: string;
  Id: string;
  Role?: string;
  Type: "Actor" | "Director" | "Writer" | "Producer" | "GuestStar" | "Composer" | (string & {});
  PrimaryImageTag?: string;
  ImageBlurHashes?: ImageBlurHashes;
}

export type ImageBlurHashes = Partial<Record<ImageType, Record<string, string>>>;

export interface MediaStream {
  Index: number;
  Type: "Video" | "Audio" | "Subtitle" | "EmbeddedImage" | "Data" | "Lyric";
  Codec?: string;
  Language?: string;
  Title?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  IsTextSubtitleStream?: boolean;
  SupportsExternalStream?: boolean;
  DeliveryMethod?: "Encode" | "Embed" | "External" | "Hls" | "Drop";
  DeliveryUrl?: string;
  Width?: number;
  Height?: number;
  Channels?: number;
  ChannelLayout?: string;
  BitRate?: number;
  VideoRange?: string;
  VideoRangeType?: string;
  RealFrameRate?: number;
  AverageFrameRate?: number;
}

export interface MediaAttachment {
  Index: number;
  Codec?: string;
  FileName?: string;
  MimeType?: string;
  DeliveryUrl?: string;
}

export interface MediaSource {
  Id: string;
  MediaAttachments?: MediaAttachment[];
  Name?: string;
  Path?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  RunTimeTicks?: number;
  SupportsDirectPlay: boolean;
  SupportsDirectStream: boolean;
  SupportsTranscoding: boolean;
  TranscodingUrl?: string;
  TranscodingSubProtocol?: "http" | "hls";
  TranscodingContainer?: string;
  MediaStreams: MediaStream[];
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  ETag?: string;
  LiveStreamId?: string;
}

export interface TrickplayInfo {
  Width: number;
  Height: number;
  TileWidth: number;
  TileHeight: number;
  ThumbnailCount: number;
  Interval: number;
  Bandwidth: number;
}

export interface ExternalUrl {
  Name: string;
  Url: string;
}

export interface BaseItem {
  Id: string;
  Name: string;
  OriginalTitle?: string;
  SortName?: string;
  Type: ItemType;
  ServerId?: string;
  Overview?: string;
  Taglines?: string[];
  Genres?: string[];
  GenreItems?: NameIdPair[];
  Tags?: string[];
  Studios?: NameIdPair[];
  People?: BaseItemPerson[];
  ProductionYear?: number;
  PremiereDate?: string;
  EndDate?: string;
  DateCreated?: string;
  OfficialRating?: string;
  CommunityRating?: number;
  CriticRating?: number;
  RunTimeTicks?: number;
  Status?: string;
  ChildCount?: number;
  RecursiveItemCount?: number;
  ImageTags?: Partial<Record<ImageType, string>>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  ParentLogoItemId?: string;
  ParentLogoImageTag?: string;
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  SeriesPrimaryImageTag?: string;
  ImageBlurHashes?: ImageBlurHashes;
  PrimaryImageAspectRatio?: number;
  UserData?: UserItemData;
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  SeasonName?: string;
  ParentId?: string;
  IndexNumber?: number;
  IndexNumberEnd?: number;
  ParentIndexNumber?: number;
  CollectionType?: string;
  MediaType?: string;
  MediaSources?: MediaSource[];
  MediaStreams?: MediaStream[];
  RemoteTrailers?: ExternalUrl[];
  LocalTrailerCount?: number;
  ExternalUrls?: ExternalUrl[];
  ProviderIds?: Record<string, string>;
  Trickplay?: Record<string, Record<string, TrickplayInfo>>;
  IsFolder?: boolean;
  LocationType?: string;
  Chapters?: { StartPositionTicks: number; Name?: string; ImageTag?: string }[];
  ProductionLocations?: string[];
  /** The file or folder on the server (administrators). */
  Path?: string;
  /** Special features: "BehindTheScenes", "DeletedScene", "Featurette", "Interview"… */
  ExtraType?: string;
  /** Argent's own: other library items for the same episode, hidden behind this one (see api/duplicates.ts). */
  Copies?: { Id: string; Path?: string }[];
  /** Argent's own: the copy whose picture this episode shows, when it has none itself. */
  PrimaryImageItemId?: string;
  /** Argent's own: the title shown came from another copy (this one has only a file name). */
  BorrowedName?: boolean;
}

export interface ItemsResult<T = BaseItem> {
  Items: T[];
  TotalRecordCount: number;
  StartIndex?: number;
}

export interface UserPolicy {
  IsAdministrator: boolean;
  IsDisabled?: boolean;
  EnableContentDeletion?: boolean;
  EnableMediaPlayback?: boolean;
  EnableVideoPlaybackTranscoding?: boolean;
  EnableAudioPlaybackTranscoding?: boolean;
  EnablePlaybackRemuxing?: boolean;
  EnableCollectionManagement?: boolean;
  EnableSubtitleManagement?: boolean;
}

export interface UserConfiguration {
  AudioLanguagePreference?: string;
  SubtitleLanguagePreference?: string;
  SubtitleMode?: "Default" | "Always" | "OnlyForced" | "None" | "Smart";
  PlayDefaultAudioTrack?: boolean;
  EnableNextEpisodeAutoPlay?: boolean;
  RememberAudioSelections?: boolean;
  RememberSubtitleSelections?: boolean;
  HidePlayedInLatest?: boolean;
  OrderedViews?: string[];
  MyMediaExcludes?: string[];
  LatestItemsExcludes?: string[];
}

export interface User {
  Id: string;
  Name: string;
  ServerId?: string;
  PrimaryImageTag?: string;
  HasPassword?: boolean;
  Policy?: UserPolicy;
  Configuration?: UserConfiguration;
  LastActivityDate?: string;
}

export interface AuthenticationResult {
  User: User;
  AccessToken: string;
  ServerId: string;
  SessionInfo?: { Id: string };
}

export interface PublicSystemInfo {
  LocalAddress?: string;
  ServerName: string;
  Version: string;
  ProductName?: string;
  Id: string;
  StartupWizardCompleted?: boolean;
}

export interface QuickConnectResult {
  Authenticated: boolean;
  Secret: string;
  Code: string;
  DeviceId?: string;
}

export interface PlaybackInfoResponse {
  MediaSources: MediaSource[];
  PlaySessionId: string;
  ErrorCode?: "NotAllowed" | "NoCompatibleStream" | "RateLimitExceeded" | (string & {});
}

export interface SearchHint {
  ItemId: string;
  Id: string;
  Name: string;
  Type: ItemType;
  ProductionYear?: number;
  PrimaryImageTag?: string;
  ThumbImageTag?: string;
  ThumbImageItemId?: string;
  BackdropImageTag?: string;
  BackdropImageItemId?: string;
  BlurHashes?: ImageBlurHashes;
  Series?: string;
  MatchedTerm?: string;
  RunTimeTicks?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
}

export interface QueryFilters {
  Genres?: NameIdPair[];
  Tags?: string[];
}

export interface QueryFiltersLegacy {
  Genres?: string[];
  Tags?: string[];
  OfficialRatings?: string[];
  Years?: number[];
}

export interface MediaSegment {
  Id: string;
  ItemId: string;
  Type: "Unknown" | "Commercial" | "Preview" | "Recap" | "Outro" | "Intro";
  StartTicks: number;
  EndTicks: number;
}

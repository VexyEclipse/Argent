// Engine-facing data model. Decoupled from the Jellyfin DTOs so the scoring can be
// developed and tested on its own (see engine.test.ts).

export type EngineItemType = "Movie" | "Series";
export type PersonRole = "Actor" | "Director" | "Writer";

export interface EnginePerson {
  id: string;
  name: string;
  role: PersonRole;
  /** Billing order for actors (0 = lead). */
  order: number;
}

export interface EngineUserData {
  played: boolean;
  playCount: number;
  /** ms since epoch */
  lastPlayed?: number;
  /** 0–1 position within a partially watched movie */
  progress: number;
  favorite: boolean;
  likes?: boolean | null;
  /** 0–10 user rating when the server has one */
  rating?: number;
}

export interface EngineItem {
  id: string;
  type: EngineItemType;
  name: string;
  genres: string[];
  tags: string[];
  studios: string[];
  /** Only populated for history items and person-index hits; may be empty. */
  people: EnginePerson[];
  year?: number;
  communityRating?: number;
  criticRating?: number;
  officialRating?: string;
  runtimeMinutes?: number;
  /** ms since epoch */
  dateAdded?: number;
  user: EngineUserData;
  /** Series only: episodes watched / total. */
  episodesWatched?: number;
  episodesTotal?: number;
}

/** One title the user engaged with, plus how strongly. */
export interface HistorySignal {
  item: EngineItem;
  /** 0–1 portion finished (movie progress, or share of a series' episodes). */
  completion: number;
  plays: number;
  lastPlayed?: number;
  /** Series only: number of distinct episodes watched. */
  episodes?: number;
  /** Partially watched and abandoned long ago. */
  abandoned?: boolean;
}

export interface Feedback {
  /** itemId -> ms dismissed ("not interested") */
  dismissed: Record<string, number>;
  /** itemId -> { shown count, last shown ms, clicked } */
  impressions: Record<string, { count: number; last: number; clicked?: boolean }>;
}

export interface Weights {
  genre: number;
  people: number;
  similar: number;
  tags: number;
  studio: number;
  era: number;
  quality: number;
  runtime: number;
  type: number;
  freshness: number;
  /** Penalty per unclicked impression (decays over a week). */
  impressionPenalty: number;
  /** Negative-signal multiplier for dismissed/abandoned features. */
  negative: number;
  /** MMR diversity trade-off, 0 = pure relevance. */
  diversity: number;
  /** Daily jitter amplitude so ordering rotates without becoming random. */
  rotation: number;
}

export type Strength = "strong" | "good" | "exploratory";

export type ReasonKind = "similar" | "person" | "genre" | "tag" | "era" | "quality" | "studio" | "new" | "explore";

export interface Reason {
  kind: ReasonKind;
  text: string;
}

export interface ScoredItem {
  item: EngineItem;
  score: number;
  strength: Strength;
  components: Record<keyof Omit<Weights, "impressionPenalty" | "negative" | "diversity" | "rotation">, number>;
  reason: Reason;
}

/** Signals gathered from the server beyond item metadata. */
export interface ExternalSignals {
  /** candidateId -> person ids from the user's top people who appear in it */
  personHits: Map<string, string[]>;
  /** candidateId -> [{ seedId, rank (0-based), listLength }] from Jellyfin's Similar */
  similarHits: Map<string, { seedId: string; rank: number; of: number }[]>;
}

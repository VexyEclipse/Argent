// Pure Vault rules: what a library check adds or changes, how two devices' copies merge,
// who a title is hidden from, filtering, and export. No DOM, no network.

export type VaultType = "Series" | "Movie";

export interface VaultLast {
  /** "S2 · E5" */
  code: string;
  name?: string;
  /** ms */
  at: number;
}

export interface VaultEntry {
  /** The title's current (or last known) Jellyfin item id. */
  id: string;
  type: VaultType;
  name: string;
  year?: number;
  endYear?: number;
  /** Provider ids (Tmdb, Tvdb, Imdb, AniList…), so a re-added title is known again. */
  ids?: Record<string, string>;
  /** Its main genre (kept as a list for older copies). */
  genres?: string[];
  /** ms: first found in the library. */
  added: number;
  /** ms: the last check that found it. */
  seen: number;
  /** ms: when a check first found it gone. Unset while it's in the library. */
  missing?: number;
  // Shows
  /** Seasons with at least one episode. */
  seasons?: number;
  /** Episodes in the library now (each counted once, whatever the copies). */
  episodes?: number;
  /** The most episodes it has ever had, to spot a show that lost some. */
  most?: number;
  /** Episodes per season now, and the most each season has had ("1" → 12; left out while the same). */
  perSeason?: Record<string, number>;
  peak?: Record<string, number>;
  /** Episodes you've watched. */
  watched?: number;
  /** The last episode you watched. */
  last?: VaultLast;
  // Movies
  minutes?: number;
  /** Resume point, in percent. */
  progress?: number;
  /** A film you've seen, or a show with every episode watched. */
  played?: boolean;
  /** Your 1–10 score. */
  rating?: number;
  /** The poster's image tag and BlurHash. */
  tag?: string;
  blur?: string;
  /** Kept out of the list (the Hidden filter). */
  hidden?: boolean;
  /** Administrators: the users (short ids) it's hidden from. */
  hiddenFrom?: string[];
  /** Administrators: only this user (short id) may see it, including users added later. */
  owner?: string;
  /** After a season or episode is deleted in Argent: the next check takes the new count as complete. */
  resetPeak?: boolean;
  /** ms: the last meaningful change. When devices merge, the newer entry wins. */
  at: number;
}

export interface VaultState {
  entries: Record<string, VaultEntry>;
  /** key → ms when it left the Vault (deleted in Argent), so a stale device can't bring it back. */
  removed: Record<string, number>;
}

/** One title as a library check found it. */
export interface ScanTitle {
  id: string;
  type: VaultType;
  name: string;
  year?: number;
  endYear?: number;
  ids?: Record<string, string>;
  genres?: string[];
  tag?: string;
  blur?: string;
  /** The item's tags (administrators), for who it's hidden from. */
  tags?: string[];
  /** ms: when Jellyfin added it, so a first check already knows what's recent. */
  created?: number;
  perSeason?: Record<string, number>;
  watched?: number;
  last?: VaultLast;
  minutes?: number;
  progress?: number;
  played?: boolean;
  rating?: number;
}

export const emptyVault = (): VaultState => ({ entries: {}, removed: {} });

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

// ---- visibility tags ------------------------------------------------------------------------

/** Users are named in tags by the first 8 characters of their id. */
export const shortId = (userId: string) => userId.replace(/-/g, "").slice(0, 8).toLowerCase();
/** On a title hidden from that user. Each user's policy blocks their own tag. */
export const hideTag = (userId: string) => `argent-hidden-${shortId(userId)}`;
/** On a title only that user may see; Argent hides it from everyone else, users added later too. */
export const privateTag = (userId: string) => `argent-private-${shortId(userId)}`;

const HIDE_RE = /^argent-hidden-([0-9a-f]{8})$/i;
const PRIVATE_RE = /^argent-private-([0-9a-f]{8})$/i;

/** Who a title's tags hide it from. */
export function visibilityOf(tags: string[] | undefined): { hiddenFrom: string[]; owner?: string } {
  const hiddenFrom: string[] = [];
  let owner: string | undefined;
  for (const tag of tags ?? []) {
    const hide = HIDE_RE.exec(tag);
    if (hide) hiddenFrom.push(hide[1].toLowerCase());
    const own = PRIVATE_RE.exec(tag);
    if (own) owner = own[1].toLowerCase();
  }
  return { hiddenFrom: [...new Set(hiddenFrom)].sort(), owner };
}

/** The title's tags with Argent's visibility tags replaced. Other tags are kept as they were. */
export function withVisibility(tags: string[] | undefined, hideFrom: string[], ownerId?: string): string[] {
  const kept = (tags ?? []).filter((t) => !HIDE_RE.test(t) && !PRIVATE_RE.test(t));
  const ours = [...new Set(hideFrom.map(hideTag))].sort();
  return [...kept, ...(ownerId ? [privateTag(ownerId)] : []), ...ours];
}

// ---- episodes ---------------------------------------------------------------------------------

export interface EpisodeLite {
  Id: string;
  SeriesId?: string;
  Name?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  IndexNumberEnd?: number;
  LocationType?: string;
  UserData?: { Played?: boolean; LastPlayedDate?: string };
}

export interface ShowSummary {
  perSeason: Record<string, number>;
  watched: number;
  last?: VaultLast;
}

/**
 * Each show's episodes per season and how many you've watched. An episode in the library
 * more than once (a second release, a re-scanned folder) counts once, and a double episode
 * ("E01-E02") counts as both.
 */
export function summariseEpisodes(episodes: EpisodeLite[]): Map<string, ShowSummary> {
  const shows = new Map<string, { seasons: Map<string, Set<string>>; played: Set<string>; last?: VaultLast }>();
  for (const ep of episodes) {
    if (!ep.SeriesId || ep.LocationType === "Virtual") continue;
    let show = shows.get(ep.SeriesId);
    if (!show) shows.set(ep.SeriesId, (show = { seasons: new Map(), played: new Set() }));
    const season = String(ep.ParentIndexNumber ?? 1);
    const numbers: string[] = [];
    if (isNum(ep.IndexNumber)) {
      const end = isNum(ep.IndexNumberEnd) && ep.IndexNumberEnd > ep.IndexNumber && ep.IndexNumberEnd - ep.IndexNumber < 10 ? ep.IndexNumberEnd : ep.IndexNumber;
      for (let n = ep.IndexNumber; n <= end; n++) numbers.push(`${season}:${n}`);
    } else numbers.push(`${season}:id-${ep.Id}`);
    let set = show.seasons.get(season);
    if (!set) show.seasons.set(season, (set = new Set()));
    for (const n of numbers) set.add(n);
    if (ep.UserData?.Played) for (const n of numbers) show.played.add(n);
    const at = Date.parse(ep.UserData?.LastPlayedDate ?? "");
    if (ep.UserData?.Played && Number.isFinite(at) && at > (show.last?.at ?? 0)) {
      const code = isNum(ep.IndexNumber) ? `S${season} · E${ep.IndexNumber}` : `Season ${season}`;
      show.last = { code, name: ep.Name, at };
    }
  }
  const out = new Map<string, ShowSummary>();
  for (const [id, show] of shows) {
    const perSeason: Record<string, number> = {};
    for (const [season, set] of show.seasons) perSeason[season] = set.size;
    // Only episodes still in the library count as watched.
    let watched = 0;
    for (const set of show.seasons.values()) for (const n of set) if (show.played.has(n)) watched++;
    out.set(id, { perSeason, watched, last: show.last });
  }
  return out;
}

const total = (perSeason?: Record<string, number>) => Object.values(perSeason ?? {}).reduce((a, b) => a + b, 0);

// ---- a library check --------------------------------------------------------------------------

/** Provider ids that identify the same title across libraries and servers. */
const PROVIDERS = ["Tmdb", "Tvdb", "Imdb", "AniList", "MyAnimeList", "AniDB", "TvMaze"];

const normName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");

function matchKeys(t: { type: VaultType; name: string; year?: number; ids?: Record<string, string> }): string[] {
  const keys: string[] = [];
  for (const p of PROVIDERS) {
    const v = t.ids?.[p];
    if (isStr(v)) keys.push(`${t.type}|${p}|${v.toLowerCase()}`);
  }
  const n = normName(t.name);
  if (n) keys.push(`${t.type}|name|${n}|${t.year ?? ""}`);
  return keys;
}

/** The fields a change in which is worth syncing (not just "seen again"). */
function fingerprint(e: VaultEntry): string {
  const { seen: _seen, at: _at, ...rest } = e;
  return JSON.stringify(rest);
}

export interface ScanResult {
  state: VaultState;
  /** Something worth syncing changed. */
  changed: boolean;
  /** Titles this check found gone. */
  newlyMissing: VaultEntry[];
  /** Missing titles that came back. */
  returned: VaultEntry[];
  /** Titles the Vault didn't have before. */
  added: number;
  /** Administrators: titles to hide again (they were re-added without their tags). */
  reapply: { key: string; itemId: string; hiddenFrom: string[]; owner?: string }[];
}

export interface ScanOptions {
  /** The check could read tags (administrators): who each title is hidden from comes from the server. */
  tags?: boolean;
  /** Every user's short id (administrators), to hide a private title from users added since. */
  users?: string[];
}

/**
 * Folds a library check into the Vault: titles found are added or brought up to date (a
 * re-added title is recognised by its provider ids or name and year, and keeps its place),
 * and titles not found are marked missing from now on. Nothing is ever dropped here.
 */
export function applyScan(state: VaultState, titles: ScanTitle[], now = Date.now(), opts: ScanOptions = {}): ScanResult {
  const entries: Record<string, VaultEntry> = { ...state.entries };
  const removed = { ...state.removed };
  const byId = new Map<string, string>();
  const byMatch = new Map<string, string>();
  for (const [key, e] of Object.entries(entries)) {
    byId.set(e.id, key);
    for (const k of matchKeys(e)) if (!byMatch.has(k)) byMatch.set(k, key);
  }
  const claimed = new Set<string>();
  const result: ScanResult = { state: { entries, removed }, changed: false, newlyMissing: [], returned: [], reapply: [], added: 0 };

  for (const t of titles) {
    let key = byId.get(t.id);
    if (key && claimed.has(key)) key = undefined;
    let readded = false;
    if (!key) {
      for (const k of matchKeys(t)) {
        const found = byMatch.get(k);
        if (found && !claimed.has(found) && entries[found].type === t.type) {
          key = found;
          readded = entries[found].id !== t.id;
          break;
        }
      }
    }
    const before = key ? entries[key] : undefined;
    if (!key) {
      key = entries[t.id] ? `${t.id}-${now}` : t.id;
      // Back at the same path after being deleted in Argent (Jellyfin ids come from the path).
      delete removed[key];
    }
    claimed.add(key);

    const show = t.type === "Series";
    const perSeason = show ? (t.perSeason ?? {}) : undefined;
    const episodes = show ? total(perSeason) : undefined;
    let peak = before?.peak ?? before?.perSeason;
    let most = before?.most;
    if (show) {
      if (!before || before.resetPeak || !peak) {
        peak = undefined;
        most = episodes;
      } else {
        peak = { ...peak };
        for (const [s, n] of Object.entries(perSeason ?? {})) peak[s] = Math.max(peak[s] ?? 0, n);
        most = Math.max(most ?? 0, episodes ?? 0);
        // Kept only once a season has lost episodes.
        if (sameCounts(peak, perSeason ?? {})) peak = undefined;
      }
    }

    // Who it's hidden from: the server says, unless it was re-added and lost its tags.
    let hiddenFrom = before?.hiddenFrom;
    let owner = before?.owner;
    if (opts.tags) {
      const vis = visibilityOf(t.tags);
      const hadTags = Boolean(before?.hiddenFrom?.length || before?.owner);
      if (readded && hadTags && !vis.hiddenFrom.length && !vis.owner) {
        result.reapply.push({ key, itemId: t.id, hiddenFrom: before!.hiddenFrom ?? [], owner: before!.owner });
      } else {
        hiddenFrom = vis.hiddenFrom.length ? vis.hiddenFrom : undefined;
        owner = vis.owner;
        // Only its owner may see it: hide it from anyone added since.
        if (owner && opts.users) {
          const expected = opts.users.filter((u) => u !== owner).sort();
          if (expected.some((u) => !vis.hiddenFrom.includes(u))) result.reapply.push({ key, itemId: t.id, hiddenFrom: expected, owner });
        }
      }
    }

    const next: VaultEntry = {
      id: t.id,
      type: t.type,
      name: t.name,
      year: t.year,
      endYear: t.endYear,
      ids: t.ids && Object.keys(t.ids).length ? t.ids : undefined,
      genres: t.genres?.length ? t.genres.slice(0, 1) : undefined,
      // In the library since Jellyfin added it, at the latest.
      added: Math.min(before?.added ?? now, t.created && t.created < now ? t.created : now),
      seen: now,
      seasons: show ? Object.values(perSeason ?? {}).filter((n) => n > 0).length : undefined,
      episodes,
      most,
      perSeason,
      peak,
      watched: show ? t.watched : undefined,
      last: show ? (t.last ?? before?.last) : undefined,
      minutes: t.minutes,
      progress: t.progress,
      played: t.played,
      // A re-added title is a new item, so your score is still under the old one.
      rating: t.rating ?? (readded ? before?.rating : undefined),
      tag: t.tag,
      blur: t.blur ?? before?.blur,
      hidden: before?.hidden,
      hiddenFrom,
      owner,
      at: before?.at ?? now,
    };
    const clean = stripUndefined(next);
    if (before?.missing) result.returned.push(clean);
    if (!before) result.added++;
    if (!before || fingerprint(clean) !== fingerprint(before)) {
      clean.at = now;
      result.changed = true;
    }
    entries[key] = clean;
  }

  for (const [key, e] of Object.entries(entries)) {
    if (claimed.has(key) || e.missing) continue;
    entries[key] = { ...e, missing: now, at: now };
    result.newlyMissing.push(entries[key]);
    result.changed = true;
  }
  return result;
}

function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function stripUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

// ---- status -----------------------------------------------------------------------------------

export type VaultStatus = "library" | "missing" | "incomplete";

export function statusOf(e: VaultEntry): VaultStatus {
  if (e.missing) return "missing";
  if (e.type === "Series" && isNum(e.most) && isNum(e.episodes) && e.episodes < e.most) return "incomplete";
  return "library";
}

/** Seasons with fewer episodes than they once had: "Season 2: 5 of 12". */
export function shortSeasons(e: VaultEntry): { season: string; now: number; had: number }[] {
  if (e.type !== "Series" || !e.peak) return [];
  return Object.entries(e.peak)
    .map(([season, had]) => ({ season, had, now: e.perSeason?.[season] ?? 0 }))
    .filter((s) => s.now < s.had)
    .sort((a, b) => Number(a.season) - Number(b.season));
}

export const seasonLabel = (season: string) => (season === "0" ? "Specials" : `Season ${season}`);

// ---- user actions -----------------------------------------------------------------------------

export function setHidden(state: VaultState, key: string, hidden: boolean, now = Date.now()): VaultState {
  const e = state.entries[key];
  if (!e || Boolean(e.hidden) === hidden) return state;
  const next = { ...e, at: now };
  if (hidden) next.hidden = true;
  else delete next.hidden;
  return { ...state, entries: { ...state.entries, [key]: next } };
}

/** Takes titles out of the Vault for good (deleted in Argent, or forgotten from Hidden). */
export function forget(state: VaultState, keys: string[], now = Date.now()): VaultState {
  const present = keys.filter((k) => state.entries[k]);
  if (!present.length) return state;
  const entries = { ...state.entries };
  const removed = { ...state.removed };
  for (const k of present) {
    delete entries[k];
    removed[k] = now;
  }
  return { entries, removed };
}

/** The entry for a Jellyfin item, by its current id. */
export function keyOfItem(state: VaultState, itemId: string): string | undefined {
  if (state.entries[itemId]?.id === itemId) return itemId;
  return Object.keys(state.entries).find((k) => state.entries[k].id === itemId);
}

export function markResetPeak(state: VaultState, seriesIds: string[], now = Date.now()): VaultState {
  let next = state;
  for (const id of seriesIds) {
    const key = keyOfItem(next, id);
    if (!key || next.entries[key].resetPeak) continue;
    next = { ...next, entries: { ...next.entries, [key]: { ...next.entries[key], resetPeak: true, at: now } } };
  }
  return next;
}

export function setVisibility(state: VaultState, itemId: string, hiddenFrom: string[], owner: string | undefined, now = Date.now()): VaultState {
  const key = keyOfItem(state, itemId);
  if (!key) return state;
  const next: VaultEntry = { ...state.entries[key], at: now };
  if (hiddenFrom.length) next.hiddenFrom = [...hiddenFrom].sort();
  else delete next.hiddenFrom;
  if (owner) next.owner = owner;
  else delete next.owner;
  return { ...state, entries: { ...state.entries, [key]: next } };
}

/**
 * Imported titles count as missing until the next check finds them, so loading a list from
 * another server doesn't announce everything on it as gone.
 */
export function importInto(local: VaultState, incoming: VaultState, now = Date.now()): { state: VaultState; added: number } {
  const entries = { ...local.entries };
  let added = 0;
  for (const [key, e] of Object.entries(incoming.entries)) {
    if (entries[key]) {
      if (e.at > entries[key].at) entries[key] = { ...e, missing: entries[key].missing, added: Math.min(e.added, entries[key].added) };
      continue;
    }
    if (local.removed[key] && local.removed[key] >= e.at) continue;
    entries[key] = { ...e, missing: e.missing ?? now };
    added++;
  }
  return { state: { entries, removed: { ...local.removed } }, added };
}

// ---- storage and sync -------------------------------------------------------------------------

const TYPES: VaultType[] = ["Series", "Movie"];

function readNumMap(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (isNum(n) && n >= 0) out[k] = n;
  return out;
}

function readStrMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, s] of Object.entries(v)) if (isStr(s)) out[k] = s;
  return Object.keys(out).length ? out : undefined;
}

export function readEntry(value: unknown): VaultEntry | null {
  const v = value as Partial<VaultEntry> | null;
  if (!v || !isStr(v.id) || !isStr(v.name) || !TYPES.includes(v.type as VaultType) || !isNum(v.added) || !isNum(v.at)) return null;
  const last = v.last && isStr(v.last.code) && isNum(v.last.at) ? { code: v.last.code, name: isStr(v.last.name) ? v.last.name : undefined, at: v.last.at } : undefined;
  return stripUndefined({
    id: v.id,
    type: v.type as VaultType,
    name: v.name,
    year: isNum(v.year) ? v.year : undefined,
    endYear: isNum(v.endYear) ? v.endYear : undefined,
    ids: readStrMap(v.ids),
    genres: Array.isArray(v.genres) && v.genres.length ? v.genres.filter(isStr).slice(0, 1) : undefined,
    added: v.added,
    seen: isNum(v.seen) ? v.seen : v.added,
    missing: isNum(v.missing) ? v.missing : undefined,
    seasons: isNum(v.seasons) ? v.seasons : undefined,
    episodes: isNum(v.episodes) ? v.episodes : undefined,
    most: isNum(v.most) ? v.most : undefined,
    perSeason: readNumMap(v.perSeason),
    peak: readNumMap(v.peak),
    watched: isNum(v.watched) ? v.watched : undefined,
    last: last ? stripUndefined(last) : undefined,
    minutes: isNum(v.minutes) ? v.minutes : undefined,
    progress: isNum(v.progress) ? v.progress : undefined,
    played: v.played === true ? true : undefined,
    rating: isNum(v.rating) ? v.rating : undefined,
    tag: isStr(v.tag) ? v.tag : undefined,
    blur: isStr(v.blur) ? v.blur : undefined,
    hidden: v.hidden === true ? true : undefined,
    hiddenFrom: Array.isArray(v.hiddenFrom) && v.hiddenFrom.length ? v.hiddenFrom.filter(isStr) : undefined,
    owner: isStr(v.owner) ? v.owner : undefined,
    resetPeak: v.resetPeak === true ? true : undefined,
    at: v.at,
  });
}

/** Accepts whatever storage held, dropping anything malformed. */
export function normalise(raw: unknown): VaultState {
  const out = emptyVault();
  const r = raw as Partial<VaultState> | null;
  for (const [key, value] of Object.entries(r?.entries ?? {})) {
    const e = readEntry(value);
    if (e) out.entries[key] = e;
  }
  for (const [key, at] of Object.entries(r?.removed ?? {})) if (isNum(at) && !out.entries[key]) out.removed[key] = at;
  return out;
}

/** CustomPrefs key prefix in the user's Jellyfin DisplayPreferences. */
const ITEM = "v:";

export function toCustomPrefs(state: VaultState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, e] of Object.entries(state.entries)) out[ITEM + key] = JSON.stringify(e);
  for (const [key, at] of Object.entries(state.removed)) if (!state.entries[key]) out[ITEM + key] = JSON.stringify({ removedAt: at });
  return out;
}

/** Each title's latest change wins, whichever device made it. */
export function mergeCustomPrefs(local: VaultState, prefs: Record<string, string | null> | undefined): VaultState {
  const merged: VaultState = { entries: { ...local.entries }, removed: { ...local.removed } };
  for (const [k, raw] of Object.entries(prefs ?? {})) {
    if (!raw || !k.startsWith(ITEM)) continue;
    const key = k.slice(ITEM.length);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const mine = merged.entries[key];
    const localAt = Math.max(mine?.at ?? 0, merged.removed[key] ?? 0);
    const removedAt = (value as { removedAt?: unknown })?.removedAt;
    if (isNum(removedAt)) {
      if (removedAt > localAt) {
        delete merged.entries[key];
        merged.removed[key] = removedAt;
      }
      continue;
    }
    const entry = readEntry(value);
    if (entry && entry.at > localAt) {
      merged.entries[key] = mine ? { ...entry, added: Math.min(entry.added, mine.added) } : entry;
      delete merged.removed[key];
    }
  }
  return merged;
}

/** Tombstones older than this are dropped; every device has long since heard of them. */
const TOMBSTONE_DAYS = 180;

export function pruneRemoved(state: VaultState, now = Date.now()): VaultState {
  const cutoff = now - TOMBSTONE_DAYS * 86_400_000;
  const stale = Object.entries(state.removed).filter(([, at]) => at < cutoff);
  if (!stale.length) return state;
  const removed = { ...state.removed };
  for (const [k] of stale) delete removed[k];
  return { ...state, removed };
}

// ---- the list ---------------------------------------------------------------------------------

export type VaultFilter = "all" | "library" | "missing" | "incomplete" | "hidden" | "restricted";
export type VaultKind = "all" | VaultType;
export type VaultSort = "added" | "name" | "missing" | "size";

export interface VaultRow {
  key: string;
  entry: VaultEntry;
  status: VaultStatus;
}

export function rows(state: VaultState): VaultRow[] {
  return Object.entries(state.entries).map(([key, entry]) => ({ key, entry, status: statusOf(entry) }));
}

export function matchesFilter(row: VaultRow, filter: VaultFilter): boolean {
  if (filter === "hidden") return Boolean(row.entry.hidden);
  if (row.entry.hidden) return false;
  if (filter === "all") return true;
  if (filter === "library") return row.status !== "missing";
  if (filter === "restricted") return row.status !== "missing" && Boolean(row.entry.hiddenFrom?.length || row.entry.owner);
  return row.status === filter;
}

const sortName = (name: string) => name.replace(/^(the|a|an)\s+/i, "").toLowerCase();

export function filterRows(all: VaultRow[], opts: { filter: VaultFilter; kind: VaultKind; query: string; sort: VaultSort }): VaultRow[] {
  const q = normName(opts.query);
  const out = all.filter(
    (r) => matchesFilter(r, opts.filter) && (opts.kind === "all" || r.entry.type === opts.kind) && (!q || normName(r.entry.name).includes(q)),
  );
  const byName = (a: VaultRow, b: VaultRow) => sortName(a.entry.name).localeCompare(sortName(b.entry.name));
  const size = (e: VaultEntry) => (e.type === "Series" ? (e.most ?? e.episodes ?? 0) * 24 : (e.minutes ?? 0));
  const sorters: Record<VaultSort, (a: VaultRow, b: VaultRow) => number> = {
    added: (a, b) => b.entry.added - a.entry.added || byName(a, b),
    name: byName,
    // Gone most recently first, then incomplete, then the rest by name.
    missing: (a, b) => (b.entry.missing ?? 0) - (a.entry.missing ?? 0) || Number(b.status === "incomplete") - Number(a.status === "incomplete") || byName(a, b),
    size: (a, b) => size(b.entry) - size(a.entry) || byName(a, b),
  };
  return out.sort(sorters[opts.sort]);
}

export interface VaultStats {
  shows: number;
  movies: number;
  library: number;
  missing: number;
  incomplete: number;
  hidden: number;
  episodes: number;
  restricted: number;
}

export function statsOf(all: VaultRow[]): VaultStats {
  const s: VaultStats = { shows: 0, movies: 0, library: 0, missing: 0, incomplete: 0, hidden: 0, episodes: 0, restricted: 0 };
  for (const r of all) {
    if (r.entry.hidden) {
      s.hidden++;
      continue;
    }
    if (r.entry.type === "Series") s.shows++;
    else s.movies++;
    if (r.status === "missing") s.missing++;
    else {
      s.library++;
      s.episodes += r.entry.episodes ?? 0;
      if (r.entry.hiddenFrom?.length || r.entry.owner) s.restricted++;
    }
    if (r.status === "incomplete") s.incomplete++;
  }
  return s;
}

// ---- export -----------------------------------------------------------------------------------

export const EXPORT_KIND = "argent-vault";

export function toJson(state: VaultState, now = new Date()): string {
  return JSON.stringify({ kind: EXPORT_KIND, version: 1, exported: now.toISOString(), entries: state.entries }, null, 2);
}

/** Reads a file saved by Export (JSON). Null if it isn't one. */
export function parseImport(text: string): VaultState | null {
  try {
    const data = JSON.parse(text);
    if (data?.kind !== EXPORT_KIND || !data.entries || typeof data.entries !== "object") return null;
    const state = normalise({ entries: data.entries, removed: {} });
    return Object.keys(state.entries).length ? state : null;
  } catch {
    return null;
  }
}

const csvCell = (v: string | number | undefined) => {
  const s = v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const day = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

/** A spreadsheet-friendly list: one row per title. */
export function toCsv(all: VaultRow[]): string {
  const head = ["Title", "Type", "Year", "Status", "Episodes", "Most episodes", "Seasons", "Watched", "Your rating", "First seen", "Missing since", "TMDB", "TVDB", "IMDb", "AniList"];
  const lines = [head.join(",")];
  for (const { entry: e, status } of all) {
    lines.push(
      [
        e.name,
        e.type === "Series" ? "Show" : "Movie",
        e.year,
        status === "library" ? "In library" : status === "missing" ? "Missing" : "Incomplete",
        e.episodes,
        e.most,
        e.seasons,
        e.type === "Series" ? e.watched : e.played ? "Yes" : "",
        e.rating,
        day(e.added),
        day(e.missing),
        e.ids?.Tmdb,
        e.ids?.Tvdb,
        e.ids?.Imdb,
        e.ids?.AniList,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

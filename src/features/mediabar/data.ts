import { client, getItems, getMediaBarList, getViews } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import type { MediaBarConfig } from "./config";
import { applyStoredOrder, dedupe, hasLogo, interleave, mixTypesInHead, parseList, shuffle, type ListFilter } from "./logic";

const SLIDE_FIELDS = ["Overview", "Genres", "Taglines", "RemoteTrailers", "ChildCount", "LocalTrailerCount"];
const SLIDE_IMAGES = ["Backdrop", "Logo", "Primary"];

const slideQuery = {
  fields: SLIDE_FIELDS,
  enableImageTypes: SLIDE_IMAGES,
  enableUserData: true,
  enableTotalRecordCount: false,
};

export interface MediaBarData {
  items: BaseItem[];
  /** Library ids allowed to autoplay trailers; empty = all. */
  trailerLibraryIds: Set<string>;
  /** Title of the curated list, when one is in use. */
  listTitle?: string;
  startIndex: number;
}

type Library = { Id: string; Name: string };

async function resolveLibraries(names: string[], views: Library[]): Promise<Library[]> {
  const matched: Library[] = [];
  for (const name of names) {
    const wanted = name.trim().toLowerCase();
    const view = views.find((v) => (v.Name || "").toLowerCase() === wanted);
    if (view) matched.push(view);
    else console.warn(`MediaBar: no library named "${name}". Known libraries: ${views.map((v) => v.Name).join(", ")}`);
  }
  return matched;
}

async function fetchPage(types: string[], limit: number, library?: Library): Promise<BaseItem[]> {
  const { Items } = await getItems({
    includeItemTypes: types,
    recursive: true,
    hasOverview: true,
    imageTypes: ["Logo", "Backdrop"],
    sortBy: ["Random"],
    isPlayed: false,
    limit,
    parentId: library?.Id,
    ...slideQuery,
  });
  // Slides are built around logo art; items without one are dropped, as in the plugin.
  const withLogos = Items.filter(hasLogo);
  if (library) withLogos.forEach((i) => ((i as BaseItem & { LibraryId?: string }).LibraryId = library.Id));
  return withLogos;
}

async function fetchAcross(types: string[], limit: number, libraries: Library[]) {
  if (!libraries.length) return fetchPage(types, limit);
  const pages = await Promise.all(libraries.map((l) => fetchPage(types, limit, l)));
  return interleave(pages, limit);
}

async function fetchFromLibrary(config: MediaBarConfig, views: Library[]): Promise<BaseItem[]> {
  let libraries = await resolveLibraries(config.libraries, views);
  // Trailer libraries need LibraryId stamped on items, so query per library.
  if (!libraries.length && config.trailerLibraries.length) libraries = views;

  const movieQuota = Math.max(0, config.maxMovies);
  const seriesQuota = Math.max(0, config.maxSeries);
  if (!movieQuota && !seriesQuota) return fetchAcross(["Movie", "Series"], config.maxItems, libraries);

  const [movies, series] = await Promise.all([
    movieQuota ? fetchAcross(["Movie"], movieQuota, libraries) : Promise.resolve([]),
    seriesQuota ? fetchAcross(["Series"], seriesQuota, libraries) : Promise.resolve([]),
  ]);
  const merged = movies.concat(series);
  if (merged.length) return merged;
  console.warn("MediaBar: the configured quota matched no items; using the pooled query.");
  return fetchAcross(["Movie", "Series"], config.maxItems, libraries);
}

async function fetchByFilter(filter: ListFilter, limit: number): Promise<BaseItem[]> {
  const { Items } = await getItems({
    includeItemTypes: ["Movie", "Series"],
    recursive: true,
    sortBy: ["Random"],
    limit,
    [filter.param]: filter.value,
    ...slideQuery,
  });
  if (!Items.length) console.warn(`MediaBar: ${filter.key}:${filter.value} matched nothing.`);
  return Items;
}

async function fetchListed(ids: string[], filters: ListFilter[], limit: number): Promise<BaseItem[]> {
  const [byId, ...byFilter] = await Promise.all([
    ids.length ? getItems({ ids, recursive: true, ...slideQuery }).then((r) => r.Items) : Promise.resolve([]),
    ...filters.map((f) => fetchByFilter(f, limit).catch(() => [])),
  ]);
  // Keep the curated order for ids.
  const order = new Map(ids.map((id, i) => [id, i]));
  byId.sort((a, b) => (order.get(a.Id.replace(/-/g, "")) ?? 0) - (order.get(b.Id.replace(/-/g, "")) ?? 0));
  return dedupe(byId.concat(...byFilter));
}

async function readList(): Promise<ReturnType<typeof parseList> | null> {
  try {
    const text = await getMediaBarList();
    const parsed = parseList(text ?? "");
    parsed.ignored.forEach((line) =>
      console.warn(`MediaBar: ignoring list line "${line}". Expected an item id or one of genre, tag, studio, year, person, rating followed by ":".`),
    );
    return parsed;
  } catch {
    return null; // 404 = no curated list
  }
}

// ---- session order ----------------------------------------------------------------

const orderKey = () => `argent.mediabar.order.${client().userId}`;

export function persistIndex(index: number, config: MediaBarConfig) {
  if (!config.rememberOrderForSession) return;
  try {
    const stored = JSON.parse(sessionStorage.getItem(orderKey()) || "null");
    if (!stored?.ids) return;
    stored.index = index;
    sessionStorage.setItem(orderKey(), JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

function order(items: BaseItem[], config: MediaBarConfig): { items: BaseItem[]; startIndex: number } {
  const fresh = () => mixTypesInHead(shuffle(items), config.mixTypesInFirst);
  if (!config.rememberOrderForSession) return { items: fresh(), startIndex: 0 };
  try {
    const stored = JSON.parse(sessionStorage.getItem(orderKey()) || "null");
    if (Array.isArray(stored?.ids) && stored.ids.length) {
      const result = applyStoredOrder(items, stored.ids);
      if (result.length) {
        const startIndex = Math.min(Math.max(0, stored.index || 0), result.length - 1);
        sessionStorage.setItem(orderKey(), JSON.stringify({ ids: result.map((i) => i.Id), index: startIndex }));
        return { items: result, startIndex };
      }
    }
  } catch {
    /* ignore */
  }
  const shuffled = fresh();
  try {
    sessionStorage.setItem(orderKey(), JSON.stringify({ ids: shuffled.map((i) => i.Id), index: 0 }));
  } catch {
    /* ignore */
  }
  return { items: shuffled, startIndex: 0 };
}

// ---- entry point ------------------------------------------------------------------

export async function loadMediaBar(config: MediaBarConfig): Promise<MediaBarData> {
  const [list, viewsResult] = await Promise.all([readList(), getViews().catch(() => ({ Items: [] as BaseItem[] }))]);
  const views: Library[] = viewsResult.Items.map((v) => ({ Id: v.Id, Name: v.Name }));
  const trailerLibraries = config.trailerLibraries.length ? await resolveLibraries(config.trailerLibraries, views) : [];

  let items: BaseItem[] = [];
  const curated = Boolean(list && (list.ids.length || list.filters.length));
  if (curated && list) items = await fetchListed(list.ids, list.filters, config.maxItems);
  if (!items.length) {
    if (curated) console.warn("MediaBar: the curated list matched no items; using library items.");
    items = await fetchFromLibrary(config, views);
  }

  const ordered = order(items, config);
  return {
    items: ordered.items,
    startIndex: ordered.startIndex,
    trailerLibraryIds: new Set(trailerLibraries.map((l) => l.Id)),
    listTitle: curated ? list?.title : undefined,
  };
}

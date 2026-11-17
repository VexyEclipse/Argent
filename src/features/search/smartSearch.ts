// Runs a Smart Search against the server: names become people or studios, the rest
// becomes a library query, and what the server can't filter on (running time, several
// genres at once, anime or not) is filtered here.

import { CARD_FIELDS, client, getItems, getPersons, getSimilar, type ItemQuery } from "@/api/jellyfin";
import type { IndexEntry } from "@/api/libraryIndex";
import type { BaseItem, ItemsResult } from "@/api/types";
import { fuzzyFind, titleScore } from "./fuzzy";
import type { SmartQuery } from "./smart";

const TICKS_PER_MINUTE = 600_000_000;
const MAX_RESULTS = 120;

export interface SmartNotes {
  /** Who "with …" turned out to be; null when nobody in the library is called that. */
  person?: string | null;
  maker?: { name: string; as: "studio" | "person" } | null;
  /** The title "like …" was taken to mean; null when it isn't in the library. */
  like?: string | null;
  /** The title words matched despite a typo. */
  fuzzy?: boolean;
}

export interface SmartResult {
  items: BaseItem[];
  notes: SmartNotes;
}

interface Named {
  Id: string;
  Name: string;
}

/** The closest name, if it's close enough to be who was meant. */
function closest<T extends Named>(name: string, list: T[]): T | null {
  let best: { item: T; score: number } | null = null;
  for (const item of list) {
    const score = titleScore(name, item.Name);
    if (score >= 0.75 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

const findPerson = (name: string, signal?: AbortSignal) =>
  getPersons(name, 10, signal)
    .then((r) => closest(name, r.Items))
    .catch(() => null);

const findStudio = (name: string, signal?: AbortSignal) =>
  client()
    .request<ItemsResult>("/Studios", { query: { userId: client().userId, searchTerm: name, limit: 10 }, signal })
    .then((r) => closest(name, r.Items))
    .catch(() => null);

const exact = (a: string, b?: Named | null) => Boolean(b) && titleScore(a, b!.Name) === 1;

function sortFor(q: SmartQuery): Pick<ItemQuery, "sortBy" | "sortOrder"> {
  switch (q.sort) {
    case "rating":
      return { sortBy: ["CommunityRating", "SortName"], sortOrder: "Descending" };
    case "newest":
      return { sortBy: ["PremiereDate", "ProductionYear", "SortName"], sortOrder: "Descending" };
    case "oldest":
      return { sortBy: ["PremiereDate", "ProductionYear", "SortName"], sortOrder: "Ascending" };
    case "random":
      return { sortBy: ["Random"] };
    case "shortest":
      return { sortBy: ["Runtime", "SortName"], sortOrder: "Ascending" };
    default:
      // A title search keeps the server's best-match order; a browse leads with the best.
      return q.text ? {} : { sortBy: ["CommunityRating", "SortName"], sortOrder: "Descending" };
  }
}

/** What the server can't filter: running time, all the genres asked for, anime or not. */
function keep(q: SmartQuery, isAnime: (i: BaseItem) => boolean) {
  const anime = q.kinds.includes("Anime");
  const types = q.kinds.filter((k) => k !== "Anime");
  return (i: BaseItem) => {
    if (anime && (!isAnime(i) || (types.length && !types.includes(i.Type as "Movie" | "Series")))) return false;
    // Series means the other TV libraries, as everywhere else in Argent; Movies means all films.
    if (!anime && types.length && (!types.includes(i.Type as "Movie" | "Series") || (i.Type === "Series" && isAnime(i)))) return false;
    if (q.genres.length && !q.genres.every((group) => group.some((g) => i.Genres?.includes(g)))) return false;
    const minutes = i.RunTimeTicks ? i.RunTimeTicks / TICKS_PER_MINUTE : undefined;
    if (q.maxMinutes && (!minutes || minutes > q.maxMinutes)) return false;
    if (q.minMinutes && (!minutes || minutes < q.minMinutes)) return false;
    if (q.years) {
      const year = i.ProductionYear;
      if (!year || year < q.years.from || year > q.years.to) return false;
    }
    if (q.minRating && (i.CommunityRating ?? 0) < q.minRating) return false;
    if (q.played !== undefined && Boolean(i.UserData?.Played) !== q.played) return false;
    if (q.favorite && !i.UserData?.IsFavorite) return false;
    return true;
  };
}

export async function runSmartQuery(q: SmartQuery, ctx: { index?: IndexEntry[]; animeIds: Set<string> | null }, signal?: AbortSignal): Promise<SmartResult> {
  const notes: SmartNotes = {};
  // Without an anime library, anime is whatever the server calls Anime or Animation.
  const isAnime = (i: BaseItem) => (ctx.animeIds ? ctx.animeIds.has(i.Id) : Boolean(i.Genres?.some((g) => /^(anime|animation)$/i.test(g))));
  const filter = keep(q, isAnime);

  // "like Interstellar": what the server finds similar, narrowed by the rest.
  if (q.like) {
    const target = ctx.index ? fuzzyFind(q.like, ctx.index, { limit: 1, min: 0.7 })[0]?.entry : undefined;
    notes.like = target?.name ?? null;
    if (!target) return { items: [], notes };
    const similar = await getSimilar(target.id, 80);
    return { items: similar.Items.filter(filter).slice(0, MAX_RESULTS), notes };
  }

  const extraText: string[] = [];
  const [person, makerPerson, makerStudio] = await Promise.all([
    q.person ? findPerson(q.person, signal) : null,
    q.maker ? findPerson(q.maker, signal) : null,
    q.maker ? findStudio(q.maker, signal) : null,
  ]);
  const personIds: string[] = [];
  const studioIds: string[] = [];
  if (q.person) {
    notes.person = person?.Name ?? null;
    if (person) personIds.push(person.Id);
    else extraText.push(q.person);
  }
  if (q.maker) {
    const studioFirst = exact(q.maker, makerStudio) || (!exact(q.maker, makerPerson) && makerStudio);
    if (studioFirst && makerStudio) {
      studioIds.push(makerStudio.Id);
      notes.maker = { name: makerStudio.Name, as: "studio" };
    } else if (makerPerson) {
      personIds.push(makerPerson.Id);
      notes.maker = { name: makerPerson.Name, as: "person" };
    } else {
      notes.maker = null;
      extraText.push(q.maker);
    }
  }

  const types = q.kinds.length === 0 || q.kinds.includes("Anime") ? ["Movie", "Series"] : q.kinds.filter((k) => k !== "Anime");
  const span = q.years ? q.years.to - q.years.from + 1 : 0;
  const text = [q.text, ...extraText].filter(Boolean).join(" ");
  const base: ItemQuery = {
    includeItemTypes: types,
    recursive: true,
    fields: CARD_FIELDS,
    enableTotalRecordCount: false,
    limit: 300,
    genres: q.genres.length ? [...new Set(q.genres.flat())].join("|") : undefined,
    years: q.years && span <= 40 ? Array.from({ length: span }, (_, i) => q.years!.from + i).join(",") : undefined,
    minPremiereDate: q.years && span > 40 ? `${q.years.from}-01-01T00:00:00Z` : undefined,
    maxPremiereDate: q.years && span > 40 && q.years.to < 2100 ? `${q.years.to}-12-31T23:59:59Z` : undefined,
    minCommunityRating: q.minRating,
    isPlayed: q.played,
    isFavorite: q.favorite || undefined,
    personIds: personIds.length ? personIds : undefined,
    studioIds: studioIds.length ? studioIds.join(",") : undefined,
    ...sortFor(q),
  };

  let items = (await getItems({ ...base, searchTerm: text || undefined }, signal)).Items.filter(filter);
  // Nothing by those words: try the titles they're closest to ("batmn" → Batman).
  if (!items.length && q.text && ctx.index) {
    const near = fuzzyFind(q.text, ctx.index, { limit: 60, min: 0.7 }).map((r) => r.entry.id);
    if (near.length) {
      items = (await getItems({ ...base, ids: near }, signal)).Items.filter(filter);
      notes.fuzzy = items.length > 0;
    }
  }
  return { items: items.slice(0, MAX_RESULTS), notes };
}

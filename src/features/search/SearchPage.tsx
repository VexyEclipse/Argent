import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, client, getGenres, getItems } from "@/api/jellyfin";
import { personImage } from "@/api/images";
import { yearOf } from "@/api/format";
import { useLibraryGroups } from "@/api/libraries";
import { useLibraryIndex } from "@/api/libraryIndex";
import type { BaseItem, ItemsResult } from "@/api/types";
import { Icon } from "@/components/Icon";
import { CardSkeleton, MediaCard } from "@/components/MediaCard";
import { EmptyState } from "@/components/States";
import { fuzzyFind } from "./fuzzy";
import { isSmart, parseSmartQuery, type Chip, type SmartQuery } from "./smart";
import { runSmartQuery, type SmartNotes } from "./smartSearch";
import "./search.css";

type Filter = "all" | "Movie" | "Series" | "Episode" | "people" | "BoxSet" | "genres";
type Sort = "relevance" | "title" | "newest" | "oldest" | "rating";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["Movie", "Movies"],
  ["Series", "Series"],
  ["Episode", "Episodes"],
  ["people", "People"],
  ["BoxSet", "Collections"],
  ["genres", "Genres"],
];

const RECENT_KEY = "argent.recentSearches";

/** Shown before you type, to show what Smart Search understands. */
const SMART_EXAMPLES = ["90s comedies under 2 hours", "unwatched sci-fi films", "highly rated anime", "something like Interstellar", "series from HBO"];

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveRecent(term: string) {
  try {
    const next = [term, ...readRecent().filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

const persons = (searchTerm: string, personTypes: string[], signal: AbortSignal) =>
  client().request<ItemsResult>("/Persons", {
    query: { userId: client().userId, searchTerm, personTypes, limit: 30, enableImageTypes: ["Primary"], fields: ["PrimaryImageAspectRatio"] },
    signal,
  });

function sortItems(items: BaseItem[], sort: Sort): BaseItem[] {
  if (sort === "relevance") return items;
  const copy = [...items];
  if (sort === "title") copy.sort((a, b) => (a.SortName || a.Name).localeCompare(b.SortName || b.Name));
  if (sort === "newest") copy.sort((a, b) => (yearOf(b) ?? 0) - (yearOf(a) ?? 0));
  if (sort === "oldest") copy.sort((a, b) => (yearOf(a) ?? 9999) - (yearOf(b) ?? 9999));
  if (sort === "rating") copy.sort((a, b) => (b.CommunityRating ?? 0) - (a.CommunityRating ?? 0));
  return copy;
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get("q") ?? "");
  const term = (params.get("q") ?? "").trim();
  const filter = (params.get("type") as Filter) || "all";
  const sort = (params.get("sort") as Sort) || "relevance";
  const input = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState(readRecent);

  // autoFocus alone doesn't survive a client-side navigation into the page.
  useEffect(() => {
    input.current?.focus();
  }, []);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (draft.trim() !== term) set({ q: draft.trim() || null });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => {
    if (term.length < 2) return;
    const t = window.setTimeout(() => {
      saveRecent(term);
      setRecent(readRecent());
    }, 1500);
    return () => window.clearTimeout(t);
  }, [term]);

  const enabled = term.length >= 2;
  const itemTypes = filter === "all" ? ["Movie", "Series", "Episode", "BoxSet"] : ["Movie", "Series", "Episode", "BoxSet"].includes(filter) ? [filter] : [];

  // Each request is cancelled when the term changes (React Query passes the signal).
  const items = useQuery<BaseItem[]>({
    queryKey: ["search", "items", term, itemTypes],
    queryFn: ({ signal }) =>
      getItems(
        {
          searchTerm: term,
          includeItemTypes: itemTypes,
          recursive: true,
          limit: filter === "all" ? 72 : 150,
          fields: CARD_FIELDS,
          enableTotalRecordCount: false,
        },
        signal,
      ).then((r) => r.Items),
    enabled: enabled && itemTypes.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const people = useQuery({
    queryKey: ["search", "people", term],
    queryFn: async ({ signal }) => {
      const [actors, directors] = await Promise.all([persons(term, ["Actor", "GuestStar"], signal), persons(term, ["Director", "Writer"], signal)]);
      return { actors: actors.Items, directors: directors.Items };
    },
    enabled: enabled && (filter === "all" || filter === "people"),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const genres = useQuery({
    queryKey: ["search", "genres"],
    queryFn: () => getGenres({ includeItemTypes: ["Movie", "Series"] }).then((r) => r.Items),
    staleTime: 30 * 60_000,
  });

  // Smart Search: "90s comedies under 2 hours", "anime from MAPPA", "like Interstellar".
  const genreNames = useMemo(() => (genres.data ?? []).map((g) => g.Name), [genres.data]);
  const smart = useMemo<SmartQuery>(() => {
    const q = parseSmartQuery(term, { genres: genreNames });
    // The Movies or Series filter narrows a smart search too.
    if ((filter === "Movie" || filter === "Series") && !q.kinds.length) q.kinds = [filter];
    return q;
  }, [term, genreNames, filter]);
  const smartOn = enabled && isSmart(smart) && (filter === "all" || filter === "Movie" || filter === "Series");
  const groups = useLibraryGroups();
  const index = useLibraryIndex(enabled);
  const animeIds = useMemo(
    () => (groups.anime.length && index.data ? new Set(index.data.filter((e) => e.anime).map((e) => e.id)) : null),
    [groups.anime.length, index.data],
  );
  const needsIndex = Boolean(smart.like || smart.kinds.includes("Anime") || smart.text);
  const smartResults = useQuery({
    queryKey: ["search", "smart", JSON.stringify({ ...smart, chips: undefined }), animeIds?.size ?? 0],
    queryFn: ({ signal }) => runSmartQuery(smart, { index: index.data, animeIds }, signal),
    enabled: smartOn && (!needsIndex || !index.isPending),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const matchedGenres = useMemo(() => {
    const all = genres.data ?? [];
    // Idle suggestions: proper genres only (lowercase entries are imported tags).
    if (!enabled) return all.filter((g) => /^\p{Lu}/u.test(g.Name)).slice(0, 24);
    const t = term.toLowerCase();
    return all.filter((g) => g.Name.toLowerCase().includes(t));
  }, [genres.data, term, enabled]);

  const byType = useMemo(() => {
    const list = sortItems(items.data ?? [], sort);
    return {
      Movie: list.filter((i) => i.Type === "Movie"),
      Series: list.filter((i) => i.Type === "Series"),
      Episode: list.filter((i) => i.Type === "Episode"),
      BoxSet: list.filter((i) => i.Type === "BoxSet"),
    };
  }, [items.data, sort]);

  // Close matches despite a typo ("frieran"), when the server found few films or series.
  const titleCount = byType.Movie.length + byType.Series.length;
  const fuzzyIds = useMemo(() => {
    if (!enabled || smartOn || !index.data || items.isPending || titleCount >= 4) return [];
    if (filter !== "all" && filter !== "Movie" && filter !== "Series") return [];
    const have = new Set((items.data ?? []).map((i) => i.Id));
    return fuzzyFind(term, index.data, { limit: 18 })
      .filter((r) => !have.has(r.entry.id) && (filter === "all" || r.entry.type === filter))
      .map((r) => r.entry.id);
  }, [enabled, smartOn, index.data, items.isPending, items.data, titleCount, filter, term]);
  const fuzzy = useQuery({
    queryKey: ["search", "fuzzy", fuzzyIds],
    queryFn: () =>
      getItems({ ids: fuzzyIds, fields: CARD_FIELDS, enableTotalRecordCount: false }).then((r) => {
        const order = new Map(fuzzyIds.map((id, i) => [id, i]));
        return r.Items.sort((a, b) => (order.get(a.Id) ?? 0) - (order.get(b.Id) ?? 0));
      }),
    enabled: fuzzyIds.length > 0,
    staleTime: 60_000,
  });
  const closeMatches = fuzzyIds.length ? (fuzzy.data ?? []) : [];

  // Removing a chip removes the words that asked for it.
  const removeChip = (c: Chip) => setDraft((term.slice(0, c.span[0]) + term.slice(c.span[1])).replace(/\s+/g, " ").trim());

  const loading = enabled && !smartOn && (items.isPending || people.isPending) && !items.data;
  const nothing =
    enabled &&
    !smartOn &&
    !loading &&
    !items.isFetching &&
    !people.isFetching &&
    !fuzzy.isFetching &&
    !(items.data?.length ?? 0) &&
    !closeMatches.length &&
    !(people.data?.actors.length ?? 0) &&
    !(people.data?.directors.length ?? 0) &&
    !matchedGenres.length;

  const show = (f: Filter) => filter === "all" || filter === f;

  return (
    <div className="page search">
      <div className="search__bar">
        <Icon name="search" size={24} />
        <input
          ref={input}
          className="search__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Titles, people, or try “90s comedies under 2 hours”"
          autoFocus
          data-autofocus
          aria-label="Search"
          enterKeyHint="search"
        />
        {draft && (
          <button
            className="search__clear"
            onClick={() => {
              setDraft("");
              input.current?.focus();
            }}
            aria-label="Clear search"
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      <div className="search__controls">
        <div className="search__filters" data-nav-row>
          {FILTERS.map(([v, label]) => (
            <button key={v} className={`chip ${filter === v ? "is-active" : ""}`} onClick={() => set({ type: v === "all" ? null : v })}>
              {label}
            </button>
          ))}
        </div>
        {enabled && filter !== "people" && filter !== "genres" && (
          <select
            className="select select--compact"
            value={sort}
            onChange={(e) => set({ sort: e.target.value === "relevance" ? null : e.target.value })}
            aria-label="Sort results"
          >
            <option value="relevance">Best match</option>
            <option value="title">Title</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="rating">Rating</option>
          </select>
        )}
      </div>

      {!enabled && (
        <div className="search__idle fade-in">
          <section>
            <h2 className="search__heading">
              <Icon name="sparkle" size={18} /> Try asking
            </h2>
            <div className="search__chips" data-nav-row>
              {SMART_EXAMPLES.map((r) => (
                <button key={r} className="chip" onClick={() => setDraft(r)}>
                  {r}
                </button>
              ))}
            </div>
          </section>
          {recent.length > 0 && (
            <section>
              <h2 className="search__heading">Recent</h2>
              <div className="search__chips">
                {recent.map((r) => (
                  <button key={r} className="chip" onClick={() => setDraft(r)}>
                    {r}
                  </button>
                ))}
              </div>
            </section>
          )}
          {matchedGenres.length > 0 && (
            <section>
              <h2 className="search__heading">Browse by genre</h2>
              <div className="search__chips">
                {matchedGenres.map((g) => (
                  <Link key={g.Id} to={`/genre/${g.Id}`} className="chip">
                    {g.Name}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {loading && (
        <div className="grid">
          {Array.from({ length: 12 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {nothing && <EmptyState title={`No results for “${term}”`} body="Try another spelling, or search for an actor or genre." />}

      {smartOn && (
        <SmartSection
          query={smart}
          notes={smartResults.data?.notes}
          items={smartResults.data?.items}
          loading={smartResults.isPending}
          stale={smartResults.isPlaceholderData}
          onRemove={removeChip}
          sort={sort}
        />
      )}

      {enabled && !loading && (
        <div className={`search__results ${items.isPlaceholderData ? "is-stale" : ""}`}>
          {smartOn && titleCount > 0 && <h2 className="search__heading search__subhead">Titles matching “{term}”</h2>}
          {!smartOn && show("genres") && matchedGenres.length > 0 && (
            <section className="search__section">
              <h2 className="search__heading">Genres</h2>
              <div className="search__chips">
                {matchedGenres.map((g) => (
                  <Link key={g.Id} to={`/genre/${g.Id}`} className="chip">
                    {g.Name}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {show("Movie") && byType.Movie.length > 0 && <ResultGrid title="Movies" items={byType.Movie} />}
          {show("Series") && byType.Series.length > 0 && <ResultGrid title="Series" items={byType.Series} />}
          {closeMatches.length > 0 && (
            <ResultGrid title={titleCount ? "Close matches" : `Close matches for “${term}”`} items={closeMatches} count={false} />
          )}
          {!smartOn && show("people") && (people.data?.actors.length ?? 0) > 0 && <PeopleRow title="Actors" people={people.data!.actors} />}
          {!smartOn && show("people") && (people.data?.directors.length ?? 0) > 0 && (
            <PeopleRow title="Directors & Writers" people={people.data!.directors} />
          )}
          {!smartOn && show("BoxSet") && byType.BoxSet.length > 0 && <ResultGrid title="Collections" items={byType.BoxSet} />}
          {!smartOn && show("Episode") && byType.Episode.length > 0 && <ResultGrid title="Episodes" items={byType.Episode} landscape />}
        </div>
      )}
    </div>
  );
}

function ResultGrid({ title, items, landscape, count = true }: { title: string; items: BaseItem[]; landscape?: boolean; count?: boolean }) {
  return (
    <section className="search__section">
      <h2 className="search__heading">
        {title} {count && <span className="search__count">{items.length}</span>}
      </h2>
      <div className={`grid ${landscape ? "grid--landscape" : ""}`}>
        {items.map((i) => (
          <MediaCard key={i.Id} item={i} variant={landscape ? "landscape" : "poster"} />
        ))}
      </div>
    </section>
  );
}

function PeopleRow({ title, people }: { title: string; people: BaseItem[] }) {
  return (
    <section className="search__section">
      <h2 className="search__heading">
        {title} <span className="search__count">{people.length}</span>
      </h2>
      <div className="search__people">
        {people.map((p) => {
          const img = personImage({ Id: p.Id, PrimaryImageTag: p.ImageTags?.Primary }, 200);
          return (
            <Link key={p.Id} to={`/person/${p.Id}`} className="person__link search__person">
              <div className="person__photo">{img ? <img src={img} alt="" loading="lazy" /> : <span>{p.Name.slice(0, 1)}</span>}</div>
              <span className="person__name">{p.Name}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** What a smart search understood, as chips you can remove, and what it found. */
function SmartSection({
  query,
  notes,
  items,
  loading,
  stale,
  onRemove,
  sort,
}: {
  query: SmartQuery;
  notes?: SmartNotes;
  items?: BaseItem[];
  loading: boolean;
  stale: boolean;
  onRemove: (c: Chip) => void;
  sort: Sort;
}) {
  const list = useMemo(() => (sort === "relevance" ? (items ?? []) : sortItems(items ?? [], sort)), [items, sort]);
  const movies = list.filter((i) => i.Type === "Movie");
  const series = list.filter((i) => i.Type === "Series");
  const same = (a?: string | null, b?: string) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
  const lines: string[] = [];
  if (notes?.like === null) lines.push(`“${query.like}” isn't in your library, so there's nothing to compare with.`);
  if (notes?.like && !same(notes.like, query.like)) lines.push(`Comparing with ${notes.like}.`);
  if (notes?.person === null) lines.push(`Nobody called “${query.person}” is in your library, so it's searched as a title.`);
  if (notes?.person && !same(notes.person, query.person)) lines.push(`With ${notes.person}.`);
  if (notes?.maker === null) lines.push(`No studio or person called “${query.maker}” is in your library, so it's searched as a title.`);
  if (notes?.maker && !same(notes.maker.name, query.maker)) lines.push(`From ${notes.maker.name}.`);
  if (notes?.fuzzy) lines.push(`Nothing is called “${query.text}”, so these are the closest titles.`);

  return (
    <section className={`smart fade-in ${stale ? "is-stale" : ""}`} aria-label="Smart search">
      <div className="smart__head">
        <span className="smart__label">
          <Icon name="sparkle" size={16} /> Smart search
        </span>
        <div className="smart__chips" data-nav-row>
          {query.chips.map((c) => (
            <button key={`${c.key}-${c.span[0]}`} className="chip is-active smart__chip" onClick={() => onRemove(c)} title="Remove">
              {c.label}
              <Icon name="close" size={14} />
            </button>
          ))}
          {query.text && <span className="chip smart__words">“{query.text}”</span>}
        </div>
      </div>
      {lines.length > 0 && <p className="smart__note">{lines.join(" ")}</p>}
      {loading ? (
        <div className="grid">
          {Array.from({ length: 12 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : list.length ? (
        <>
          {movies.length > 0 && <ResultGrid title="Movies" items={movies} />}
          {series.length > 0 && <ResultGrid title="Series" items={series} />}
        </>
      ) : (
        <EmptyState title="Nothing in your library fits all of that" body="Remove a filter above, or try different words." />
      )}
    </section>
  );
}

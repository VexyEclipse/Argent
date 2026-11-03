import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, client, getGenres, getItems } from "@/api/jellyfin";
import { personImage } from "@/api/images";
import { yearOf } from "@/api/format";
import type { BaseItem, ItemsResult } from "@/api/types";
import { Icon } from "@/components/Icon";
import { CardSkeleton, MediaCard } from "@/components/MediaCard";
import { EmptyState } from "@/components/States";
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
    queryKey: ["search", "genres", term],
    queryFn: () => getGenres({ includeItemTypes: ["Movie", "Series"] }).then((r) => r.Items),
    enabled: filter === "all" || filter === "genres" || !enabled,
    staleTime: 30 * 60_000,
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

  const loading = enabled && (items.isPending || people.isPending) && !items.data;
  const nothing =
    enabled &&
    !loading &&
    !items.isFetching &&
    !people.isFetching &&
    !(items.data?.length ?? 0) &&
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
          placeholder="Movies, series, episodes, people, genres…"
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

      {enabled && !loading && (
        <div className={`search__results ${items.isPlaceholderData ? "is-stale" : ""}`}>
          {show("genres") && matchedGenres.length > 0 && (
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
          {show("people") && (people.data?.actors.length ?? 0) > 0 && <PeopleRow title="Actors" people={people.data!.actors} />}
          {show("people") && (people.data?.directors.length ?? 0) > 0 && <PeopleRow title="Directors & Writers" people={people.data!.directors} />}
          {show("BoxSet") && byType.BoxSet.length > 0 && <ResultGrid title="Collections" items={byType.BoxSet} />}
          {show("Episode") && byType.Episode.length > 0 && <ResultGrid title="Episodes" items={byType.Episode} landscape />}
        </div>
      )}
    </div>
  );
}

function ResultGrid({ title, items, landscape }: { title: string; items: BaseItem[]; landscape?: boolean }) {
  return (
    <section className="search__section">
      <h2 className="search__heading">
        {title} <span className="search__count">{items.length}</span>
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

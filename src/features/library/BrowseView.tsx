import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItems, getLegacyFilters, type ItemQuery } from "@/api/jellyfin";
import { Icon } from "@/components/Icon";
import { CardSkeleton, MediaCard } from "@/components/MediaCard";
import { EmptyState, ErrorState, Spinner } from "@/components/States";
import { usePlatform } from "@/platform/platform";
import "./library.css";

const PAGE = 60;
const LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export interface SortOption {
  value: string;
  label: string;
  sortBy: string[];
  defaultOrder: "Ascending" | "Descending";
}

export const SORTS: Record<string, SortOption> = {
  name: { value: "name", label: "Title", sortBy: ["SortName"], defaultOrder: "Ascending" },
  added: { value: "added", label: "Date added", sortBy: ["DateCreated", "SortName"], defaultOrder: "Descending" },
  released: { value: "released", label: "Release date", sortBy: ["PremiereDate", "ProductionYear", "SortName"], defaultOrder: "Descending" },
  rating: { value: "rating", label: "Rating", sortBy: ["CommunityRating", "SortName"], defaultOrder: "Descending" },
  critics: { value: "critics", label: "Critics", sortBy: ["CriticRating", "SortName"], defaultOrder: "Descending" },
  runtime: { value: "runtime", label: "Runtime", sortBy: ["Runtime", "SortName"], defaultOrder: "Ascending" },
  played: { value: "played", label: "Last watched", sortBy: ["DatePlayed", "SortName"], defaultOrder: "Descending" },
  updated: { value: "updated", label: "Recently updated", sortBy: ["DateLastContentAdded", "SortName"], defaultOrder: "Descending" },
  random: { value: "random", label: "Shuffle", sortBy: ["Random"], defaultOrder: "Ascending" },
};

type Density = "compact" | "comfortable" | "large";
const DENSITY_KEY = "argent.density";

function readDensity(): Density {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    if (v === "compact" || v === "comfortable" || v === "large") return v;
  } catch {
    /* ignore */
  }
  return "comfortable";
}

interface Props {
  title: string;
  /** Base query (types, parent, genre…). Filters from the toolbar are layered on top. */
  base: ItemQuery;
  sorts: string[];
  defaultSort?: string;
  /** Extra controls rendered above the toolbar (e.g. library tabs). */
  header?: ReactNode;
  showWatchedFilter?: boolean;
  showGenreFilter?: boolean;
  showYearFilter?: boolean;
  queryKey: unknown[];
}

function decadeYears(decade: number): string {
  return Array.from({ length: 10 }, (_, i) => decade + i).join(",");
}

export function BrowseView({
  title,
  base,
  sorts,
  defaultSort = "name",
  header,
  showWatchedFilter = true,
  showGenreFilter = true,
  showYearFilter = true,
  queryKey,
}: Props) {
  const platform = usePlatform();
  const [params, setParams] = useSearchParams();
  const [density, setDensity] = useState<Density>(readDensity);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(params.get("q") ?? "");

  const sortKey = sorts.includes(params.get("sort") ?? "") ? params.get("sort")! : defaultSort;
  const sort = SORTS[sortKey];
  const order = (params.get("order") as "Ascending" | "Descending") || sort.defaultOrder;
  const watched = params.get("watched") ?? "all";
  const favourites = params.get("fav") === "1";
  const genres = params.get("genres")?.split("|").filter(Boolean) ?? [];
  const decade = params.get("decade");
  const letter = params.get("letter");
  const q = params.get("q") ?? "";

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // Debounce the text filter so typing doesn't fire a request per key.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (searchDraft !== q) update({ q: searchDraft || null });
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  useEffect(() => {
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      /* ignore */
    }
  }, [density]);

  const filters = useQuery({
    queryKey: ["filters", ...queryKey],
    queryFn: () => getLegacyFilters({ parentId: base.parentId, includeItemTypes: base.includeItemTypes }),
    staleTime: 10 * 60_000,
    enabled: showGenreFilter || showYearFilter,
  });

  const decades = useMemo(() => {
    const years = filters.data?.Years ?? [];
    return [...new Set(years.map((y) => Math.floor(y / 10) * 10))].sort((a, b) => b - a);
  }, [filters.data]);

  const query: ItemQuery = {
    recursive: true,
    fields: CARD_FIELDS,
    ...base,
    sortBy: sort.sortBy,
    sortOrder: order,
    isPlayed: watched === "unwatched" ? false : watched === "watched" ? true : undefined,
    isFavorite: favourites || undefined,
    genres: genres.length ? genres.join("|") : undefined,
    years: decade ? decadeYears(Number(decade)) : undefined,
    searchTerm: q || undefined,
    nameStartsWith: letter && letter !== "#" ? letter : undefined,
    nameLessThan: letter === "#" ? "A" : undefined,
  };

  const items = useInfiniteQuery({
    queryKey: ["browse", ...queryKey, query],
    queryFn: ({ pageParam, signal }) => getItems({ ...query, startIndex: pageParam, limit: PAGE, enableTotalRecordCount: true }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.Items.length, 0);
      return loaded < last.TotalRecordCount && last.Items.length === PAGE ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  });

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && items.hasNextPage && !items.isFetchingNextPage) items.fetchNextPage();
      },
      { rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items]);

  const all = items.data?.pages.flatMap((p) => p.Items) ?? [];
  const total = items.data?.pages[0]?.TotalRecordCount;
  const activeFilterCount = (watched !== "all" ? 1 : 0) + (favourites ? 1 : 0) + genres.length + (decade ? 1 : 0);
  const showLetters = sortKey === "name" && platform !== "mobile" && !q;

  return (
    <div className="page browse" data-density={density}>
      <header className="page-header browse__header">
        <div>
          <h1 className="page-title">{title}</h1>
          {total !== undefined && (
            <p className="browse__count">
              {total.toLocaleString()} {total === 1 ? "title" : "titles"}
            </p>
          )}
        </div>
        {header}
      </header>

      <div className="toolbar">
        <label className="toolbar__search">
          <Icon name="search" size={17} />
          <input
            className="toolbar__input"
            placeholder={`Filter ${title.toLowerCase()}`}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            aria-label="Filter by title"
          />
        </label>

        <label className="toolbar__sort">
          <span className="sr-only">Sort by</span>
          <select
            className="select select--compact"
            value={sortKey}
            onChange={(e) => update({ sort: e.target.value === defaultSort ? null : e.target.value, order: null, letter: null })}
          >
            {sorts.map((s) => (
              <option key={s} value={s}>
                {SORTS[s].label}
              </option>
            ))}
          </select>
        </label>
        {sortKey !== "random" && (
          <button
            className="btn btn--icon btn--sm toolbar__order"
            onClick={() => update({ order: order === "Ascending" ? "Descending" : "Ascending" })}
            aria-label={order === "Ascending" ? "Ascending" : "Descending"}
            title={order === "Ascending" ? "Ascending" : "Descending"}
          >
            <Icon name="chevronDown" size={16} className={order === "Ascending" ? "flip" : ""} />
          </button>
        )}

        <button className={`chip ${filtersOpen || activeFilterCount ? "is-active" : ""}`} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
          <Icon name="sliders" size={16} />
          Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
        </button>

        <div className="toolbar__density" role="radiogroup" aria-label="Poster size">
          {(["compact", "comfortable", "large"] as Density[]).map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={density === d}
              className={density === d ? "is-active" : ""}
              onClick={() => setDensity(d)}
              aria-label={`${d} posters`}
              title={`${d[0].toUpperCase()}${d.slice(1)}`}
            >
              <span className={`density-glyph density-glyph--${d}`} />
            </button>
          ))}
        </div>
      </div>

      {filtersOpen && (
        <div className="filters fade-in">
          {showWatchedFilter && (
            <div className="filters__group">
              <span className="filters__label">Status</span>
              <div className="filters__chips">
                {[
                  ["all", "All"],
                  ["unwatched", "Unwatched"],
                  ["watched", "Watched"],
                ].map(([v, label]) => (
                  <button key={v} className={`chip ${watched === v ? "is-active" : ""}`} onClick={() => update({ watched: v === "all" ? null : v })}>
                    {label}
                  </button>
                ))}
                <button className={`chip ${favourites ? "is-active" : ""}`} onClick={() => update({ fav: favourites ? null : "1" })}>
                  <Icon name={favourites ? "heartFilled" : "heart"} size={14} /> Favourites
                </button>
              </div>
            </div>
          )}
          {showYearFilter && decades.length > 0 && (
            <div className="filters__group">
              <span className="filters__label">Decade</span>
              <div className="filters__chips">
                {decades.map((d) => (
                  <button
                    key={d}
                    className={`chip ${decade === String(d) ? "is-active" : ""}`}
                    onClick={() => update({ decade: decade === String(d) ? null : String(d) })}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          )}
          {showGenreFilter && (filters.data?.Genres?.length ?? 0) > 0 && (
            <div className="filters__group">
              <span className="filters__label">Genres</span>
              <div className="filters__chips">
                {filters.data!.Genres!.map((g) => {
                  const on = genres.includes(g);
                  return (
                    <button
                      key={g}
                      className={`chip ${on ? "is-active" : ""}`}
                      onClick={() => update({ genres: (on ? genres.filter((x) => x !== g) : [...genres, g]).join("|") || null })}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {activeFilterCount > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={() => update({ watched: null, fav: null, genres: null, decade: null })}>
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className={`browse__body ${showLetters ? "has-letters" : ""}`}>
        {showLetters && (
          <nav className="letters" aria-label="Jump to letter">
            <button className={!letter ? "is-active" : ""} onClick={() => update({ letter: null })}>
              All
            </button>
            {LETTERS.map((l) => (
              <button key={l} className={letter === l ? "is-active" : ""} onClick={() => update({ letter: letter === l ? null : l })}>
                {l}
              </button>
            ))}
          </nav>
        )}

        <div className="browse__results">
          {items.isError ? (
            <ErrorState error={items.error} onRetry={() => items.refetch()} />
          ) : items.isPending ? (
            <div className="grid">
              {Array.from({ length: 24 }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : all.length === 0 ? (
            <EmptyState title="Nothing here" body={activeFilterCount || q || letter ? "No titles match these filters." : "This library is empty."} />
          ) : (
            <div className={`grid ${items.isPlaceholderData ? "is-stale" : ""}`}>
              {all.map((item, i) => (
                <MediaCard key={item.Id} item={item} eager={i < 18} />
              ))}
            </div>
          )}
          <div ref={sentinel} className="browse__sentinel">
            {items.isFetchingNextPage && <Spinner />}
          </div>
        </div>
      </div>
    </div>
  );
}

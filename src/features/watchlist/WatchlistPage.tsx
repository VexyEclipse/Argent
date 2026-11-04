import { useState } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { CardSkeleton, MediaCard } from "@/components/MediaCard";
import { EmptyState, ErrorState } from "@/components/States";
import { removeFromWatchlist } from "./store";
import { isFinished, useWatchlistItems } from "./useWatchlistItems";
import "./watchlist.css";

type Filter = "all" | "Movie" | "Series";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["Movie", "Movies"],
  ["Series", "Series"],
];

export default function WatchlistPage() {
  const { user } = useAuth();
  const items = useWatchlistItems();
  const [filter, setFilter] = useState<Filter>("all");

  const shown = (items.data ?? []).filter((i) => filter === "all" || i.Type === filter);
  const toWatch = shown.filter((i) => !isFinished(i));
  const watched = shown.filter(isFinished);

  const clearWatched = () => {
    if (!user) return;
    for (const item of watched) removeFromWatchlist(user.Id, item.Id);
  };

  return (
    <div className="page watchlist">
      <header className="page-header">
        <div>
          <h1 className="page-title">Watchlist</h1>
          {items.count > 0 && (
            <p className="browse__count">
              {items.count.toLocaleString()} {items.count === 1 ? "title" : "titles"}
            </p>
          )}
        </div>
      </header>

      {items.count === 0 ? (
        <EmptyState
          title="Nothing on your watchlist yet"
          body="Save films and shows for later with the bookmark button on any poster or details page. Your list follows you to every device."
          action={
            <Link to="/movies" className="btn btn--secondary btn--md">
              <span className="btn__label">Browse movies</span>
            </Link>
          }
        />
      ) : items.isError ? (
        <ErrorState error={items.error} onRetry={() => items.refetch()} />
      ) : (
        <>
          <div className="watchlist__filters" role="tablist" aria-label="Filter watchlist" data-nav-row>
            {FILTERS.map(([value, label]) => (
              <button key={value} role="tab" aria-selected={filter === value} className={`chip ${filter === value ? "is-active" : ""}`} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>

          {items.isPending ? (
            <div className="grid">
              {Array.from({ length: Math.min(items.count, 12) }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : toWatch.length ? (
            <div className="grid">
              {toWatch.map((item) => (
                <MediaCard key={item.Id} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted watchlist__done">You've watched everything here{filter === "all" ? "" : ` in ${filter === "Movie" ? "movies" : "series"}`}.</p>
          )}

          {watched.length > 0 && (
            <section className="watchlist__watched">
              <header className="watchlist__watched-head">
                <h2 className="row__title">Watched</h2>
                <Button variant="ghost" size="sm" onClick={clearWatched}>
                  Remove watched
                </Button>
              </header>
              <div className="grid">
                {watched.map((item) => (
                  <MediaCard key={item.Id} item={item} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

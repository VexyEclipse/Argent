import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItems } from "@/api/jellyfin";
import { posterImage } from "@/api/images";
import { useLibraryGroups } from "@/api/libraries";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { MediaCard } from "@/components/MediaCard";
import { Row } from "@/components/Row";
import { EmptyState, Spinner } from "@/components/States";
import { ratingStats, sortRatings, type RatingEntry, type RatingSort } from "@/features/ratings/logic";
import { RateDialog } from "@/features/ratings/RatePrompt";
import { readRatings, subscribeRatings } from "@/features/ratings/store";
import { copyImage, renderTopRated, saveImage } from "./exportImage";
import { fetchAnimeIds, fetchWatchStats, type WatchStats } from "./watchStats";

type Filter = "all" | "movies" | "series" | "anime";

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const fmtInt = (n: number) => n.toLocaleString();

async function fetchByIds(ids: string[]): Promise<Map<string, BaseItem>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 80) chunks.push(ids.slice(i, i + 80));
  const results = await Promise.all(chunks.map((chunk) => getItems({ ids: chunk, fields: CARD_FIELDS })));
  return new Map(results.flatMap((r) => r.Items.map((i) => [i.Id, i] as const)));
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="mp-stat">
      <span className="mp-stat__label">{label}</span>
      <span className="mp-stat__value">{value}</span>
      {sub && <span className="mp-stat__sub">{sub}</span>}
    </div>
  );
}

function WatchStatsPanel({ stats, hasAnime, rated }: { stats: WatchStats | undefined; hasAnime: boolean; rated: ReturnType<typeof ratingStats> }) {
  if (!stats) {
    return (
      <section className="panel mp-panel mp-panel--loading">
        <Spinner label="Loading your stats" />
      </section>
    );
  }
  const maxGenre = stats.topGenres[0]?.hours || 1;
  return (
    <section className="panel mp-panel" aria-label="Watch stats">
      <div className="mp-stats">
        <Stat label="Hours watched" value={`≈ ${fmtInt(Math.round(stats.hours))}`} sub={`${(stats.hours / 24).toFixed(1)} days of screen time`} />
        <Stat label="Movies" value={fmtInt(stats.movies)} sub={`${fmtInt(Math.round(stats.movieHours))} h`} />
        <Stat label="Series" value={fmtInt(stats.seriesFinished)} sub={`finished · ${fmtInt(stats.seriesStarted)} started`} />
        <Stat label="Episodes" value={fmtInt(stats.episodes)} sub={`${fmtInt(Math.round(stats.episodeHours))} h`} />
        {hasAnime && (
          <Stat
            label="Anime"
            value={fmtInt(stats.anime.titles)}
            sub={`titles · ${fmtInt(stats.anime.episodes)} eps · ${fmtInt(Math.round(stats.anime.hours))} h`}
          />
        )}
        <Stat label="This year" value={fmtInt(stats.thisYear)} sub="titles watched" />
        <Stat label="Rewatches" value={fmtInt(stats.rewatches)} sub="extra plays" />
        <Stat label="Rated" value={fmtInt(rated.count)} sub={rated.count ? `average ${rated.average.toFixed(1)} / 10` : "nothing yet"} />
      </div>
      <div className="mp-panel__split">
        <div>
          <h3 className="mp-subtitle">Top genres</h3>
          {stats.topGenres.length ? (
            <ul className="mp-bars">
              {stats.topGenres.map((g) => (
                <li key={g.name}>
                  <span className="mp-bars__label">{g.name}</span>
                  <span className="mp-bars__track">
                    <span style={{ width: `${(g.hours / maxGenre) * 100}%` }} />
                  </span>
                  <span className="mp-bars__value">{Math.round(g.hours)} h</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mp-muted">Watch something to see your genres.</p>
          )}
        </div>
        <div>
          <h3 className="mp-subtitle">Your scores</h3>
          <div className="mp-dist" aria-label="How often you give each score">
            {rated.distribution.map((n, i) => (
              <div key={i} className="mp-dist__col" title={`${n} × ${i + 1}/10`}>
                <span className="mp-dist__bar" style={{ height: `${(n / Math.max(1, ...rated.distribution)) * 100}%` }} />
                <span className="mp-dist__n">{i + 1}</span>
              </div>
            ))}
          </div>
          {stats.mostWatched && (
            <p className="mp-muted mp-most">
              Most watched:{" "}
              <Link to={`/details/${stats.mostWatched.id}`} className="mp-link">
                {stats.mostWatched.name}
              </Link>{" "}
              · {stats.mostWatched.episodes} episodes · {Math.round(stats.mostWatched.hours)} h
            </p>
          )}
        </div>
      </div>
      <p className="mp-footnote">Watch time is estimated from runtime × play count.</p>
    </section>
  );
}

const EXPORT_COUNTS = [5, 10, 20] as const;

function ExportDialog({
  entries,
  items,
  userName,
  onClose,
}: {
  entries: [string, RatingEntry][];
  items: Map<string, BaseItem>;
  userName: string;
  onClose: () => void;
}) {
  // Only offer sizes you have enough ratings for; 10 by default.
  const options = EXPORT_COUNTS.filter((_, i) => i === 0 || entries.length > EXPORT_COUNTS[i - 1]);
  const [count, setCount] = useState<number>(() => Math.min(10, options[options.length - 1]));
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBlob(null);
    const top = entries.slice(0, count).map(([id, e]) => {
      const item = items.get(id);
      return { name: e.name, stars: e.stars, year: item?.ProductionYear, poster: item ? posterImage(item, 480)?.url : undefined };
    });
    renderTopRated({
      title: `${userName}'s highest rated`,
      subtitle: `Top ${top.length} · ${fmtDate(Date.now())}`,
      entries: top,
    })
      .then((b) => !cancelled && setBlob(b))
      .catch(() => !cancelled && setStatus("Couldn't render the image"));
    return () => {
      cancelled = true;
    };
  }, [count, entries, items, userName]);

  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    if (!blob) return;
    try {
      await copyImage(blob);
      setStatus("Copied to clipboard");
    } catch {
      setStatus("Your browser blocked clipboard access. Use Save instead.");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-label="Export highest rated" data-nav-trap>
      <div className="modal mp-export" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2 className="modal__title">Export highest rated</h2>
          <Button variant="icon" icon="close" aria-label="Close" onClick={onClose} />
        </header>
        <div className="tabs mp-export__count" role="radiogroup" aria-label="How many">
          {options.map((n) => (
            <button key={n} role="radio" aria-checked={count === n} className={count === n ? "is-active" : ""} onClick={() => setCount(n)}>
              Top {n}
            </button>
          ))}
        </div>
        <div className="mp-export__preview">{url ? <img src={url} alt="Preview of the exported image" /> : <Spinner label="Rendering" />}</div>
        <div className="mp-export__actions">
          <span className="mp-muted" aria-live="polite">
            {status}
          </span>
          <Button variant="secondary" icon="copy" disabled={!blob} onClick={copy}>
            Copy image
          </Button>
          <Button variant="primary" icon="download" disabled={!blob} onClick={() => blob && saveImage(blob, `argent-top-${count}.png`)}>
            Save PNG
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MediaProfile() {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  const state = useSyncExternalStore(subscribeRatings, () => readRatings(userId));
  const groups = useLibraryGroups();
  const animeLibIds = groups.anime.map((l) => l.Id);

  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<RatingSort>("stars");
  const [search, setSearch] = useState("");
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const all = useMemo(() => Object.entries(state.ratings), [state.ratings]);
  const ids = useMemo(() => all.map(([id]) => id).sort(), [all]);

  const items = useQuery({
    queryKey: ["ratings", "items", ids.join(",")],
    queryFn: () => fetchByIds(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const animeIds = useQuery({
    queryKey: ["anime-ids", animeLibIds.join(",")],
    queryFn: () => fetchAnimeIds(animeLibIds),
    enabled: !groups.isPending,
    staleTime: 10 * 60_000,
  });
  const watch = useQuery({
    queryKey: ["watch-stats", userId, animeLibIds.join(",")],
    queryFn: () => fetchWatchStats(animeIds.data!),
    enabled: Boolean(userId && animeIds.data),
    staleTime: 5 * 60_000,
  });

  const byId = items.data ?? new Map<string, BaseItem>();
  const anime = animeIds.data ?? new Set<string>();
  const hasAnime = animeLibIds.length > 0;
  const rated = ratingStats(all.map(([, e]) => e));
  const top = useMemo(() => sortRatings(all, "stars"), [all]);

  const q = search.trim().toLowerCase();
  const visible = sortRatings(all, sort).filter(([id, e]) => {
    if (filter === "anime" && !anime.has(id)) return false;
    if (filter === "movies" && (e.type !== "Movie" || (hasAnime && anime.has(id)))) return false;
    if (filter === "series" && (e.type !== "Series" || (hasAnime && anime.has(id)))) return false;
    return !q || e.name.toLowerCase().includes(q) || Boolean(e.note?.toLowerCase().includes(q));
  });

  const toggleNote = (id: string) =>
    setOpenNotes((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const editEntry = editing ? state.ratings[editing] : undefined;

  return (
    <div className="mp">
      <WatchStatsPanel stats={watch.data} hasAnime={hasAnime} rated={rated} />

      {all.length === 0 ? (
        <EmptyState title="No ratings yet" body="Finish a movie or a whole series and Argent will ask what you thought. Your scores and notes collect here." />
      ) : (
        <>
          <Row
            title="Highest rated"
            eyebrow="Your top 10"
            loading={items.isPending}
            className="mp-top"
            actions={
              <Button variant="secondary" size="sm" icon="image" onClick={() => setExporting(true)} disabled={!items.data}>
                Export image
              </Button>
            }
          >
            {top.slice(0, 10).map(([id, e]) => {
              const item = byId.get(id);
              return item ? <MediaCard key={id} item={item} rating={e.stars} showProgress={false} caption={e.note} /> : null;
            })}
          </Row>

          <section className="mp-all">
            <header className="mp-all__header">
              <h2 className="row__title">All ratings</h2>
              <div className="mp-all__tools">
                <div className="tabs" role="radiogroup" aria-label="Filter">
                  {([["all", "All"], ["movies", "Movies"], ["series", "Series"], ...(hasAnime ? [["anime", "Anime"]] : [])] as [Filter, string][]).map(
                    ([v, l]) => (
                      <button key={v} role="radio" aria-checked={filter === v} className={filter === v ? "is-active" : ""} onClick={() => setFilter(v)}>
                        {l}
                      </button>
                    ),
                  )}
                </div>
                <input
                  className="input mp-search"
                  type="search"
                  placeholder="Search titles and notes"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search ratings"
                />
                <select className="select select--compact" value={sort} onChange={(e) => setSort(e.target.value as RatingSort)} aria-label="Sort">
                  <option value="stars">Highest score</option>
                  <option value="recent">Recently rated</option>
                  <option value="title">Title</option>
                </select>
              </div>
            </header>

            {visible.length === 0 ? (
              <p className="mp-muted mp-none">Nothing matches.</p>
            ) : (
              <ul className="mp-list">
                {visible.map(([id, e]) => {
                  const item = byId.get(id);
                  const open = openNotes.has(id);
                  return (
                    <li key={id} className="mp-entry">
                      <Link to={`/details/${id}`} className="mp-entry__poster" tabIndex={-1} aria-hidden="true">
                        <Artwork image={item ? posterImage(item, 160) : null} fallbackLabel={e.name} />
                      </Link>
                      <div className="mp-entry__body">
                        <div className="mp-entry__top">
                          <Link to={`/details/${id}`} className="mp-entry__title">
                            {e.name}
                          </Link>
                          <span className="mp-entry__score" aria-label={`${e.stars} out of 10`}>
                            <Icon name="star" size={16} />
                            {e.stars}
                            <span>/10</span>
                          </span>
                        </div>
                        <div className="mp-entry__meta">
                          {[item?.ProductionYear, anime.has(id) ? "Anime" : e.type === "Series" ? "Series" : "Movie", `Rated ${fmtDate(e.ratedAt)}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        {e.note ? (
                          <button className={`mp-entry__note ${open ? "is-open" : ""}`} aria-expanded={open} onClick={() => toggleNote(id)}>
                            {e.note}
                          </button>
                        ) : (
                          <span className="mp-entry__nonote">No note</span>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(id)} aria-label={`Edit rating for ${e.name}`}>
                        Edit
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {editing && editEntry && (
        <RateDialog target={{ id: editing, name: editEntry.name, type: editEntry.type }} initial={editEntry} onClose={() => setEditing(null)} />
      )}
      {exporting && items.data && <ExportDialog entries={top} items={items.data} userName={user?.Name ?? "My"} onClose={() => setExporting(false)} />}
    </div>
  );
}

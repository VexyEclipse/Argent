import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItems } from "@/api/jellyfin";
import { backdropImage, posterImage } from "@/api/images";
import { useLibraryGroups } from "@/api/libraries";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { MediaCard } from "@/components/MediaCard";
import { Row } from "@/components/Row";
import { EmptyState, Spinner } from "@/components/States";
import { MAX_SHOWCASE, isTitle, ratingStats, sortRatings, type RateTarget, type RatingEntry, type RatingSort } from "@/features/ratings/logic";
import { useRatings } from "@/features/ratings/prefs";
import { useRateDialog } from "@/features/ratings/RatePrompt";
import { importRatings, togglePinned } from "@/features/ratings/store";
import { download, fromJson, matchRows, rowsFromCsv, toCsv, toJson } from "@/features/ratings/transfer";
import { ExportDialog } from "./ExportDialog";
import { tasteInsights, type TasteInsights } from "./insights";
import { computeWatchStats, fetchAnimeIds, fetchWatchData, ratingBacklog, reviewYears, type WatchStats } from "./watchStats";
import { YearInReview } from "./YearInReview";
import { TopOrderDialog } from "./TopOrderDialog";
import "./media-profile.css";

type Filter = "all" | "movies" | "series" | "anime" | "seasons";

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const fmtInt = (n: number) => n.toLocaleString();
const RATED_FIELDS = [...CARD_FIELDS, "People", "ProviderIds"];

async function fetchByIds(ids: string[]): Promise<Map<string, BaseItem>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 80) chunks.push(ids.slice(i, i + 80));
  const results = await Promise.all(chunks.map((chunk) => getItems({ ids: chunk, fields: RATED_FIELDS })));
  return new Map(results.flatMap((r) => r.Items.map((i) => [i.Id, i] as const)));
}

const targetOf = (id: string, e: RatingEntry): RateTarget => ({ id, name: e.name, type: e.type, seriesId: e.seriesId, seasonNumber: e.seasonNumber });
const linkOf = (id: string, e: RatingEntry) => (e.type === "Season" && e.seriesId ? `/details/${e.seriesId}?season=${id}` : `/details/${id}`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="mp-stat">
      <span className="mp-stat__label">{label}</span>
      <span className="mp-stat__value">{value}</span>
      {sub && <span className="mp-stat__sub">{sub}</span>}
    </div>
  );
}

// ---- Showcase ---------------------------------------------------------------------

function Showcase({ ids, items, ratings }: { ids: string[]; items: Map<string, BaseItem>; ratings: Record<string, RatingEntry> }) {
  const pinned = ids.filter((id) => ratings[id]);
  if (!pinned.length) return null;
  const lead = items.get(pinned[0]);
  const backdrop = lead ? backdropImage(lead, 1600) : null;
  return (
    <section className="mp-showcase" aria-label="Showcase">
      {backdrop && <img className="mp-showcase__bg" src={backdrop.url} alt="" aria-hidden="true" />}
      <div className="mp-showcase__inner">
        <div className="mp-showcase__text">
          <span className="eyebrow">Showcase</span>
          <h2 className="mp-showcase__title">All-time favourites</h2>
        </div>
        <div className="mp-showcase__grid" data-nav-row>
          {pinned.map((id) => {
            const e = ratings[id];
            const item = items.get(id);
            return (
              <Link key={id} to={linkOf(id, e)} className="mp-showcase__pick">
                <Artwork image={item ? posterImage(item, 400) : null} fallbackLabel={e.name} />
                <span className="mp-showcase__score">
                  <Icon name="star" size={13} /> {e.stars}
                </span>
                <span className="mp-showcase__name">{e.name}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---- Stats ------------------------------------------------------------------------

function WatchStatsPanel({
  stats,
  hasAnime,
  rated,
  reviewYear,
  onReview,
}: {
  stats: WatchStats | undefined;
  hasAnime: boolean;
  rated: ReturnType<typeof ratingStats>;
  reviewYear?: number;
  onReview: () => void;
}) {
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
      {reviewYear && (
        <button className="mp-review" onClick={onReview}>
          <Icon name="sparkle" size={20} />
          <span className="mp-review__text">
            <strong>Your {reviewYear} in review</strong>
            <span className="mp-muted">Hours, genres, your binge and your best, as a story</span>
          </span>
          <Icon name="chevronRight" size={18} className="mp-review__go" />
        </button>
      )}
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

// ---- Taste ------------------------------------------------------------------------

function InsightsPanel({ insights }: { insights: TasteInsights }) {
  const { genres, people, hotTakes } = insights;
  if (!genres.length && !people.length && !hotTakes.length) return null;
  const shownGenres = genres.length > 6 ? [...genres.slice(0, 4), ...genres.slice(-2)] : genres;
  return (
    <section className="panel mp-panel mp-insights" aria-label="Your taste">
      <h2 className="row__title">Your taste</h2>
      <div className="mp-insights__grid">
        {shownGenres.length > 0 && (
          <div>
            <h3 className="mp-subtitle">Score by genre</h3>
            <ul className="mp-bars">
              {shownGenres.map((g) => (
                <li key={g.name}>
                  <span className="mp-bars__label">{g.name}</span>
                  <span className="mp-bars__track">
                    <span style={{ width: `${g.average * 10}%` }} />
                  </span>
                  <span className="mp-bars__value">{g.average.toFixed(1)}</span>
                </li>
              ))}
            </ul>
            <p className="mp-footnote">Genres with two or more ratings.</p>
          </div>
        )}
        {people.length > 0 && (
          <div>
            <h3 className="mp-subtitle">People you keep rating</h3>
            <ul className="mp-people">
              {people.map((p) => (
                <li key={p.id}>
                  <Link to={`/person/${p.id}`} className="mp-link">
                    {p.name}
                  </Link>
                  <span className="mp-muted">
                    {p.role} · {p.count} titles · avg {p.average.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {hotTakes.length > 0 && (
          <div>
            <h3 className="mp-subtitle">Hot takes</h3>
            <ul className="mp-people">
              {hotTakes.map((h) => (
                <li key={h.id}>
                  <Link to={`/details/${h.id}`} className="mp-link">
                    {h.name}
                  </Link>
                  <span className="mp-muted">
                    You {h.mine} · everyone {h.community.toFixed(1)}{" "}
                    <span className={`mp-diff ${h.diff > 0 ? "is-up" : "is-down"}`}>
                      {h.diff > 0 ? "+" : ""}
                      {h.diff.toFixed(1)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

// ---- Backup -----------------------------------------------------------------------

function BackupPanel({ userId, entries, items }: { userId: string; entries: [string, RatingEntry][]; items: Map<string, BaseItem> }) {
  const ratings = useRatings();
  const file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const day = new Date().toISOString().slice(0, 10);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUnmatched([]);
    const text = await f.text();
    const json = fromJson(text);
    if (json) {
      const changed = importRatings(userId, json);
      setStatus(`Imported ${changed} rating${changed === 1 ? "" : "s"} from your backup.`);
      return;
    }
    const rows = rowsFromCsv(text);
    if (!rows.length) {
      setStatus("That file has no ratings Argent can read. Use an Argent backup or a CSV with Title and Rating columns.");
      return;
    }
    setBusy(true);
    setStatus(`Matching 0 of ${rows.length} against your library…`);
    try {
      const result = await matchRows(rows, (done) => setStatus(`Matching ${done} of ${rows.length} against your library…`));
      const changed = importRatings(userId, result.state);
      const kept = result.matched - changed;
      const missing = result.unmatched.length;
      setStatus(
        [
          `Imported ${changed} of ${rows.length}.`,
          kept ? `${kept} already had a newer rating here.` : "",
          missing ? `${missing} ${missing === 1 ? "isn't" : "aren't"} in your library:` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      setUnmatched(result.unmatched);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel mp-panel mp-backup" aria-label="Backup and import">
      <div>
        <h3 className="mp-subtitle">Backup &amp; import</h3>
        <p className="mp-muted">
          A JSON backup keeps everything. The CSV works with Letterboxd's importer (films only there). Import either one, or a Letterboxd export (ratings.csv,
          reviews.csv or diary.csv).
        </p>
      </div>
      <div className="mp-backup__actions">
        <Button
          variant="secondary"
          size="sm"
          icon="download"
          disabled={!entries.length}
          onClick={() => download(toJson(ratings), `argent-ratings-${day}.json`, "application/json")}
        >
          JSON backup
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon="download"
          disabled={!entries.length}
          onClick={() => download(toCsv(entries, items), `argent-ratings-${day}.csv`, "text/csv")}
        >
          CSV (Letterboxd)
        </Button>
        <Button variant="secondary" size="sm" icon="upload" disabled={busy} onClick={() => file.current?.click()}>
          Import…
        </Button>
        <input
          ref={file}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {status && (
        <p className="mp-backup__status" aria-live="polite">
          {status}
        </p>
      )}
      {unmatched.length > 0 && (
        <p className="mp-muted mp-backup__unmatched">
          {unmatched.slice(0, 30).join(" · ") + (unmatched.length > 30 ? ` · +${unmatched.length - 30} more` : "")}
        </p>
      )}
    </section>
  );
}

// ---- One rating -------------------------------------------------------------------

function RatingRow({
  id,
  entry: e,
  item,
  isAnime,
  pinned,
  canPin,
  onEdit,
  onPin,
}: {
  id: string;
  entry: RatingEntry;
  item?: BaseItem;
  isAnime: boolean;
  pinned: boolean;
  canPin: boolean;
  onEdit: () => void;
  onPin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [diary, setDiary] = useState(false);
  const hidden = e.spoiler && !revealed;
  const kind = e.type === "Season" ? "Season" : isAnime ? "Anime" : e.type;
  return (
    <li className="mp-entry">
      <Link to={linkOf(id, e)} className="mp-entry__poster" tabIndex={-1} aria-hidden="true">
        <Artwork image={item ? posterImage(item, 160) : null} fallbackLabel={e.name} />
      </Link>
      <div className="mp-entry__body">
        <div className="mp-entry__top">
          <Link to={linkOf(id, e)} className="mp-entry__title">
            {e.name}
          </Link>
          <span className="mp-entry__score" aria-label={`${e.stars} out of 10`}>
            <Icon name="star" size={16} />
            {e.stars}
            <span>/10</span>
          </span>
        </div>
        <div className="mp-entry__meta">
          {[e.type !== "Season" ? item?.ProductionYear : undefined, kind, `Rated ${fmtDate(e.ratedAt)}`].filter(Boolean).join(" · ")}
        </div>
        {e.tags?.length ? (
          <div className="mp-entry__tags">
            {e.tags.map((t) => (
              <span key={t} className="mp-tag">
                {t}
              </span>
            ))}
          </div>
        ) : null}
        {e.note ? (
          hidden ? (
            <button className="mp-entry__note is-spoiler" onClick={() => setRevealed(true)} aria-label="Spoiler. Show note">
              <span className="mp-entry__blur" aria-hidden="true">
                {e.note}
              </span>
              <span className="mp-entry__reveal">
                <Icon name="eye" size={14} /> Spoiler · show
              </span>
            </button>
          ) : (
            <button className={`mp-entry__note ${open ? "is-open" : ""}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {e.note}
            </button>
          )
        ) : (
          <span className="mp-entry__nonote">No note</span>
        )}
        {e.history?.length ? (
          <div className="mp-diary">
            <button className="mp-diary__toggle" aria-expanded={diary} onClick={() => setDiary((v) => !v)}>
              Diary ·{" "}
              {[...e.history]
                .reverse()
                .map((h) => h.stars)
                .join(" → ")}{" "}
              → {e.stars}
            </button>
            {diary && (
              <ol className="mp-diary__list">
                <li>
                  <strong>{e.stars}/10</strong> <span className="mp-muted">{fmtDate(e.ratedAt)} (now)</span>
                </li>
                {e.history.map((h) => (
                  <li key={h.ratedAt}>
                    <strong>{h.stars}/10</strong> <span className="mp-muted">{fmtDate(h.ratedAt)}</span>
                    {h.note && <p className="mp-diary__note">{h.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </div>
      <div className="mp-entry__actions">
        {isTitle(e) && (
          <Button
            variant="icon"
            size="sm"
            icon="pin"
            active={pinned}
            disabled={!pinned && !canPin}
            onClick={onPin}
            aria-label={pinned ? `Unpin ${e.name} from your showcase` : `Pin ${e.name} to your showcase`}
            title={pinned ? "Pinned to showcase" : canPin ? "Pin to showcase" : `Showcase holds ${MAX_SHOWCASE}`}
          />
        )}
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit rating for ${e.name}`}>
          Edit
        </Button>
      </div>
    </li>
  );
}

// ---- Page -------------------------------------------------------------------------

export function MediaProfile() {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  const state = useRatings();
  const groups = useLibraryGroups();
  const animeLibIds = groups.anime.map((l) => l.Id);
  const rateDialog = useRateDialog();

  const [filter, setFilter] = useState<Filter>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<RatingSort>("stars");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reviewing, setReviewing] = useState(false);

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
  const watch = useQuery({ queryKey: ["watch-data", userId], queryFn: fetchWatchData, enabled: Boolean(userId), staleTime: 5 * 60_000 });

  const byId = useMemo(() => items.data ?? new Map<string, BaseItem>(), [items.data]);
  const anime = animeIds.data ?? new Set<string>();
  const hasAnime = animeLibIds.length > 0;
  const stats = useMemo(
    () => (watch.data && animeIds.data ? computeWatchStats({ ...watch.data, animeIds: animeIds.data }) : undefined),
    [watch.data, animeIds.data],
  );
  const backlog = useMemo(() => (watch.data ? ratingBacklog(watch.data, state.ratings) : []), [watch.data, state.ratings]);
  const years = useMemo(() => (watch.data ? reviewYears(watch.data) : []), [watch.data]);
  const titles = useMemo(() => all.filter(([, e]) => isTitle(e)), [all]);
  const rated = ratingStats(titles.map(([, e]) => e));
  const top = useMemo(() => sortRatings(titles, "stars", state.order.ids), [titles, state.order.ids]);
  const [ordering, setOrdering] = useState(false);
  const insights = useMemo(() => tasteInsights(all, byId), [all, byId]);
  const hasSeasons = all.length > titles.length;
  const pinned = state.showcase.ids.filter((id) => state.ratings[id]);

  const q = search.trim().toLowerCase();
  const visible = sortRatings(all, sort, state.order.ids).filter(([id, e]) => {
    const isAnime = anime.has(id) || Boolean(e.seriesId && anime.has(e.seriesId));
    if (filter === "anime" && !isAnime) return false;
    if (filter === "movies" && (e.type !== "Movie" || (hasAnime && isAnime))) return false;
    if (filter === "series" && (e.type !== "Series" || (hasAnime && isAnime))) return false;
    if (filter === "seasons" && e.type !== "Season") return false;
    if (tag && !e.tags?.includes(tag)) return false;
    return !q || e.name.toLowerCase().includes(q) || Boolean(e.note?.toLowerCase().includes(q)) || Boolean(e.tags?.some((t) => t.toLowerCase().includes(q)));
  });

  const filters: [Filter, string][] = [
    ["all", "All"],
    ["movies", "Movies"],
    ["series", "Series"],
    ...(hasAnime ? [["anime", "Anime"] as [Filter, string]] : []),
    ...(hasSeasons ? [["seasons", "Seasons"] as [Filter, string]] : []),
  ];

  return (
    <div className="mp">
      <Showcase ids={state.showcase.ids} items={byId} ratings={state.ratings} />

      <WatchStatsPanel stats={stats} hasAnime={hasAnime} rated={rated} reviewYear={years[0]} onReview={() => setReviewing(true)} />

      {backlog.length > 0 && (
        <Row title="To rate" eyebrow={`${backlog.length}${backlog.length === 30 ? "+" : ""} watched, not rated yet`} className="mp-top">
          {backlog.map((item) => (
            <div key={item.Id} className="mp-todo">
              <button
                className="mp-todo__poster"
                onClick={() => rateDialog.open({ id: item.Id, name: item.Name, type: item.Type === "Series" ? "Series" : "Movie" })}
                aria-label={`Rate ${item.Name}`}
              >
                <Artwork image={posterImage(item, 300)} fallbackLabel={item.Name} />
                <span className="mp-todo__cta">
                  <Icon name="star" size={16} /> Rate
                </span>
              </button>
              <span className="mp-todo__title">{item.Name}</span>
              <span className="mp-todo__sub">{[item.ProductionYear, item.Type === "Series" ? "Series" : "Movie"].filter(Boolean).join(" · ")}</span>
            </div>
          ))}
        </Row>
      )}

      {all.length === 0 ? (
        <EmptyState
          title="No ratings yet"
          body="Finish a movie, a season or a whole series and Argent will ask what you thought. Your scores and notes collect here."
        />
      ) : (
        <>
          {top.length > 0 && (
            <Row
              title="Highest rated"
              eyebrow="Your top 10"
              loading={items.isPending}
              className="mp-top"
              actions={
                <>
                  <Button variant="secondary" size="sm" icon="list" onClick={() => setOrdering(true)} disabled={top.length < 2}>
                    Edit order
                  </Button>
                  <Button variant="secondary" size="sm" icon="image" onClick={() => setExporting(true)} disabled={!items.data}>
                    Export image
                  </Button>
                </>
              }
            >
              {top.slice(0, 10).map(([id, e]) => {
                const item = byId.get(id);
                return item ? <MediaCard key={id} item={item} rating={e.stars} showProgress={false} caption={e.spoiler ? undefined : e.note} /> : null;
              })}
            </Row>
          )}

          <InsightsPanel insights={insights} />

          <section className="mp-all">
            <header className="mp-all__header">
              <h2 className="row__title">All ratings</h2>
              <div className="mp-all__tools">
                <div className="tabs" role="radiogroup" aria-label="Filter">
                  {filters.map(([v, l]) => (
                    <button key={v} role="radio" aria-checked={filter === v} className={filter === v ? "is-active" : ""} onClick={() => setFilter(v)}>
                      {l}
                    </button>
                  ))}
                </div>
                <input
                  className="input mp-search"
                  type="search"
                  placeholder="Search titles, notes and tags"
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
            {insights.tags.length > 0 && (
              <div className="mp-tagfilter" role="group" aria-label="Filter by tag">
                {insights.tags.map(({ tag: t, count }) => (
                  <button key={t} className={`chip ${tag === t ? "is-active" : ""}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                    {t} <span className="mp-tagfilter__n">{count}</span>
                  </button>
                ))}
              </div>
            )}

            {visible.length === 0 ? (
              <p className="mp-muted mp-none">Nothing matches.</p>
            ) : (
              <ul className="mp-list">
                {visible.map(([id, e]) => (
                  <RatingRow
                    key={id}
                    id={id}
                    entry={e}
                    item={byId.get(id)}
                    isAnime={anime.has(id) || Boolean(e.seriesId && anime.has(e.seriesId))}
                    pinned={pinned.includes(id)}
                    canPin={pinned.length < MAX_SHOWCASE}
                    onEdit={() => rateDialog.open(targetOf(id, e))}
                    onPin={() => togglePinned(userId, id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <BackupPanel userId={userId} entries={all} items={byId} />

      {rateDialog.dialog}
      {ordering && <TopOrderDialog userId={userId} ranked={top} items={byId} onClose={() => setOrdering(false)} />}
      {exporting && items.data && <ExportDialog entries={top} items={items.data} userName={user?.Name ?? "My"} onClose={() => setExporting(false)} />}
      {reviewing && watch.data && years.length > 0 && (
        <YearInReview data={watch.data} ratings={state} items={byId} years={years} userName={user?.Name ?? "Your"} onClose={() => setReviewing(false)} />
      )}
    </div>
  );
}

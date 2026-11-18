import { Link } from "react-router";
import { MediaCard } from "@/components/MediaCard";
import { Row } from "@/components/Row";
import { KIND_LABEL, type TrendKind } from "./logic";
import { ExternalCard } from "./ExternalCard";
import { useTopTenTab, useTrendingPrefs, useTrendKinds } from "./store";
import { useTopTen, type TopRow } from "./useTopTen";
import "./trending.css";

const SOURCE: Record<TrendKind, string> = { anime: "AniList", movies: "TMDB", series: "TMDB" };

/** Anime / Movies / Series, when more than one is on. */
export function KindTabs({ kinds, value, onChange }: { kinds: TrendKind[]; value?: TrendKind; onChange: (k: TrendKind) => void }) {
  if (kinds.length < 2) return null;
  return (
    <div className="tabs top10__tabs" role="tablist" aria-label="Which Top 10" data-nav-row>
      {kinds.map((k) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? "is-active" : ""} onClick={() => onChange(k)}>
          {KIND_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

/** One place in the ranking: the big number, then the card. */
export function RankedCard({ row }: { row: TopRow }) {
  return (
    <div className={`top10 ${row.rank >= 10 ? "top10--wide" : ""} ${row.rank === 1 ? "top10--one" : ""}`}>
      <span className="top10__rank" aria-hidden="true">
        {row.rank}
      </span>
      {row.item ? <MediaCard item={row.item} /> : <ExternalCard entry={row.entry} />}
    </div>
  );
}

/** The home page's Top 10: this week's trending anime, films or series. */
export function TopTenRow() {
  const prefs = useTrendingPrefs();
  const kinds = useTrendKinds();
  const [tab, setTab] = useTopTenTab(kinds);
  const top = useTopTen(prefs.home ? tab : undefined, 10);
  if (!prefs.home || !tab) return null;
  // Couldn't be fetched and nothing to switch to: no row rather than an empty one.
  if (!top.pending && !top.rows.length && kinds.length < 2) return null;

  return (
    <Row
      title="Top 10"
      eyebrow={`Trending this week · ${SOURCE[tab]}`}
      seeAllTo={`/trending?kind=${tab}`}
      loading={top.pending}
      className="row--top10"
      actions={<KindTabs kinds={kinds} value={tab} onChange={setTab} />}
    >
      {top.rows.length ? (
        top.rows.map((r) => <RankedCard key={r.entry.key} row={r} />)
      ) : (
        <p className="top10__empty">
          {top.keyRejected ? (
            <>
              TMDB didn't accept your API key. <Link to="/profile?tab=settings#settings-top-10">Check it in Settings</Link>
            </>
          ) : top.error ? (
            "Couldn't load this week's list. It'll try again later."
          ) : (
            "None of this week's Top 10 is in your library."
          )}
        </p>
      )}
    </Row>
  );
}

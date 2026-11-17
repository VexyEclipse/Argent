import { Link, useSearchParams } from "react-router";
import { MediaCard, CardSkeleton } from "@/components/MediaCard";
import { EmptyState } from "@/components/States";
import { ExternalCard } from "./ExternalCard";
import { KIND_LABEL, TREND_KINDS, type TrendKind } from "./logic";
import { KindTabs } from "./TopTenRow";
import { useTmdbKey, useTrendingPrefs, useTrendKinds } from "./store";
import { useTopTen } from "./useTopTen";
import "./trending.css";

/** Trending anime, films or series: the top 40, yours and (if shown) the rest. */
export default function TrendingPage() {
  const [params, setParams] = useSearchParams();
  const kinds = useTrendKinds();
  const prefs = useTrendingPrefs();
  const { key } = useTmdbKey();
  const asked = params.get("kind") as TrendKind | null;
  const kind = asked && kinds.includes(asked) ? asked : kinds[0];
  const top = useTopTen(kind, 40);
  const missingKey = !key && TREND_KINDS.some((k) => k !== "anime" && prefs[k]);

  return (
    <div className="page trending">
      <header className="trending__head">
        <div>
          <span className="eyebrow">This week</span>
          <h1 className="page-title">Trending {kind ? KIND_LABEL[kind] : ""}</h1>
          <p className="muted trending__note">
            {kind === "anime" ? "From AniList" : "From TMDB"}
            {prefs.notOwned ? ". Titles you don't have are marked Not in library." : ", only titles in your library."}
            {missingKey && (
              <>
                {" "}
                Add a TMDB key in <Link to="/profile?tab=settings#settings-top-10">Settings</Link> for films and series too.
              </>
            )}
          </p>
        </div>
        <KindTabs kinds={kinds} value={kind} onChange={(k) => setParams({ kind: k }, { replace: true })} />
      </header>

      {!kind ? (
        <EmptyState title="Top 10 is off" body="Turn on Anime, Movies or Series in Settings → Top 10." />
      ) : top.pending ? (
        <div className="grid">
          {Array.from({ length: 18 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : top.rows.length ? (
        <div className="grid trending__grid">
          {top.rows.map((r) => (
            <div className="trend-cell" key={r.entry.key}>
              <span className="trend-cell__rank">{r.rank}</span>
              {r.item ? <MediaCard item={r.item} /> : <ExternalCard entry={r.entry} />}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title={top.keyRejected ? "TMDB didn't accept your key" : top.error ? "Couldn't load the list" : "Nothing trending is in your library"}
          body={
            top.keyRejected
              ? "Check the key in Settings → Top 10."
              : top.error
                ? "Check your connection and try again later."
                : "Turn on “Include titles not in your library” to see the whole list."
          }
        />
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { copyIds } from "@/api/duplicates";
import { CARD_FIELDS, getEpisodes, getItemFull, getItems, getSeasons } from "@/api/jellyfin";
import { landscapeImage } from "@/api/images";
import { episodeCode, formatRuntime, progressOf } from "@/api/format";
import type { BaseItem } from "@/api/types";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { MediaCard } from "@/components/MediaCard";
import { ErrorState, Spinner } from "@/components/States";
import { seriesPlayTarget } from "@/features/player/playback";
import { shuffleEpisode } from "@/features/player/shuffle";
import type { RateTarget } from "@/features/ratings/logic";
import { useRatings } from "@/features/ratings/prefs";
import { useRateDialog } from "@/features/ratings/RatePrompt";
import { openMenu } from "@/features/manage/store";
import { useAuth } from "@/auth/AuthProvider";
import { FillerBadge } from "@/features/filler/FillerBadge";
import { useEpisodeNames, useEpisodeTitle } from "@/features/filler/names";
import { useFillerIds } from "@/features/filler/store";
import { DownloadButton } from "@/features/downloads/DownloadButton";
import { useDownloadDialog } from "@/features/downloads/DownloadDialog";
import { downloadsSupported } from "@/features/downloads/store";
import { Hero } from "./Hero";
import { CastRow, ExtrasRow, InfoTable, SimilarRow } from "./Sections";
import { earlierUnwatched } from "./episodes";
import { useBulkPlayed } from "./useItemActions";
import "./details.css";

export default function DetailsPage() {
  const { id = "" } = useParams();
  const item = useQuery({ queryKey: ["item", id], queryFn: () => getItemFull(id), staleTime: 30_000 });

  if (item.isPending) return <Spinner />;
  if (item.isError)
    return (
      <div className="page">
        <ErrorState error={item.error} onRetry={() => item.refetch()} />
      </div>
    );
  const data = item.data;

  switch (data.Type) {
    case "Series":
      return <SeriesDetails item={data} />;
    case "Season":
      return <Navigate to={`/details/${data.SeriesId}?season=${data.Id}`} replace />;
    case "Episode":
      return <EpisodeDetails item={data} />;
    case "BoxSet":
      return <CollectionDetails item={data} />;
    case "Person":
      return <Navigate to={`/person/${data.Id}`} replace />;
    default:
      return <MovieDetails item={data} />;
  }
}

function MovieDetails({ item }: { item: BaseItem }) {
  return (
    <div className="details">
      <Hero item={item} />
      <div className="details__body">
        <CastRow people={item.People} />
        <ExtrasRow item={item} />
        <SimilarRow item={item} />
        <InfoTable item={item} />
      </div>
    </div>
  );
}

// ---- Series ---------------------------------------------------------------------

function SeriesDetails({ item }: { item: BaseItem }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const seasons = useQuery({ queryKey: ["seasons", item.Id], queryFn: () => getSeasons(item.Id).then((r) => r.Items), staleTime: 60_000 });
  const nextUp = useQuery({ queryKey: ["nextup", item.Id], queryFn: () => seriesPlayTarget(item.Id), staleTime: 30_000 });

  const seasonList = seasons.data ?? [];
  const selectedId = params.get("season") ?? nextUp.data?.SeasonId ?? seasonList.find((s) => (s.IndexNumber ?? 0) > 0)?.Id ?? seasonList[0]?.Id;

  const ratings = useRatings();
  const rateDialog = useRateDialog();
  const downloadDialog = useDownloadDialog();
  const queryClient = useQueryClient();
  const bulk = useBulkPlayed();
  const downloadSeason = async (season: BaseItem) => {
    const episodes = await queryClient
      .fetchQuery({ queryKey: ["episodes", item.Id, season.Id], queryFn: () => getEpisodes(item.Id, season.Id).then((r) => r.Items), staleTime: 30_000 })
      .catch(() => [] as BaseItem[]);
    const real = episodes.filter((e) => e.LocationType !== "Virtual");
    if (real.length) downloadDialog.open(real, `${item.Name} · ${season.Name}`);
  };
  const seasonTarget = (s: BaseItem): RateTarget => ({
    id: s.Id,
    name: `${item.Name} · ${s.Name}`,
    type: "Season",
    seriesId: item.Id,
    seasonNumber: s.IndexNumber,
  });
  const selectedSeason = seasonList.find((s) => s.Id === selectedId);

  const playTarget = nextUp.data ?? null;
  const started = (item.UserData?.PlayedPercentage ?? 0) > 0 || Boolean(playTarget && progressOf(playTarget) > 0);
  const shuffle = async () => {
    const episode = await shuffleEpisode(item.Id).catch(() => null);
    if (episode) navigate(`/play/${episode.Id}?start=0&shuffle=${item.Id}`);
  };

  return (
    <div className="details">
      <Hero
        item={item}
        playTarget={playTarget}
        playLabel={
          playTarget ? `${started ? (progressOf(playTarget) > 0 ? "Resume" : "Continue") : "Play"} ${episodeCode(playTarget).replace(" · ", "")}` : undefined
        }
        extraActions={
          (item.RecursiveItemCount ?? 2) > 1 && (
            <Button variant="icon" size="lg" icon="shuffle" onClick={shuffle} aria-label="Shuffle episodes" title="Shuffle episodes" />
          )
        }
      >
        {playTarget && started && (
          <p className="hero__next">
            <span className="eyebrow">Up next</span> {episodeCode(playTarget)} — {playTarget.Name}
          </p>
        )}
      </Hero>

      <div className="details__body">
        <SeasonScores series={item} seasons={seasonList} onRate={(s) => rateDialog.open(seasonTarget(s))} />
        {seasonList.length > 0 && (
          <section className="seasons">
            <div className="seasons__tabs" role="tablist" aria-label="Seasons" data-nav-row>
              {seasonList.map((s) => {
                const watched = s.UserData?.Played;
                const score = ratings.ratings[s.Id]?.stars;
                return (
                  <button
                    key={s.Id}
                    role="tab"
                    aria-selected={s.Id === selectedId}
                    className={`seasons__tab ${s.Id === selectedId ? "is-active" : ""}`}
                    onClick={() => setParams({ season: s.Id }, { replace: true, preventScrollReset: true })}
                  >
                    {s.Name}
                    {score ? (
                      <span className="seasons__score">
                        <Icon name="star" size={11} />
                        {score}
                      </span>
                    ) : (
                      watched && <Icon name="check" size={13} />
                    )}
                  </button>
                );
              })}
              {selectedSeason && (
                <button
                  className="seasons__tab seasons__action"
                  onClick={() => bulk.mutate({ ids: [selectedSeason.Id], value: !selectedSeason.UserData?.Played })}
                  disabled={bulk.isPending}
                >
                  <Icon name={selectedSeason.UserData?.Played ? "eye" : "checkAll"} size={15} />
                  {selectedSeason.UserData?.Played ? "Mark season unwatched" : "Mark season watched"}
                </button>
              )}
              {selectedSeason && downloadsSupported() && (
                <button className="seasons__tab seasons__action" onClick={() => downloadSeason(selectedSeason)}>
                  <Icon name="download" size={15} />
                  Download season
                </button>
              )}
              {selectedSeason && (selectedSeason.IndexNumber ?? 0) > 0 && (
                <button className="seasons__tab seasons__rate" onClick={() => rateDialog.open(seasonTarget(selectedSeason))}>
                  <Icon name="star" size={14} />
                  {ratings.ratings[selectedSeason.Id] ? "Change season score" : "Rate this season"}
                </button>
              )}
            </div>
            {selectedId && <EpisodeList seriesId={item.Id} seasonId={selectedId} highlightId={nextUp.data?.Id} />}
          </section>
        )}
        <CastRow people={item.People} />
        <ExtrasRow item={item} />
        <SimilarRow item={item} />
        <InfoTable item={item} />
      </div>
      {rateDialog.dialog}
      {downloadDialog.dialog}
    </div>
  );
}

/** Your series score and a bar per season, once you've rated any of them. */
function SeasonScores({ series, seasons, onRate }: { series: BaseItem; seasons: BaseItem[]; onRate: (season: BaseItem) => void }) {
  const ratings = useRatings();
  const real = seasons.filter((s) => (s.IndexNumber ?? 0) > 0);
  const scored = real.filter((s) => ratings.ratings[s.Id]);
  const own = ratings.ratings[series.Id];
  if (!scored.length) return null;
  const average = scored.reduce((sum, s) => sum + ratings.ratings[s.Id].stars, 0) / scored.length;
  return (
    <section className="season-scores">
      <header className="season-scores__head">
        <h2 className="row__title">Your scores</h2>
        <span className="season-scores__summary">
          {own ? (
            <>
              Series <strong>{own.stars}</strong>/10 ·{" "}
            </>
          ) : null}
          Season average <strong>{average.toFixed(1)}</strong>
        </span>
      </header>
      <div className="season-scores__chart" data-nav-row>
        {real.map((s) => {
          const score = ratings.ratings[s.Id]?.stars;
          return (
            <button key={s.Id} className="season-scores__col" onClick={() => onRate(s)} aria-label={`${s.Name}: ${score ? `${score} out of 10` : "not rated"}`}>
              <span className="season-scores__value">{score ?? "–"}</span>
              <span className="season-scores__track">
                <span className="season-scores__bar" style={{ height: `${(score ?? 0) * 10}%` }} />
              </span>
              <span className="season-scores__label">S{s.IndexNumber}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EpisodeList({ seriesId, seasonId, highlightId }: { seriesId: string; seasonId: string; highlightId?: string }) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const bulk = useBulkPlayed();
  // After marking one episode watched: offer to mark the unwatched ones before it too.
  const [offer, setOffer] = useState<{ episodeId: string; ids: string[]; count: number } | null>(null);
  const episodes = useQuery({
    queryKey: ["episodes", seriesId, seasonId],
    queryFn: () => getEpisodes(seriesId, seasonId).then((r) => r.Items),
    staleTime: 30_000,
  });
  const filler = useFillerIds(seriesId);
  const names = useEpisodeNames(seriesId);

  const toggleEpisode = async (ep: BaseItem) => {
    const value = !ep.UserData?.Played;
    // Every copy of the episode, so a hidden duplicate doesn't stay "next".
    bulk.mutate({ ids: copyIds(ep), value });
    setOffer(null);
    if (!value) return;
    const all = await qc
      .fetchQuery({ queryKey: ["episodes", seriesId, "all"], queryFn: () => getEpisodes(seriesId).then((r) => r.Items), staleTime: 60_000 })
      .catch(() => [] as BaseItem[]);
    const earlier = earlierUnwatched(all, ep.Id);
    if (earlier.length) setOffer({ episodeId: ep.Id, ids: earlier.flatMap(copyIds), count: earlier.length });
  };

  if (episodes.isPending) return <Spinner />;
  if (!episodes.data?.length) return <p className="muted">No episodes in this season.</p>;

  return (
    <ol className="episodes">
      {episodes.data.map((ep) => {
        const progress = progressOf(ep);
        const played = ep.UserData?.Played;
        return (
          <li
            key={ep.Id}
            id={`ep-${ep.Id}`}
            className={`episode ${ep.Id === highlightId ? "is-next" : ""}`}
            onContextMenu={
              isAdmin
                ? (e) => {
                    e.preventDefault();
                    openMenu(ep, { x: e.clientX, y: e.clientY });
                  }
                : undefined
            }
          >
            <button className="episode__thumb" onClick={() => navigate(`/play/${ep.Id}`)} aria-label={`Play ${ep.Name}`}>
              <Artwork image={landscapeImage(ep, 480)} alt="" />
              <span className="episode__play">
                <Icon name="play" size={20} />
              </span>
              {progress > 0 && progress < 100 && (
                <span className="card__progress">
                  <span style={{ width: `${progress}%` }} />
                </span>
              )}
            </button>
            <div className="episode__text">
              <div className="episode__head">
                <Link to={`/details/${ep.Id}`} className="episode__title">
                  <span className="episode__num">{ep.IndexNumber ?? "–"}</span>
                  {names.get(ep.Id) ?? ep.Name}
                  {filler.has(ep.Id) && <FillerBadge />}
                </Link>
                <span className="episode__download">
                  <DownloadButton item={ep} size="sm" />
                </span>
                <button
                  className={`episode__watched ${played ? "is-on" : ""}`}
                  onClick={() => toggleEpisode(ep)}
                  aria-label={played ? "Mark unwatched" : "Mark watched"}
                  title={played ? "Watched" : "Mark watched"}
                >
                  <Icon name="check" size={15} />
                </button>
              </div>
              <div className="episode__meta">
                {[
                  formatRuntime(ep.RunTimeTicks),
                  ep.PremiereDate ? new Date(ep.PremiereDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null,
                ]
                  .filter(Boolean)
                  .join("  ·  ")}
                {isAdmin && ep.Copies && (
                  <span
                    className="episode__copies"
                    title={`This episode is in the library ${ep.Copies.length + 1} times. Shown here: ${ep.MediaSources?.[0]?.Path ?? "this copy"}. Also: ${ep.Copies.map((c) => c.Path ?? c.Id).join(", ")}`}
                  >
                    {ep.Copies.length + 1} copies
                  </span>
                )}
              </div>
              {ep.Overview && <p className="episode__overview">{ep.Overview}</p>}
              {offer?.episodeId === ep.Id && (
                <div className="episode__offer" role="status">
                  <span>
                    Mark the {offer.count === 1 ? "earlier episode" : `${offer.count} earlier episodes`} watched too?
                  </span>
                  <div className="episode__offer-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      icon="checkAll"
                      disabled={bulk.isPending}
                      onClick={() => bulk.mutate({ ids: offer.ids, value: true }, { onSettled: () => setOffer(null) })}
                    >
                      Mark watched
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setOffer(null)}>
                      No thanks
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---- Episode --------------------------------------------------------------------

function EpisodeDetails({ item }: { item: BaseItem }) {
  const navigate = useNavigate();
  const filler = useFillerIds(item.SeriesId);
  const title = useEpisodeTitle(item) ?? item.Name;
  const all = useQuery({
    queryKey: ["episodes", item.SeriesId, "all"],
    queryFn: () => getEpisodes(item.SeriesId!).then((r) => r.Items),
    enabled: Boolean(item.SeriesId),
    staleTime: 60_000,
  });
  const { prev, next } = useMemo(() => {
    const list = all.data ?? [];
    const i = list.findIndex((e) => e.Id === item.Id);
    return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
  }, [all.data, item.Id]);

  return (
    <div className="details">
      <Hero
        item={title === item.Name ? item : { ...item, Name: title }}
        showPoster={false}
        eyebrow={
          <>
            <Link to={`/details/${item.SeriesId}`} className="link">
              {item.SeriesName}
            </Link>
            {"  ·  "}
            {episodeCode(item)}
            {filler.has(item.Id) && <FillerBadge />}
          </>
        }
        extraActions={
          <>
            {prev && (
              <Button
                variant="icon"
                size="lg"
                icon="skipPrev"
                onClick={() => navigate(`/details/${prev.Id}`)}
                aria-label={`Previous episode: ${prev.Name}`}
                title="Previous episode"
              />
            )}
            {next && (
              <Button
                variant="icon"
                size="lg"
                icon="skipNext"
                onClick={() => navigate(`/details/${next.Id}`)}
                aria-label={`Next episode: ${next.Name}`}
                title="Next episode"
              />
            )}
          </>
        }
      />
      <div className="details__body">
        <CastRow people={item.People?.filter((p) => p.Type === "GuestStar" || p.Type === "Director" || p.Type === "Writer")} title="Guest Stars & Crew" />
        {item.SeasonId && item.SeriesId && (
          <section className="seasons">
            <h2 className="row__title seasons__heading">{item.SeasonName}</h2>
            <EpisodeList seriesId={item.SeriesId} seasonId={item.SeasonId} highlightId={item.Id} />
          </section>
        )}
        <InfoTable item={item} />
      </div>
    </div>
  );
}

// ---- Collection -----------------------------------------------------------------

function CollectionDetails({ item }: { item: BaseItem }) {
  const children = useQuery({
    queryKey: ["collection", item.Id],
    queryFn: () =>
      getItems({ parentId: item.Id, sortBy: ["PremiereDate", "ProductionYear", "SortName"], sortOrder: "Ascending", fields: CARD_FIELDS }).then((r) => r.Items),
    staleTime: 60_000,
  });
  const firstUnwatched = children.data?.find((c) => !c.UserData?.Played) ?? children.data?.[0] ?? null;
  return (
    <div className="details">
      <Hero item={item} playTarget={firstUnwatched} playLabel={firstUnwatched ? `Play ${firstUnwatched.Name}` : undefined} eyebrow="Collection" />
      <div className="details__body details__body--padded">
        <h2 className="row__title">{children.data ? `${children.data.length} titles` : "Titles"}</h2>
        {children.isPending ? (
          <Spinner />
        ) : (
          <div className="grid">
            {children.data?.map((c) => (
              <MediaCard key={c.Id} item={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

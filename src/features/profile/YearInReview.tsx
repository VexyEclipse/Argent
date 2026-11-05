import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItems } from "@/api/jellyfin";
import { backdropImage, posterImage } from "@/api/images";
import type { BaseItem } from "@/api/types";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { isBackKey } from "@/platform/spatialNavigation";
import { isTitle, sortRatings, type RatingsState } from "@/features/ratings/logic";
import { computeYearReview, type WatchData } from "./watchStats";

interface Props {
  data: WatchData;
  ratings: RatingsState;
  items: Map<string, BaseItem>;
  years: number[];
  userName: string;
  onClose: () => void;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString();

/** A story-style recap of one year: time watched, genres, the binge, the best of it. */
export function YearInReview({ data, ratings, items, years, userName, onClose }: Props) {
  const [year, setYear] = useState(years[0]);
  const [index, setIndex] = useState(0);
  const review = useMemo(() => computeYearReview(data, year), [data, year]);
  const rated = useMemo(
    () => sortRatings(Object.entries(ratings.ratings), "stars", ratings.order.ids).filter(([, e]) => isTitle(e) && new Date(e.ratedAt).getFullYear() === year),
    [ratings, year],
  );
  const average = rated.length ? rated.reduce((s, [, e]) => s + e.stars, 0) / rated.length : 0;

  const binge = useQuery({
    queryKey: ["yir-item", review.mostBinged?.id],
    queryFn: () => getItems({ ids: [review.mostBinged!.id], fields: CARD_FIELDS }).then((r) => r.Items[0] ?? null),
    enabled: Boolean(review.mostBinged),
    staleTime: 10 * 60_000,
  });
  const backdropFrom = binge.data ?? (rated[0] ? items.get(rated[0][0]) : undefined);
  const backdrop = backdropFrom ? backdropImage(backdropFrom, 1280) : null;
  const maxGenre = review.topGenres[0]?.hours || 1;

  const slides: { id: string; body: ReactNode }[] = [
    {
      id: "intro",
      body: (
        <>
          <span className="eyebrow">Argent · {year} in review</span>
          <h2 className="yir__headline">
            {userName}'s <span className="yir__accent">{year}</span>
          </h2>
          <p className="yir__big">≈ {fmtInt(review.hours)} hours</p>
          <p className="yir__lead">of films and series. That's {(review.hours / 24).toFixed(1)} days of watching.</p>
        </>
      ),
    },
    {
      id: "counts",
      body: (
        <>
          <span className="eyebrow">You watched</span>
          <div className="yir__counts">
            <div>
              <strong>{fmtInt(review.movies)}</strong>
              <span>movies</span>
            </div>
            <div>
              <strong>{fmtInt(review.series)}</strong>
              <span>series</span>
            </div>
            <div>
              <strong>{fmtInt(review.episodes)}</strong>
              <span>episodes</span>
            </div>
          </div>
          {review.longestMovie && (
            <p className="yir__lead">
              Longest sit: <strong>{review.longestMovie.name}</strong>, {review.longestMovie.hours.toFixed(1)} h.
            </p>
          )}
        </>
      ),
    },
  ];
  if (review.topGenres.length)
    slides.push({
      id: "genres",
      body: (
        <>
          <span className="eyebrow">Your genres</span>
          <h2 className="yir__headline">
            Mostly <span className="yir__accent">{review.topGenres[0].name}</span>
          </h2>
          <ul className="yir__bars">
            {review.topGenres.map((g) => (
              <li key={g.name}>
                <span>{g.name}</span>
                <span className="yir__track">
                  <span style={{ width: `${(g.hours / maxGenre) * 100}%` }} />
                </span>
                <span className="yir__val">{fmtInt(g.hours)} h</span>
              </li>
            ))}
          </ul>
        </>
      ),
    });
  if (review.mostBinged)
    slides.push({
      id: "binge",
      body: (
        <>
          <span className="eyebrow">Most binged</span>
          <div className="yir__binge">
            {binge.data && <Artwork image={posterImage(binge.data, 360)} className="yir__poster" />}
            <div>
              <h2 className="yir__headline">{review.mostBinged.name}</h2>
              <p className="yir__lead">
                {review.mostBinged.episodes} episodes · {fmtInt(review.mostBinged.hours)} hours
              </p>
            </div>
          </div>
        </>
      ),
    });
  if (rated.length)
    slides.push({
      id: "best",
      body: (
        <>
          <span className="eyebrow">Your highest rated of {year}</span>
          <div className="yir__posters">
            {rated.slice(0, 5).map(([id, e], i) => {
              const item = items.get(id);
              return (
                <Link key={id} to={`/details/${id}`} className="yir__pick" onClick={onClose}>
                  <Artwork image={item ? posterImage(item, 300) : null} fallbackLabel={e.name} />
                  <span className="yir__rank">{i + 1}</span>
                  <span className="yir__pick-score">
                    <Icon name="star" size={12} /> {e.stars}
                  </span>
                  <span className="yir__pick-name">{e.name}</span>
                </Link>
              );
            })}
          </div>
        </>
      ),
    });
  slides.push({
    id: "outro",
    body: (
      <>
        <span className="eyebrow">That was {year}</span>
        <h2 className="yir__headline">
          {rated.length ? (
            <>
              {rated.length} rated, averaging <span className="yir__accent">{average.toFixed(1)}</span>
            </>
          ) : (
            "Rate what you watch to see your favourites here"
          )}
        </h2>
        <p className="yir__lead">Based on when each title was last played. See you in {year + 1}.</p>
      </>
    ),
  });

  const last = slides.length - 1;
  const current = Math.min(index, last);
  const go = (d: number) => setIndex((i) => Math.max(0, Math.min(last, Math.min(i, last) + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isBackKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="yir" role="dialog" aria-modal="true" aria-label={`${year} in review`} data-nav-trap>
      {backdrop && <img className="yir__bg" src={backdrop.url} alt="" aria-hidden="true" />}
      <div className="yir__scrim" />
      <div className="yir__top">
        <div className="yir__progress">
          {slides.map((s, i) => (
            <span key={s.id} className={i <= current ? "is-done" : ""} />
          ))}
        </div>
        <div className="yir__controls">
          {years.length > 1 && (
            <div className="tabs" role="radiogroup" aria-label="Year">
              {years.slice(0, 4).map((y) => (
                <button
                  key={y}
                  role="radio"
                  aria-checked={y === year}
                  className={y === year ? "is-active" : ""}
                  onClick={() => {
                    setYear(y);
                    setIndex(0);
                  }}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
          <Button variant="icon" icon="close" aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="yir__stage" onClick={(e) => go(e.clientX < window.innerWidth * 0.3 ? -1 : 1)}>
        <div key={`${year}-${slides[current].id}`} className="yir__slide fade-in">
          {slides[current].body}
        </div>
      </div>
      <div className="yir__nav">
        <Button variant="ghost" icon="chevronLeft" disabled={current === 0} onClick={() => go(-1)}>
          Back
        </Button>
        <span className="yir__count">
          {current + 1} / {slides.length}
        </span>
        {current < last ? (
          <Button variant="primary" onClick={() => go(1)}>
            Next
          </Button>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItems, getNextUp, getResume } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { MediaCard } from "@/components/MediaCard";
import { Row } from "@/components/Row";
import { MediaBar } from "@/features/mediabar/MediaBar";
import { useRecommendations, type UiPick } from "@/features/recommendations/useRecommendations";
import { recordImpressions, recordOpen } from "@/features/recommendations/feedback";
import { useLibraryGroups } from "@/api/libraries";
import { interleave } from "@/features/mediabar/logic";
import { GenreRow } from "./GenreRow";
import "./home.css";

const ROW_IMAGES = ["Primary", "Backdrop", "Thumb", "Logo"];

function useRecentlyAdded() {
  return useQuery({
    queryKey: ["home", "recent"],
    queryFn: async () => {
      const [movies, series] = await Promise.all([
        getItems({
          includeItemTypes: ["Movie"],
          recursive: true,
          sortBy: ["DateCreated"],
          sortOrder: "Descending",
          limit: 20,
          fields: [...CARD_FIELDS, "DateCreated"],
          enableImageTypes: ROW_IMAGES,
        }),
        getItems({
          includeItemTypes: ["Series"],
          recursive: true,
          sortBy: ["DateLastContentAdded"],
          sortOrder: "Descending",
          limit: 20,
          fields: [...CARD_FIELDS, "DateCreated", "DateLastMediaAdded"],
          enableImageTypes: ROW_IMAGES,
        }),
      ]);
      const when = (i: BaseItem & { DateLastMediaAdded?: string }) => Date.parse(i.DateLastMediaAdded || i.DateCreated || "") || 0;
      return [...movies.Items, ...series.Items].sort((a, b) => when(b) - when(a)).slice(0, 24);
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * A shelf from the user's libraries: unwatched first, shuffled once per cache lifetime
 * so it changes between visits. `parents` limits it to specific libraries (merged
 * round-robin); null means every library.
 */
function useLibraryRow(key: string, types: string[], parents: string[] | null, enabled = true) {
  return useQuery({
    queryKey: ["home", "library", key, parents],
    queryFn: async () => {
      const query = {
        includeItemTypes: types,
        recursive: true,
        sortBy: ["IsUnplayed", "Random"],
        sortOrder: "Descending",
        limit: 24,
        fields: CARD_FIELDS,
        enableImageTypes: ROW_IMAGES,
      };
      if (!parents) return (await getItems(query)).Items;
      const pages = await Promise.all(parents.map((parentId) => getItems({ ...query, parentId }).then((r) => r.Items)));
      return interleave(pages, 24);
    },
    enabled,
    staleTime: 15 * 60_000,
  });
}

function useCollections() {
  return useQuery({
    queryKey: ["home", "collections"],
    queryFn: () =>
      getItems({
        includeItemTypes: ["BoxSet"],
        recursive: true,
        sortBy: ["DateLastContentAdded", "SortName"],
        sortOrder: "Descending",
        limit: 20,
        fields: CARD_FIELDS,
        enableImageTypes: ROW_IMAGES,
      }).then((r) => r.Items),
    staleTime: 10 * 60_000,
  });
}

/** Records which recommendations were actually seen, to rotate stale ones out. */
function useImpressions(picks: UiPick[] | undefined) {
  const { user } = useAuth();
  useEffect(() => {
    if (!user || !picks?.length) return;
    const t = window.setTimeout(
      () =>
        recordImpressions(
          user.Id,
          picks.slice(0, 8).map((p) => p.item.Id),
        ),
      2500,
    );
    return () => window.clearTimeout(t);
  }, [picks, user]);
}

export function HomePage() {
  const { user } = useAuth();
  const [ambient, setAmbient] = useState<string | null>(null);
  const resume = useQuery({ queryKey: ["home", "resume"], queryFn: () => getResume(20).then((r) => r.Items), staleTime: 30_000 });
  const nextUp = useQuery({ queryKey: ["home", "nextup"], queryFn: () => getNextUp({ limit: 20 }).then((r) => r.Items), staleTime: 30_000 });
  const recent = useRecentlyAdded();
  const groups = useLibraryGroups();
  const hasAnime = groups.anime.length > 0;
  const movies = useLibraryRow("movies", ["Movie"], null);
  // With an anime library present, Series means the other TV libraries.
  const series = useLibraryRow("series", ["Series"], hasAnime ? groups.series.map((l) => l.Id) : null, !groups.isPending);
  const anime = useLibraryRow(
    "anime",
    ["Series", "Movie"],
    groups.anime.map((l) => l.Id),
    hasAnime,
  );
  const collections = useCollections();
  const recs = useRecommendations();

  useImpressions(recs.data?.recommended);

  const onOpen = useCallback((item: BaseItem) => user && recordOpen(user.Id, item.Id), [user]);

  // Continue Watching and Next Up overlap for shows mid-episode; keep each once.
  const nextUpItems = useMemo(() => {
    const resumeIds = new Set((resume.data ?? []).map((i) => i.Id));
    return (nextUp.data ?? []).filter((i) => !resumeIds.has(i.Id));
  }, [resume.data, nextUp.data]);

  const personal = recs.data?.sections ?? [];
  const renderPersonal = (index: number) => {
    const section = personal[index];
    if (!section) return null;
    return (
      <Row key={section.id} title={section.title} eyebrow={section.eyebrow}>
        {section.items.map((p) => (
          <PickCard key={p.item.Id} pick={p} onOpen={onOpen} />
        ))}
      </Row>
    );
  };

  const ambientRef = useRef(setAmbient);
  ambientRef.current = setAmbient;
  const onBackdropChange = useCallback((url: string | null) => ambientRef.current(url), []);

  return (
    <div className="home">
      {ambient && <div className="home__ambient" style={{ backgroundImage: `url("${ambient}")` }} aria-hidden="true" />}
      <MediaBar onBackdropChange={onBackdropChange} />

      <div className="home__rows">
        {(resume.isPending || (resume.data?.length ?? 0) > 0) && (
          <Row title="Continue Watching" variant="landscape" loading={resume.isPending}>
            {resume.data?.map((item) => (
              <MediaCard key={item.Id} item={item} variant="landscape" playOnClick />
            ))}
          </Row>
        )}

        {(nextUp.isPending || nextUpItems.length > 0) && (
          <Row title="Next Up" variant="landscape" loading={nextUp.isPending}>
            {nextUpItems.map((item) => (
              <MediaCard key={item.Id} item={item} variant="landscape" playOnClick />
            ))}
          </Row>
        )}

        {(recs.isLoading || (recs.data?.recommended.length ?? 0) > 0) && (
          <Row
            title="Recommended For You"
            eyebrow={recs.data && !recs.data.personalised ? "Start watching to personalise" : "For " + (user?.Name ?? "you")}
            loading={recs.isLoading}
            className="row--feature"
          >
            {recs.data?.recommended.map((p) => (
              <PickCard key={p.item.Id} pick={p} onOpen={onOpen} onDismiss={(i) => recs.dismiss(i.Id)} showReason />
            ))}
          </Row>
        )}

        {(recent.isPending || (recent.data?.length ?? 0) > 0) && (
          <Row title="Recently Added" loading={recent.isPending}>
            {recent.data?.map((item) => (
              <MediaCard key={item.Id} item={item} />
            ))}
          </Row>
        )}

        {renderPersonal(0)}

        {(movies.isPending || (movies.data?.length ?? 0) > 0) && (
          <Row title="Your Movies" seeAllTo="/movies" loading={movies.isPending}>
            {movies.data?.map((item) => (
              <MediaCard key={item.Id} item={item} />
            ))}
          </Row>
        )}

        {(series.isPending || (series.data?.length ?? 0) > 0) && (
          <Row title="Your Series" seeAllTo="/series" loading={series.isPending}>
            {series.data?.map((item) => (
              <MediaCard key={item.Id} item={item} />
            ))}
          </Row>
        )}

        {hasAnime && (anime.isPending || (anime.data?.length ?? 0) > 0) && (
          <Row title="Your Anime" seeAllTo="/anime" loading={anime.isPending}>
            {anime.data?.map((item) => (
              <MediaCard key={item.Id} item={item} />
            ))}
          </Row>
        )}

        {renderPersonal(1)}

        {(collections.data?.length ?? 0) > 0 && (
          <Row title="Collections" seeAllTo="/collections">
            {collections.data?.map((item) => (
              <MediaCard key={item.Id} item={item} />
            ))}
          </Row>
        )}

        {(recs.data?.discover.length ?? 0) > 0 && (
          <Row title="Discover" eyebrow="From your library">
            {recs.data?.discover.map((p) => (
              <PickCard key={p.item.Id} pick={p} onOpen={onOpen} />
            ))}
          </Row>
        )}

        {renderPersonal(2)}

        <GenreRow preferred={recs.data?.topGenres ?? []} counts={recs.data?.genreCounts} />
      </div>
    </div>
  );
}

/** Reasons show on the main row only; section rows already say why in their heading. */
function PickCard({
  pick,
  onOpen,
  onDismiss,
  showReason,
}: {
  pick: UiPick;
  onOpen: (i: BaseItem) => void;
  onDismiss?: (i: BaseItem) => void;
  showReason?: boolean;
}) {
  return (
    <div className={`pick pick--${pick.strength}`} onClickCapture={() => onOpen(pick.item)}>
      <MediaCard item={pick.item} caption={showReason ? pick.reason.text : undefined} onDismiss={onDismiss} />
    </div>
  );
}

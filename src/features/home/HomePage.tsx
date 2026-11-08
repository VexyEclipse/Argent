import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CARD_FIELDS, getItems, getNextUp, getResume } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Icon } from "@/components/Icon";
import { MediaCard } from "@/components/MediaCard";
import { showToast } from "@/components/Toast";
import { Row } from "@/components/Row";
import { MediaBar } from "@/features/mediabar/MediaBar";
import { useRecommendations, type UiPick } from "@/features/recommendations/useRecommendations";
import { recordImpressions, recordOpen } from "@/features/recommendations/feedback";
import { useLibraryGroups } from "@/api/libraries";
import { interleave } from "@/features/mediabar/logic";
import { useComingUp } from "@/features/upcoming/useComingUp";
import { isFinished, useWatchlistItems } from "@/features/watchlist/useWatchlistItems";
import { pickSomething } from "@/features/player/shuffle";
import { GenreRow } from "./GenreRow";
import { clearResumePoint, useHiddenNextUp } from "./hidden";
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
  const comingUp = useComingUp();
  const watchlist = useWatchlistItems();
  const watchlistToWatch = useMemo(() => (watchlist.data ?? []).filter((i) => !isFinished(i)).slice(0, 24), [watchlist.data]);

  useImpressions(recs.data?.recommended);

  const onOpen = useCallback((item: BaseItem) => user && recordOpen(user.Id, item.Id), [user]);

  // Continue Watching and Next Up overlap for shows mid-episode; keep each once.
  const hiddenNextUp = useHiddenNextUp();
  const nextUpItems = useMemo(() => {
    const resumeIds = new Set((resume.data ?? []).map((i) => i.Id));
    return (nextUp.data ?? []).filter((i) => !resumeIds.has(i.Id) && !hiddenNextUp.isHidden(i));
  }, [resume.data, nextUp.data, hiddenNextUp]);

  // "Remove from row": Continue Watching forgets the resume point on the server; an
  // episode's show also leaves Next Up until you watch more of it.
  const queryClient = useQueryClient();
  const removeFromResume = useCallback(
    async (item: BaseItem) => {
      queryClient.setQueryData<BaseItem[]>(["home", "resume"], (list) => list?.filter((i) => i.Id !== item.Id));
      if (item.Type === "Episode") hiddenNextUp.hide(item);
      try {
        const undo = await clearResumePoint(item);
        showToast(`Removed ${item.Type === "Episode" ? (item.SeriesName ?? item.Name) : item.Name} from Continue Watching`, {
          label: "Undo",
          run: async () => {
            if (item.Type === "Episode") hiddenNextUp.unhide(item);
            await undo().catch(() => {});
            queryClient.invalidateQueries({ queryKey: ["home", "resume"] });
          },
        });
      } catch {
        showToast("Couldn't reach the server. Try again.");
        if (item.Type === "Episode") hiddenNextUp.unhide(item);
        queryClient.invalidateQueries({ queryKey: ["home", "resume"] });
      }
    },
    [queryClient, hiddenNextUp],
  );
  const removeFromNextUp = useCallback(
    (item: BaseItem) => {
      hiddenNextUp.hide(item);
      showToast(`Removed ${item.SeriesName ?? item.Name} from Next Up`, { label: "Undo", run: () => hiddenNextUp.unhide(item) });
    },
    [hiddenNextUp],
  );

  // "Play something": straight into a title picked from your recommendations.
  const navigate = useNavigate();
  const lastPick = useRef<string>(undefined);
  const playSomething = () => {
    const pick = pickSomething(
      (recs.data?.recommended ?? []).map((p) => p.item),
      lastPick.current,
    );
    if (!pick) return;
    lastPick.current = pick.Id;
    showToast(`Playing ${pick.Name}`);
    navigate(`/play/${pick.Id}`);
  };

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
              <MediaCard key={item.Id} item={item} variant="landscape" playOnClick onDismiss={removeFromResume} dismissLabel="Remove from Continue Watching" />
            ))}
          </Row>
        )}

        {(nextUp.isPending || nextUpItems.length > 0) && (
          <Row title="Next Up" variant="landscape" loading={nextUp.isPending}>
            {nextUpItems.map((item) => (
              <MediaCard key={item.Id} item={item} variant="landscape" playOnClick onDismiss={removeFromNextUp} dismissLabel="Remove from Next Up" />
            ))}
          </Row>
        )}

        {watchlistToWatch.length > 0 && (
          <Row title="Your Watchlist" seeAllTo="/watchlist">
            {watchlistToWatch.map((item) => (
              <MediaCard key={item.Id} item={item} />
            ))}
          </Row>
        )}

        {(recs.isLoading || (recs.data?.recommended.length ?? 0) > 0) && (
          <Row
            title="Recommended For You"
            eyebrow={recs.data && !recs.data.personalised ? "Start watching to personalise" : "For " + (user?.Name ?? "you")}
            loading={recs.isLoading}
            className="row--feature"
            actions={
              (recs.data?.recommended.length ?? 0) > 0 && (
                <button className="chip" onClick={playSomething} title="Start a title picked for you">
                  <Icon name="shuffle" size={16} /> Play something
                </button>
              )
            }
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

        {comingUp.cards.length > 0 && (
          <Row title="Coming Up" eyebrow="New episodes and seasons">
            {comingUp.cards.map((c) => (
              <MediaCard key={c.key} item={c.item} subtitle={c.subtitle} noPlay={c.external} remind />
            ))}
          </Row>
        )}

        {renderPersonal(0)}

        {hasAnime && (anime.isPending || (anime.data?.length ?? 0) > 0) && (
          <Row title="Your Anime" seeAllTo="/anime" loading={anime.isPending}>
            {anime.data?.map((item) => (
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

        {(movies.isPending || (movies.data?.length ?? 0) > 0) && (
          <Row title="Your Movies" seeAllTo="/movies" loading={movies.isPending}>
            {movies.data?.map((item) => (
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

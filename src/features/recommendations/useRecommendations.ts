import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { recommend, type RecommendationResult, type ScoredItem } from "./engine";
import { fetchHistory, fetchLibrary, fetchSignals, toEngineItem } from "./data";
import { dismiss, pullFromServer, readFeedback, subscribeFeedback } from "./feedback";

export interface UiPick {
  item: BaseItem;
  scored: ScoredItem;
}

export interface UiResult {
  recommended: UiPick[];
  discover: UiPick[];
  sections: { id: string; title: string; eyebrow: string; items: UiPick[] }[];
  personalised: boolean;
  topGenres: string[];
  raw: RecommendationResult;
}

/** Library + history are cached separately so a new watch only refetches history. */
export function useRecommendations() {
  const { user } = useAuth();
  const userId = user?.Id ?? "";

  const feedbackVersion = useSyncExternalStore(subscribeFeedback, () => JSON.stringify(readFeedback(userId).dismissed));

  useEffect(() => {
    if (userId) pullFromServer(userId);
  }, [userId]);

  const library = useQuery({ queryKey: ["rec", "library", userId], queryFn: fetchLibrary, staleTime: 10 * 60_000, enabled: Boolean(userId) });
  const history = useQuery({ queryKey: ["rec", "history", userId], queryFn: () => fetchHistory(), staleTime: 2 * 60_000, enabled: Boolean(userId) });

  const signals = useQuery({
    queryKey: ["rec", "signals", userId, history.data?.signature, library.data?.length],
    queryFn: () => fetchSignals(history.data!.signals, library.data!, readFeedback(userId)),
    enabled: Boolean(library.data && history.data),
    staleTime: 10 * 60_000,
  });

  const result = useMemo<UiResult | null>(() => {
    if (!library.data || !history.data || !signals.data) return null;
    const feedback = readFeedback(userId);
    const byId = new Map(library.data.map((i) => [i.Id, i]));
    const engineLibrary = library.data.map((item) => {
      const e = toEngineItem(item);
      if (history.data.startedSeries.has(item.Id)) e.episodesWatched = Math.max(1, e.episodesWatched ?? 0);
      return e;
    });
    const raw = recommend({ library: engineLibrary, history: history.data.signals, signals: signals.data, feedback });
    const toUi = (s: ScoredItem): UiPick | null => {
      const item = byId.get(s.item.id);
      return item ? { item, scored: s } : null;
    };
    const ui = (list: ScoredItem[]) => list.map(toUi).filter((p): p is UiPick => Boolean(p));
    return {
      recommended: ui(raw.recommended),
      discover: ui(raw.discover),
      sections: raw.sections.map((s) => ({ ...s, items: ui(s.items) })),
      personalised: raw.personalised,
      topGenres: [...raw.profile.genres.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([g]) => g),
      raw,
    };
    // feedbackVersion re-scores after a dismissal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.data, history.data, signals.data, userId, feedbackVersion]);

  return {
    data: result,
    isLoading: library.isPending || history.isPending || signals.isPending,
    error: library.error || history.error || signals.error,
    dismiss: (itemId: string) => dismiss(userId, itemId),
  };
}

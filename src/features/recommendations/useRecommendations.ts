import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { recommend, type Reason, type ScoredItem, type Strength } from "./engine";
import { fetchHistory, fetchLibrary, fetchSignals, toEngineItem } from "./data";
import { dismiss, pullFromServer, readFeedback, subscribeFeedback } from "./feedback";

export interface UiPick {
  item: BaseItem;
  reason: Reason;
  strength: Strength;
}

export interface UiResult {
  recommended: UiPick[];
  discover: UiPick[];
  sections: { id: string; title: string; eyebrow: string; items: UiPick[] }[];
  personalised: boolean;
  topGenres: string[];
  /** Movies + series per genre in this user's library (the server's own counts are unreliable). */
  genreCounts: Map<string, number>;
}

// ---- snapshot -------------------------------------------------------------------
// The library and history queries take seconds on a large server. The last result is
// kept per user and shown immediately on the next visit while a fresh one is computed.

const SNAPSHOT_VERSION = 1;
const snapshotKey = (userId: string) => `argent.rec.snapshot.${userId}`;

/** Card fields only; keeps the snapshot small. */
function trim(item: BaseItem): BaseItem {
  const { Overview: _o, Tags: _t, Studios: _s, People: _p, ...rest } = item;
  return rest;
}

function saveSnapshot(userId: string, r: UiResult) {
  const pick = (p: UiPick) => ({ ...p, item: trim(p.item) });
  try {
    localStorage.setItem(
      snapshotKey(userId),
      JSON.stringify({
        v: SNAPSHOT_VERSION,
        recommended: r.recommended.map(pick),
        discover: r.discover.map(pick),
        sections: r.sections.map((s) => ({ ...s, items: s.items.map(pick) })),
        personalised: r.personalised,
        topGenres: r.topGenres,
        genreCounts: [...r.genreCounts],
      }),
    );
  } catch {
    /* quota or private mode: just skip the snapshot */
  }
}

function readSnapshot(userId: string): UiResult | null {
  try {
    const s = JSON.parse(localStorage.getItem(snapshotKey(userId)) || "null");
    if (!s || s.v !== SNAPSHOT_VERSION) return null;
    return { ...s, genreCounts: new Map(s.genreCounts) };
  } catch {
    return null;
  }
}

/** Library + history are cached separately so a new watch only refetches history. */
export function useRecommendations() {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  const [snapshot] = useState(() => (userId ? readSnapshot(userId) : null));

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
    const ui = (list: ScoredItem[]) =>
      list.flatMap((s) => {
        const item = byId.get(s.item.id);
        return item ? [{ item, reason: s.reason, strength: s.strength }] : [];
      });
    return {
      recommended: ui(raw.recommended),
      discover: ui(raw.discover),
      sections: raw.sections.map((s) => ({ ...s, items: ui(s.items) })),
      personalised: raw.personalised,
      topGenres: [...raw.profile.genres.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([g]) => g),
      genreCounts: library.data.reduce((m, i) => {
        i.Genres?.forEach((g) => m.set(g, (m.get(g) ?? 0) + 1));
        return m;
      }, new Map<string, number>()),
    };
    // feedbackVersion re-scores after a dismissal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.data, history.data, signals.data, userId, feedbackVersion]);

  useEffect(() => {
    if (result && userId) saveSnapshot(userId, result);
  }, [result, userId]);

  // A dismissal made before the fresh result lands still hides the title.
  const dismissed = readFeedback(userId).dismissed;
  const fromSnapshot = useMemo(() => {
    if (!snapshot) return null;
    const keep = (p: UiPick) => !dismissed[p.item.Id];
    return {
      ...snapshot,
      recommended: snapshot.recommended.filter(keep),
      discover: snapshot.discover.filter(keep),
      sections: snapshot.sections.map((s) => ({ ...s, items: s.items.filter(keep) })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, feedbackVersion]);

  const data = result ?? fromSnapshot;
  return {
    data,
    isLoading: !data && (library.isPending || history.isPending || signals.isPending),
    error: library.error || history.error || signals.error,
    dismiss: (itemId: string) => dismiss(userId, itemId),
  };
}

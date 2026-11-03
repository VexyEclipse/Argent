// Rating preferences for this device, plus hooks for reading your ratings in components.

import { useSyncExternalStore } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { readRatings, subscribeRatings } from "./store";

export interface RatingPrefs {
  /** Ask after the last episode of each season, not only at the end of a series. */
  rateSeasons: boolean;
  /** Your score as a badge on posters across the app. */
  posterScores: boolean;
}

const KEY = "argent.ratingPrefs";
const DEFAULTS: RatingPrefs = { rateSeasons: true, posterScores: true };

let listeners = new Set<() => void>();
let cache: { raw: string | null; prefs: RatingPrefs } = { raw: null, prefs: DEFAULTS };

export function readRatingPrefs(): RatingPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  if (raw === cache.raw) return cache.prefs;
  let prefs = DEFAULTS;
  try {
    prefs = { ...DEFAULTS, ...JSON.parse(raw || "{}") };
  } catch {
    /* ignore */
  }
  cache = { raw, prefs };
  return prefs;
}

export function setRatingPref<K extends keyof RatingPrefs>(key: K, value: RatingPrefs[K]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readRatingPrefs(), [key]: value }));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

function subscribePrefs(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const useRatingPrefs = () => useSyncExternalStore(subscribePrefs, readRatingPrefs);

/** The signed-in user's ratings, re-rendering when they change. */
export function useRatings() {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  return useSyncExternalStore(subscribeRatings, () => readRatings(userId));
}

/** Your score for one title when poster badges are on. */
export function usePosterScore(itemId: string): number | undefined {
  const prefs = useRatingPrefs();
  const ratings = useRatings();
  return prefs.posterScores ? ratings.ratings[itemId]?.stars : undefined;
}

export function resetPrefListeners() {
  listeners = new Set();
}

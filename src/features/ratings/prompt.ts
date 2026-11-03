// The one pending "What would you rate X?" prompt. The player queues it on the way
// out; the shell shows it on whatever page playback returns to. Kept in
// sessionStorage so a reload on the way home doesn't lose it.

import type { RateTarget } from "./logic";

const KEY = "argent.ratePrompt";

let listeners = new Set<() => void>();
let pending: RateTarget | null = load();

function load(): RateTarget | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) || "null");
    return parsed?.id && parsed?.name ? parsed : null;
  } catch {
    return null;
  }
}

function set(target: RateTarget | null) {
  pending = target;
  try {
    if (target) sessionStorage.setItem(KEY, JSON.stringify(target));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export const queueRatePrompt = (target: RateTarget) => set(target);
export const clearRatePrompt = () => set(null);
export const readRatePrompt = () => pending;

export function subscribeRatePrompt(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

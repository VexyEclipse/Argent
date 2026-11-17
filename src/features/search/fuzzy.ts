// Finding a title despite a typo or two ("frieran" → Frieren, "intresteller" →
// Interstellar), over the library index. No DOM, no network.

import { editDistance, normaliseTitle, titleWords, typoAllowance } from "@/api/titles";

export interface Named {
  id: string;
  name: string;
  original?: string;
}

const MINOR = new Set(["the", "a", "an", "of", "and"]);

/** How well one typed word matches one word of a title, 0–1. */
function wordScore(typed: string, word: string): number {
  if (typed === word) return 1;
  if (typed.length >= 3 && word.startsWith(typed)) return 0.92;
  const allow = typoAllowance(Math.max(typed.length, word.length));
  if (allow) {
    const d = editDistance(typed, word, allow);
    if (d <= allow) return 1 - d * 0.18;
  }
  // Still typing a long word, with a typo in it ("interst" for "interstellar").
  if (typed.length >= 4 && word.length > typed.length) {
    const head = word.slice(0, typed.length);
    const d = editDistance(typed, head, typoAllowance(typed.length));
    if (d <= typoAllowance(typed.length)) return 0.78 - d * 0.1;
  }
  return 0;
}

/** How well a search matches a title, 0–1 (0: not a match). */
export function titleScore(query: string, name: string): number {
  const q = normaliseTitle(query);
  const n = normaliseTitle(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  if (n.startsWith(q) && q.length >= 3) return 0.95;
  if (n.includes(q) && q.length >= 4) return 0.88;
  // As one string: typos in a single-word title, or spaces in the wrong place ("spider man").
  const allow = typoAllowance(q.length);
  if (allow && Math.abs(q.length - n.length) <= allow) {
    const d = editDistance(q, n, allow);
    if (d <= allow) return 0.9 - d * 0.08;
  }
  // Word by word: every word typed must find its word in the title.
  let typed = titleWords(query);
  if (typed.length > 1) typed = typed.filter((w) => !MINOR.has(w));
  const words = titleWords(name);
  if (!typed.length || !words.length) return 0;
  let total = 0;
  for (const t of typed) {
    let best = 0;
    for (const w of words) best = Math.max(best, wordScore(t, w));
    if (!best) return 0;
    total += best;
  }
  // A title with many more words than were typed is a weaker match.
  const coverage = Math.min(1, typed.length / Math.max(1, words.filter((w) => !MINOR.has(w)).length));
  return (total / typed.length) * (0.78 + 0.12 * coverage);
}

/** The titles a search most likely meant, best first. */
export function fuzzyFind<T extends Named>(query: string, entries: T[], opts: { limit?: number; min?: number } = {}): { entry: T; score: number }[] {
  const min = opts.min ?? 0.62;
  if (normaliseTitle(query).length < 3) return [];
  const out: { entry: T; score: number }[] = [];
  for (const e of entries) {
    const score = Math.max(titleScore(query, e.name), e.original ? titleScore(query, e.original) : 0);
    if (score >= min) out.push({ entry: e, score });
  }
  out.sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length);
  return out.slice(0, opts.limit ?? 24);
}

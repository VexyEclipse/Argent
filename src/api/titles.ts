// Title comparison shared by Top 10 matching and Smart Search: case, accents, punctuation
// and "&" vs "and" don't count. No DOM, no network.

/**
 * "Frieren: Beyond Journey's End" → "frierenbeyondjourneysend". Letters of every script
 * count ("3月のライオン" isn't just "3").
 */
export function normaliseTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The words of a title, lower case and without accents. */
export function titleWords(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const ORDINAL_SEASON = /\s*[:\-–—]?\s*(?:the\s+)?(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|final)\s+(?:season|cour|part)\b.*$/i;
const NUMBERED_PART = /\s*[:\-–—]?\s*(?:season|part|cour)\s*(?:\d+|[ivx]+)\b.*$/i;
const ROMAN_TAIL = /\s+(?:ii|iii|iv|v|vi)$/i;

/**
 * A title without its season or part ("Jujutsu Kaisen Season 2", "Attack on Titan: The
 * Final Season", "Overlord IV" → the show's own name). A plain trailing number stays:
 * it's often part of the name ("Kaiju No. 8").
 */
export function baseTitle(s: string): string {
  return s.replace(ORDINAL_SEASON, "").replace(NUMBERED_PART, "").replace(ROMAN_TAIL, "").trim();
}

/** Edit distance with swaps of two neighbouring letters counted once (Damerau, restricted). */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push([i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/** How many typos a word of this length may have and still count: none for short words. */
export function typoAllowance(length: number): number {
  if (length < 4) return 0;
  if (length < 8) return 1;
  return 2;
}

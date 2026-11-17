// Smart Search: what a search like "90s comedies under 2 hours", "anime from MAPPA",
// "unwatched films with Tom Hanks" or "something like Interstellar" asks for, as filters
// Argent already has. Plain titles are left alone. No DOM, no network.

import { normaliseTitle } from "@/api/titles";

export type Kind = "Movie" | "Series" | "Anime";
export type SmartSort = "rating" | "newest" | "oldest" | "random" | "shortest";

export interface Chip {
  key: string;
  label: string;
  /** Where it was said in the search, so removing the chip removes those words. */
  span: [number, number];
}

export interface SmartQuery {
  /** Words that aren't a filter: matched against titles. */
  text: string;
  kinds: Kind[];
  /** Each group is one thing asked for ("comedy"); an item needs a genre from every group. */
  genres: string[][];
  years?: { from: number; to: number };
  minMinutes?: number;
  maxMinutes?: number;
  minRating?: number;
  played?: boolean;
  favorite?: boolean;
  /** "with Tom Hanks", "directed by Nolan". */
  person?: string;
  /** "from MAPPA", "by A24": a studio or a person, whichever the library has. */
  maker?: string;
  /** "like Interstellar". */
  like?: string;
  sort?: SmartSort;
  chips: Chip[];
}

/** Whether the search asked for anything beyond a title. */
export const isSmart = (q: SmartQuery) => q.chips.length > 0;

// ---- vocabulary --------------------------------------------------------------------------

/**
 * What people call a genre, and what servers name it (matched inside genre names). A
 * nested list asks for several genres at once: a romantic comedy is a romance and a comedy.
 */
const GENRE_WORDS: [RegExp, string[] | string[][], string][] = [
  [/\b(?:rom-?coms?|romantic comed(?:y|ies))\b/, [["romance"], ["comedy"]], "Romantic comedy"],
  [/\b(?:comed(?:y|ies)|funny|hilarious|sitcoms?)\b/, ["comedy"], "Comedy"],
  [/\b(?:horrors?|scary|spooky|frightening)\b/, ["horror"], "Horror"],
  [/\b(?:sci-?fi|science[- ]fiction|sci fi)\b/, ["sciencefiction", "scifi"], "Science fiction"],
  [/\b(?:thrillers?|suspense(?:ful)?)\b/, ["thriller", "suspense"], "Thriller"],
  [/\b(?:romance|romantic|love stor(?:y|ies))\b/, ["romance"], "Romance"],
  [/\baction(?:-packed)?\b/, ["action"], "Action"],
  [/\badventures?\b/, ["adventure"], "Adventure"],
  [/\b(?:animated|animation|cartoons?)\b/, ["animation"], "Animation"],
  [/\b(?:documentar(?:y|ies)|docs|docuseries)\b/, ["documentary"], "Documentary"],
  [/\b(?:dramas?|dramatic)\b/, ["drama"], "Drama"],
  [/\bfantasy\b/, ["fantasy"], "Fantasy"],
  [/\b(?:crime|heists?|gangsters?)\b/, ["crime"], "Crime"],
  [/\b(?:myster(?:y|ies)|whodunn?its?|detective)\b/, ["mystery"], "Mystery"],
  [/\b(?:family|for kids|kids|children'?s)\b/, ["family", "kids", "children"], "Family"],
  [/\bwar\b/, ["war"], "War"],
  [/\bwesterns?\b/, ["western"], "Western"],
  [/\b(?:historical|history)\b/, ["history"], "History"],
  [/\b(?:musicals?)\b/, ["musical", "music"], "Musical"],
  [/\bsports?\b/, ["sport"], "Sport"],
];

const KIND_WORDS: [RegExp, Kind, string][] = [
  [/\b(?:movies?|films?|flicks?)\b/, "Movie", "Films"],
  [/\b(?:tv shows?|tv series|series|shows?|tv)\b/, "Series", "Series"],
  [/\banime\b/, "Anime", "Anime"],
];

/** Words that only glue a search together ("show me some …"). */
const FILLER = new Set(
  "a an the some any something anything stuff me show find i want wanna to watch for with in of from and or that is are be good great nice please ones one get give me let's lets that's".split(
    " ",
  ),
);

const NUMBER_WORDS: Record<string, number> = { an: 1, a: 1, one: 1, two: 2, three: 3, four: 4 };

/** "2 hours", "90 min", "1h30", "an hour and a half", "two hours" → minutes. */
export function parseDuration(text: string): number | undefined {
  const t = text.toLowerCase().trim();
  let m = /^(\d+)\s*h(?:ours?|rs?)?\s*(\d{1,2})\s*(?:m(?:in(?:ute)?s?)?)?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?|an?|one|two|three|four)\s*(?:h|hrs?|hours?)(\s+and\s+a\s+half)?$/.exec(t);
  if (m) return Math.round((NUMBER_WORDS[m[1]] ?? Number(m[1])) * 60 + (m[2] ? 30 : 0));
  m = /^(\d+)\s*(?:m|mins?|minutes?)$/.exec(t);
  if (m) return Number(m[1]);
  if (/^(?:half an hour|30 minutes)$/.test(t)) return 30;
  return undefined;
}

const DURATION = String.raw`(?:\d+\s*h(?:ours?|rs?)?\s*\d{1,2}\s*(?:m(?:in(?:ute)?s?)?)?|(?:\d+(?:\.\d+)?|an?|one|two|three|four)\s*(?:h|hrs?|hours?)(?:\s+and\s+a\s+half)?|\d+\s*(?:m|mins?|minutes?)|half an hour)`;

const DECADE_WORDS: Record<string, number> = { fifties: 1950, sixties: 1960, seventies: 1970, eighties: 1980, nineties: 1990 };

function decadeStart(raw: string): number | undefined {
  const t = raw
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/['’]/g, "");
  if (t in DECADE_WORDS) return DECADE_WORDS[t];
  const m = /^(19|20)?(\d)0s$/.exec(t);
  if (!m) return undefined;
  const d = Number(m[2]);
  if (m[1]) return Number(`${m[1]}${d}0`);
  return d >= 3 ? 1900 + d * 10 : 2000 + d * 10;
}

// ---- parsing ---------------------------------------------------------------------------

const yearsLabel = (from: number, to: number) =>
  from === to ? String(from) : from <= 1800 ? `Before ${to + 1}` : to >= 2100 ? `${from} or later` : `${from}–${to}`;
const hours = (min: number) => (min % 60 === 0 ? `${min / 60} h` : min > 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min} min`);
const title = (s: string) => s.replace(/\s+/g, " ").trim();

export function parseSmartQuery(input: string, opts: { genres?: string[]; now?: Date } = {}): SmartQuery {
  const q: SmartQuery = { text: "", kinds: [], genres: [], chips: [] };
  const thisYear = (opts.now ?? new Date()).getFullYear();
  // Matched words are blanked out (same length), so later rules and spans line up.
  let rest = input;
  const lower = () => rest.toLowerCase();
  const blank = (start: number, end: number) => {
    rest = rest.slice(0, start) + " ".repeat(end - start) + rest.slice(end);
  };
  const chip = (key: string, label: string, start: number, end: number) => {
    q.chips.push({ key, label, span: [start, end] });
    blank(start, end);
  };
  /** Runs a rule over what's left; `found` gets the match and where it starts. */
  const each = (re: RegExp, found: (m: RegExpExecArray, start: number, end: number) => boolean | void) => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const text = lower();
    const hits: RegExpExecArray[] = [];
    for (let m = g.exec(text); m; m = g.exec(text)) {
      hits.push(m);
      if (m[0] === "") g.lastIndex++;
    }
    for (const m of hits) found(m, m.index, m.index + m[0].length);
  };
  const original = (start: number, end: number) => title(input.slice(start, end));
  const STOP = String.raw`(?=\s+(?:from|in|under|over|rated|before|after|between|since|that|which|and|or|i|we|you)\b|[,.;!?]|\s*$)`;

  // "something like Interstellar": at the start, or after a kind ("anime like …"), so a
  // title with "like" in it ("Some Like It Hot") stays a title.
  each(/(^\s*|\b(?:something|anything|stuff|movies?|films?|shows?|series|anime|ones?)\s+)(like|similar to)\s+(\S.*?)\s*$/i, (m, start, end) => {
    const from = start + m[1].length;
    const what = original(from + m[2].length, end);
    if (!what) return;
    q.like = what;
    chip("like", `Like ${what}`, from, end);
  });

  each(new RegExp(String.raw`\b(with|starring|featuring|feat\.?|directed by|director)\s+(\S.*?)${STOP}`, "i"), (m, start, end) => {
    const who = original(start + m[0].length - m[2].length, end);
    if (!who || FILLER.has(who.toLowerCase())) return;
    q.person = who;
    chip("person", `${m[1].toLowerCase().startsWith("direct") ? "Directed by" : "With"} ${who}`, start, end);
  });

  // Years: ranges, then open-ended, then decades, then single years.
  const setYears = (from: number, to: number, start: number, end: number) => {
    if (q.years) return blank(start, end);
    q.years = { from: Math.min(from, to), to: Math.max(from, to) };
    chip("years", yearsLabel(q.years.from, q.years.to), start, end);
  };
  each(/\b(?:between|from)?\s*((?:19|20)\d{2})\s*(?:-|–|to|and|until)\s*((?:19|20)\d{2})\b/i, (m, s, e) => setYears(Number(m[1]), Number(m[2]), s, e));
  each(/\b(before|older than|prior to|until)\s+((?:19|20)\d{2})\b/i, (m, s, e) => setYears(1800, Number(m[2]) - 1, s, e));
  each(/\b(after|since|newer than|from)\s+((?:19|20)\d{2})\b(?!\s*(?:-|–|to)\s*\d)/i, (m, s, e) => {
    const y = Number(m[2]);
    if (m[1].toLowerCase() === "from") setYears(y, y, s, e);
    else setYears(m[1].toLowerCase() === "after" ? y + 1 : y, 2100, s, e);
  });
  each(/\b(?:(?:from|in)\s+)?(?:the\s+)?(?:(?:19|20)?\d0['’]?s|fifties|sixties|seventies|eighties|nineties)\b/i, (m, s, e) => {
    const word = /(?:the\s+)?((?:19|20)?\d0['’]?s|fifties|sixties|seventies|eighties|nineties)$/i.exec(m[0]);
    const start = word ? decadeStart(word[1]) : undefined;
    if (start !== undefined) setYears(start, start + 9, s, e);
  });
  let bareYear: { start: number; end: number } | null = null;
  each(/\b(?:(?:from|in|released in|made in|of)\s+)?((?:19|20)\d{2})\b/i, (m, s, e) => {
    if (q.years) return;
    const y = Number(m[1]);
    if (y > thisYear + 2) return;
    // "2019 thrillers" is a year; "Blade Runner 2049" and "1917" are titles. Decided at the end.
    if (m[0].length === m[1].length) bareYear = { start: s, end: e };
    setYears(y, y, s, e);
  });
  each(
    /\b(brand new|newest|latest|recent(?:ly released)?|new)\b(?=\s+(?:movies?|films?|shows?|series|anime|releases?|comed(?:y|ies)|horrors?|thrillers?|dramas?|documentar(?:y|ies))\b)|\b(?:recent(?:ly released)?|latest)\b/i,
    (_m, s, e) => {
      if (q.years) return blank(s, e);
      q.sort ??= "newest";
      setYears(thisYear - 2, thisYear, s, e);
    },
  );
  each(/\bclassics\b|\b(?:old|classic)\b(?=\s+(?:movies?|films?|shows?|series|anime|comed(?:y|ies)|horrors?|westerns?|dramas?)\b)/i, (_m, s, e) => {
    setYears(1800, 1979, s, e);
  });

  // "from MAPPA", "by Christopher Nolan": a studio or a person.
  each(new RegExp(String.raw`\b(?:made by|produced by|animated by|from|by)\s+(?!(?:the\s+)?(?:\d|19|20))(\S.*?)${STOP}`, "i"), (m, start, end) => {
    if (q.maker) return;
    const who = original(end - m[1].length, end);
    if (!who || FILLER.has(who.toLowerCase())) return;
    q.maker = who;
    chip("maker", `From ${who}`, start, end);
  });

  // Running time.
  each(new RegExp(String.raw`\b(under|less than|shorter than|below|at most|max(?:imum)?|up to|within)\s+(${DURATION})(?:\s+long)?\b`, "i"), (m, s, e) => {
    const min = parseDuration(m[2]);
    if (!min || q.maxMinutes) return;
    q.maxMinutes = min;
    chip("runtime", `Under ${hours(min)}`, s, e);
  });
  each(new RegExp(String.raw`\b(over|more than|longer than|at least|above)\s+(${DURATION})(?:\s+long)?\b`, "i"), (m, s, e) => {
    const min = parseDuration(m[2]);
    if (!min || q.minMinutes) return;
    q.minMinutes = min;
    chip("runtime-min", `Over ${hours(min)}`, s, e);
  });
  each(/\b(short)\b(?=\s+(?:movies?|films?|shows?|series|anime|comed(?:y|ies)|horrors?|episodes?)\b|\s*$)/i, (_m, s, e) => {
    if (q.maxMinutes) return;
    q.maxMinutes = 95;
    chip("runtime", "Short", s, e);
  });
  each(/\b(long|epic)\b(?=\s+(?:movies?|films?)\b)/i, (_m, s, e) => {
    if (q.minMinutes) return;
    q.minMinutes = 150;
    chip("runtime-min", "Long", s, e);
  });

  // Ratings.
  each(
    /\b(?:rated|rating|score[ds]?)\s*(?:of\s+|above\s+|over\s+|at least\s+|>=?\s*)?(\d(?:\.\d)?)\s*(?:\+|\/10|or (?:more|higher|better|above))?|\b(\d(?:\.\d)?)\s*\+\s*(?:rated|rating|stars?)?/i,
    (m, s, e) => {
      const n = Number(m[1] ?? m[2]);
      if (!(n > 0 && n <= 10) || q.minRating) return;
      q.minRating = n;
      chip("rating", `Rated ${n}+`, s, e);
    },
  );
  each(/\b(?:highly rated|top[- ]rated|best[- ]rated|highest[- ]rated|critically acclaimed|acclaimed|well[- ]reviewed|best)\b(?=\s|$)/i, (m, s, e) => {
    // "best" only as a word on its own ("the best horror"), never inside a title search.
    if (
      m[0].toLowerCase() === "best" &&
      !/^\s*(?:the\s+)?$/.test(
        lower()
          .slice(0, s)
          .replace(/\b(?:show me|find|me)\b/g, ""),
      )
    )
      return;
    q.sort = "rating";
    if (!q.minRating) q.minRating = 7.5;
    chip("rating", "Highly rated", s, e);
  });

  // Watched, favourites.
  each(/\b(?:unwatched|unseen|not (?:yet )?(?:watched|seen)|(?:i\s+)?(?:have ?n[o']?t|never)\s+(?:seen|watched)(?:\s+yet)?|new to me)\b/i, (_m, s, e) => {
    if (q.played !== undefined) return;
    q.played = false;
    chip("played", "Unwatched", s, e);
  });
  each(/\b(?:(?:i(?:'ve| have)\s+)?(?:already\s+)?(?:watched|seen)|rewatch(?:es)?|to rewatch)\b/i, (_m, s, e) => {
    if (q.played !== undefined) return;
    q.played = true;
    chip("played", "Watched", s, e);
  });
  each(/\b(?:my\s+)?(?:favou?rites?|favs?|faves?)\b/i, (_m, s, e) => {
    if (q.favorite) return;
    q.favorite = true;
    chip("favorite", "Favourites", s, e);
  });

  // Order.
  each(/\b(?:newest|latest|most recent)(?:\s+first)?\b/i, (_m, s, e) => {
    q.sort = "newest";
    chip("sort", "Newest first", s, e);
  });
  each(/\boldest(?:\s+first)?\b/i, (_m, s, e) => {
    q.sort = "oldest";
    chip("sort", "Oldest first", s, e);
  });
  each(/\b(?:random(?:ly)?|surprise me|at random)\b/i, (_m, s, e) => {
    q.sort = "random";
    chip("sort", "Random", s, e);
  });
  each(/\bshortest(?:\s+first)?\b/i, (_m, s, e) => {
    q.sort = "shortest";
    chip("sort", "Shortest first", s, e);
  });

  // Genres: what people say, then any genre the server has by name ("Isekai").
  for (const [re, keys, label] of GENRE_WORDS) {
    each(re, (_m, s, e) => {
      if (q.genres.length >= 3 || q.chips.some((c) => c.label === label)) return blank(s, e);
      const asked = (Array.isArray(keys[0]) ? keys : [keys]) as string[][];
      for (const alternatives of asked) {
        const group = (opts.genres ?? []).filter((g) => alternatives.some((k) => normaliseTitle(g).includes(k)));
        q.genres.push(group.length ? group : [alternatives[0].replace(/^./, (c) => c.toUpperCase())]);
      }
      chip("genre", label, s, e);
    });
  }
  for (const g of [...(opts.genres ?? [])].sort((a, b) => b.length - a.length)) {
    // Proper genres only (lowercase entries are imported tags), and not "Anime" or "TV":
    // those say which kind of title.
    if (g.length < 3 || !/^\p{Lu}/u.test(g) || KIND_WORDS.some(([re]) => re.test(g.toLowerCase()) && g.split(/\s+/).length === 1)) continue;
    const escaped = g
      .toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    each(new RegExp(String.raw`\b${escaped}s?\b`, "i"), (_m, s, e) => {
      if (q.genres.some((group) => group.includes(g))) return blank(s, e);
      q.genres.push([g]);
      chip("genre", g, s, e);
    });
  }

  // Films, series, anime.
  for (const [re, kind, label] of KIND_WORDS) {
    each(re, (_m, s, e) => {
      // A kind on its own ("series") is a filter only beside other filters: decided below.
      if (!q.kinds.includes(kind)) {
        q.kinds.push(kind);
        chip("kind", label, s, e);
      } else blank(s, e);
    });
  }

  // What's left is a title, minus the glue words.
  const leftover = () =>
    rest
      .split(/\s+/)
      .filter((w) => w && !FILLER.has(w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")))
      .join(" ")
      .replace(/^[,.;:!?\s]+|[,.;:!?\s]+$/g, "");
  // Nothing but a title: all of it, glue words too ("Some Like It Hot").
  q.text = q.chips.length ? leftover() : title(input);

  // A bare year beside a title ("Blade Runner 2049") belongs to the title.
  const year = bareYear as { start: number; end: number } | null;
  if (year && q.text) {
    rest = rest.slice(0, year.start) + input.slice(year.start, year.end) + rest.slice(year.end);
    q.years = undefined;
    q.chips = q.chips.filter((c) => c.key !== "years");
    q.text = q.chips.length ? leftover() : title(input);
  }
  return q;
}

// Skips Argent works out for itself when the server has none (Settings → Skipping → Learn
// skips): chapters named like an opening, ending, recap or preview, and the stretch you
// keep jumping over near the start of a season's episodes. Pure rules, covered by
// skipLearning.test.ts; learnedSkips.ts keeps what's learned and wires it to the player.

import type { BaseItem, MediaSegment } from "@/api/types";

const TICKS = 10_000_000;

/** Seeks this close together (ms) are one jump: pressing → nine times skips one intro. */
export const JUMP_WINDOW_MS = 4000;
/** How far apart (seconds) two episodes' jumps can start and end and still be the same intro. */
export const MATCH_TOLERANCE = 10;
/** The shortest and longest stretch (seconds) taken for an intro. */
export const MIN_SKIP = 20;
export const MAX_SKIP = 240;
/** An intro starts in the first ten minutes (and the first half of the episode). */
const LATEST_INTRO_START = 600;
/** Jumps kept per season, one per episode. */
const MAX_JUMPS = 6;
/** Episodes within this share of the length a skip was saved on get it. */
const SAME_LENGTH = 0.25;
/** Times a season's learned skip is offered before Argent stops asking. */
export const MAX_ASKS = 2;

// ---- chapter names ---------------------------------------------------------------------

type Kind = "Intro" | "Recap" | "Preview" | "Outro";

/** Lower-case, without numbers ("OP2"), song titles ("OP - Unravel") or notes ("(Creditless)"). */
function plainName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[([{].*$/u, "")
    .replace(/\s[-–—:|].*$/u, "")
    .replace(/\d+/gu, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// "Intro" and "Outro" are left out on purpose: anime releases use "Intro" for the cold open
// before the "Opening", and "Outro" for a scene after the "Ending".
const INTRO = new Set(["op", "opening", "opening credits", "opening theme", "opening song", "opening titles", "main titles", "main title", "title sequence", "theme song", "オープニング"]);
const RECAP = new Set(["recap", "previously", "previously on", "the story so far", "story so far", "あらすじ"]);
const PREVIEW = new Set(["preview", "preview start", "pv", "next", "next episode preview", "episode preview", "next episode", "next time", "next time on", "予告", "次回予告"]);
const CREDITS = new Set(["credits", "credits start", "end credits", "closing credits", "ending credits", "staff credits"]);
/** In an episode these are the ending song; in a film, "Ending" may be the last scene. */
const EPISODE_ENDING = new Set(["ed", "ending", "ending theme", "ending song", "エンディング"]);
/** Chapters that only mark where something stops ("Credits Start" … "Credits End"). */
const END_MARKERS = new Set(["credits end", "preview end", "end"]);

function chapterKind(name: string | undefined, episode: boolean): Kind | "marker" | undefined {
  if (!name) return undefined;
  const n = plainName(name);
  if (!n) return undefined;
  if (INTRO.has(n)) return "Intro";
  if (RECAP.has(n) || n.startsWith("previously on ")) return "Recap";
  if (PREVIEW.has(n) || n.startsWith("next time on ")) return "Preview";
  if (CREDITS.has(n) || (episode && EPISODE_ENDING.has(n))) return "Outro";
  if (END_MARKERS.has(n)) return "marker";
  return undefined;
}

/** Sensible lengths (seconds) per kind; anything else is a mislabelled chapter. */
const LENGTHS: Record<Kind, [number, number]> = { Intro: [10, MAX_SKIP], Recap: [10, 360], Preview: [5, 180], Outro: [10, 900] };

/**
 * Skips read from chapter names: each named chapter runs to the next one (the last to the
 * end). An opening or recap must sit in the first half and an ending or preview in the
 * second. The credits only count when nothing but a preview (or a marker such as "Credits
 * End") follows them, since skipping the credits goes to the next episode and would pass
 * over a scene after them.
 */
export function chapterSegments(chapters: BaseItem["Chapters"], durationSeconds: number, episode: boolean, itemId: string): MediaSegment[] {
  const list = (chapters ?? []).map((c) => ({ start: c.StartPositionTicks / TICKS, kind: chapterKind(c.Name, episode) })).sort((a, b) => a.start - b.start);
  const out: MediaSegment[] = [];
  list.forEach((c, i) => {
    const kind = c.kind;
    if (!kind || kind === "marker" || out.some((s) => s.Type === kind)) return;
    const end = list[i + 1]?.start ?? durationSeconds;
    const length = end - c.start;
    const [min, max] = LENGTHS[kind];
    if (!durationSeconds || length < min || length > max) return;
    const firstHalf = c.start < durationSeconds / 2;
    if ((kind === "Intro" || kind === "Recap") !== firstHalf) return;
    if (kind === "Outro" && list.slice(i + 1).some((after) => after.kind !== "Preview" && after.kind !== "marker")) return;
    out.push({
      Id: `chapter-${kind}-${Math.round(c.start)}`,
      ItemId: itemId,
      Type: kind,
      StartTicks: Math.round(c.start * TICKS),
      EndTicks: Math.round(end * TICKS),
      Source: "chapter",
    });
  });
  return out;
}

/**
 * The server's skips, plus found ones of a kind it doesn't have (in the order given, so a
 * chapter's opening wins over a learned one). Nothing until the server has answered, so a
 * found skip never shows and then gives way.
 */
export function withFoundSegments(server: readonly MediaSegment[] | undefined, found: readonly MediaSegment[]): MediaSegment[] | undefined {
  if (!server) return undefined;
  const out = [...server];
  for (const s of found) if (!out.some((o) => o.Type === s.Type)) out.push(s);
  return out.length === server.length ? (server as MediaSegment[]) : out;
}

// ---- learning from the viewer -----------------------------------------------------------

export interface Jump {
  /** The episode it was made in. */
  ep: string;
  from: number;
  to: number;
  /** When (ms since epoch). */
  at: number;
}

export interface Range {
  start: number;
  end: number;
}

/** What one season has taught Argent, kept in the viewer's account. */
export interface SeasonSkips {
  jumps: Jump[];
  /** Confirmed: offered as an intro in every episode. */
  range?: Range;
  /** What the viewer called it ("Opening"); "Intro" when unnamed. */
  name?: string;
  /** Skip it without asking. */
  auto?: boolean;
  /** How long (seconds) the episode it was saved in runs, to leave out specials of another length. */
  ref?: number;
  /** For the list of skips: the show and season it's for, as when it was saved. */
  show?: string;
  seasonName?: string;
  seriesId?: string;
  /** How often the skip has been offered. */
  asked?: number;
}

export interface SavedSkip {
  key: string;
  entry: SeasonSkips & { range: Range };
}

/** The seasons with a skip, by show and then season ("Season 2" before "Season 10"). */
export function savedSkips(map: Record<string, SeasonSkips>): SavedSkip[] {
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return Object.entries(map)
    .filter((e): e is [string, SeasonSkips & { range: Range }] => Boolean(e[1]?.range))
    .map(([key, entry]) => ({ key, entry }))
    // Skips saved without a show name (resolved when listed) go last.
    .sort((a, b) => Number(!a.entry.show) - Number(!b.entry.show) || order.compare(a.entry.show ?? "", b.entry.show ?? "") || order.compare(a.entry.seasonName ?? "", b.entry.seasonName ?? "") || a.key.localeCompare(b.key));
}

/** Learning is per season: its episodes share an opening. */
export function seasonKey(item: Pick<BaseItem, "Type" | "SeriesId" | "SeasonId" | "ParentIndexNumber">): string | undefined {
  if (item.Type !== "Episode" || !item.SeriesId) return undefined;
  return item.SeasonId ?? `${item.SeriesId}:${item.ParentIndexNumber ?? 0}`;
}

export interface OpenJump {
  from: number;
  to: number;
  /** When the last seek of it was made (ms). */
  at: number;
}

/**
 * A seek the viewer made. It carries on the jump in progress when it follows quickly from
 * where that one landed (pressing → nine times, or nudging back after overshooting), and
 * otherwise starts a new one. A jump that ends up going backwards is dropped.
 */
export function continueJump(open: OpenJump | null, from: number, to: number, now: number): OpenJump | null {
  const continues = open && now - open.at < JUMP_WINDOW_MS && Math.abs(from - open.to) <= JUMP_WINDOW_MS / 1000 + 2;
  const start = continues ? open.from : from;
  return to > start ? { from: start, to, at: now } : null;
}

/** Could this jump be skipping an intro: the right length, near the start? */
export function isIntroJump(from: number, to: number, durationSeconds: number): boolean {
  const length = to - from;
  const latest = durationSeconds > 0 ? Math.min(LATEST_INTRO_START, durationSeconds / 2) : LATEST_INTRO_START;
  return length >= MIN_SKIP && length <= MAX_SKIP && from <= latest;
}

/** Adds a jump, replacing an earlier one in the same episode and keeping the latest few. */
export function recordJump(entry: SeasonSkips | undefined, jump: Jump): SeasonSkips {
  const jumps = [...(entry?.jumps ?? []).filter((j) => j.ep !== jump.ep), jump].slice(-MAX_JUMPS);
  return { ...entry, jumps };
}

/**
 * The stretch to offer once the viewer has jumped over about the same part of two
 * different episodes: only what every one of those jumps passed over, so a skip never takes
 * more than they did. Nothing for a season that already has one.
 */
export function matchedRange(entry: SeasonSkips, jump: Jump): Range | undefined {
  if (entry.range) return undefined;
  const near = (j: Jump) => Math.abs(j.from - jump.from) <= MATCH_TOLERANCE && Math.abs(j.to - jump.to) <= MATCH_TOLERANCE;
  const others = entry.jumps.filter((j) => j.ep !== jump.ep && near(j));
  if (!others.length) return undefined;
  const all = [jump, ...others];
  const start = Math.max(...all.map((j) => j.from));
  const end = Math.min(...all.map((j) => j.to));
  return end - start >= MIN_SKIP ? { start: round(start), end: round(end) } : undefined;
}

/** A season's confirmed skip as an intro in one of its episodes, with its name and whether it asks first (see autoSkipNow). */
export function learnedSegment(entry: SeasonSkips | undefined, itemId: string, durationSeconds: number): MediaSegment | undefined {
  const r = entry?.range;
  // Learned skips are at least MIN_SKIP long; one set by hand can be shorter.
  if (!r || r.end - r.start < MIN_EDITED) return undefined;
  if (durationSeconds > 0) {
    if (r.end > durationSeconds) return undefined;
    // A special or double episode isn't laid out like the rest of the season.
    if (entry!.ref ? Math.abs(durationSeconds - entry!.ref) > entry!.ref * SAME_LENGTH : r.end >= durationSeconds / 2) return undefined;
  }
  return {
    Id: `learned-${r.start}-${r.end}`,
    ItemId: itemId,
    Type: "Intro",
    StartTicks: Math.round(r.start * TICKS),
    EndTicks: Math.round(r.end * TICKS),
    Source: "learned",
    Label: entry.name,
    Auto: entry.auto || undefined,
  };
}

// ---- editing a skip by hand -------------------------------------------------------------

/** The shortest skip the editor allows (seconds). */
export const MIN_EDITED = 1;
/** What the editor's arrows move an edge by (seconds). */
export const NUDGE = 0.5;

/** One edge moved to a time, kept inside the episode and after (or before) the other edge. */
export function editedRange(range: Range, edge: "start" | "end", value: number, durationSeconds: number): Range {
  const last = durationSeconds > 0 ? durationSeconds : Infinity;
  const v = round(Math.min(last, Math.max(0, value)));
  if (edge === "start") return { start: Math.max(0, Math.min(v, round(range.end - MIN_EDITED))), end: range.end };
  return { start: range.start, end: Math.min(last, Math.max(v, round(range.start + MIN_EDITED))) };
}

/** Names are short, for a button: "Skip Opening". */
export const MAX_NAME_LENGTH = 24;

/** A typed name, tidied; undefined for none (or "Intro", the default). */
export function cleanSkipName(text: string): string | undefined {
  const name = text.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim();
  return name && name.toLowerCase() !== "intro" ? name : undefined;
}

/** "2:12.8": a time to the tenth of a second. */
export function formatSkipTime(seconds: number): string {
  const r = round(Math.max(0, seconds));
  const whole = Math.floor(r);
  const tenth = Math.round((r - whole) * 10);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h ? `${h}:${pad(m)}` : m}:${pad(s)}.${tenth}`;
}

/** A typed time: "2:12.8", "1:02:03", "132.8" or "132,8". Undefined when it isn't one. */
export function parseSkipTime(text: string): number | undefined {
  const parts = text.trim().replace(",", ".").split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d*)?$/.test(p))) return undefined;
  const nums = parts.map(Number);
  // Minutes and seconds after an hour or minute are under 60.
  if (nums.slice(1).some((n) => n >= 60)) return undefined;
  return round(nums.reduce((total, n) => total * 60 + n, 0));
}

/**
 * Seeking back into a learned skip just after taking it: it went too far, so it now ends
 * where the viewer landed. Nothing when they went back to its start (they wanted to watch
 * it) or what's left would be too short to be an intro.
 */
export function correctedRange(range: Range, landing: number): Range | undefined {
  if (landing < range.start + MIN_SKIP || landing >= range.end) return undefined;
  return { start: range.start, end: round(landing) };
}

const round = (s: number) => Math.round(s * 10) / 10;

// Export and import of your ratings: Argent's own JSON (everything, lossless) and a
// CSV that Letterboxd's importer reads (Title, Year, Rating10, WatchedDate, Review,
// Tags plus tmdbID/imdbID). Letterboxd's own exports (ratings.csv, reviews.csv,
// diary.csv) can be imported back; their 0.5–5 Rating becomes a 1–10 score.

import { getItems } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { clampStars, emptyRatings, normalise, type RatingEntry, type RatingsState } from "./logic";

// ---- JSON -------------------------------------------------------------------------

export function toJson(state: RatingsState, now = Date.now()): string {
  return JSON.stringify({ app: "argent", kind: "ratings", version: 1, exportedAt: new Date(now).toISOString(), ...state }, null, 2);
}

export function fromJson(text: string): RatingsState | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed?.app !== "argent" || !parsed.ratings) return null;
    const state = normalise(parsed);
    return { ...emptyRatings(), ratings: state.ratings, showcase: state.showcase };
  } catch {
    return null;
  }
}

// ---- CSV --------------------------------------------------------------------------

const escape = (v: string | number | undefined) => {
  const s = v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function toCsv(entries: [string, RatingEntry][], items: Map<string, BaseItem>): string {
  const header = ["Title", "Year", "Rating10", "WatchedDate", "Review", "Tags", "tmdbID", "imdbID", "Type"];
  const rows = entries
    .filter(([, e]) => e.type !== "Season")
    .map(([id, e]) => {
      const item = items.get(id);
      return [e.name, item?.ProductionYear, e.stars, isoDay(e.ratedAt), e.note, e.tags?.join(", "), item?.ProviderIds?.Tmdb, item?.ProviderIds?.Imdb, e.type]
        .map(escape)
        .join(",");
    });
  return [header.join(","), ...rows].join("\r\n") + "\r\n";
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

export interface ImportRow {
  title: string;
  year?: number;
  stars: number;
  note?: string;
  date?: number;
  tags?: string[];
  tmdb?: string;
  imdb?: string;
  type?: "Movie" | "Series";
}

/** Rows with a title and a score, from an Argent or Letterboxd CSV. */
export function rowsFromCsv(text: string): ImportRow[] {
  const [header, ...rest] = parseCsv(text);
  if (!header) return [];
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const title = col("title", "name");
  const year = col("year");
  const rating10 = col("rating10");
  const rating5 = col("rating");
  const review = col("review");
  const date = col("watcheddate", "watched date", "date");
  const tags = col("tags");
  const tmdb = col("tmdbid");
  const imdb = col("imdbid");
  const type = col("type");
  if (title < 0 || (rating10 < 0 && rating5 < 0)) return [];

  const out: ImportRow[] = [];
  for (const r of rest) {
    const name = r[title]?.trim();
    const raw10 = rating10 >= 0 ? parseFloat(r[rating10]) : NaN;
    const raw5 = rating5 >= 0 ? parseFloat(r[rating5]) : NaN;
    const stars = Number.isFinite(raw10) ? raw10 : raw5 * 2;
    if (!name || !Number.isFinite(stars) || stars <= 0) continue;
    const when = date >= 0 ? Date.parse(r[date]) : NaN;
    const t = type >= 0 ? r[type]?.trim() : "";
    out.push({
      title: name,
      year: year >= 0 && /^\d{4}$/.test(r[year]?.trim() ?? "") ? Number(r[year]) : undefined,
      stars: clampStars(stars),
      note: review >= 0 ? r[review]?.trim() || undefined : undefined,
      date: Number.isFinite(when) ? when : undefined,
      tags:
        tags >= 0 && r[tags]?.trim()
          ? r[tags]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      tmdb: tmdb >= 0 ? r[tmdb]?.trim() || undefined : undefined,
      imdb: imdb >= 0 ? r[imdb]?.trim() || undefined : undefined,
      type: t === "Series" ? "Series" : t === "Movie" ? "Movie" : undefined,
    });
  }
  return out;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");

/** The library title a CSV row refers to: provider id first, then title and year. */
export function pickMatch(row: ImportRow, candidates: BaseItem[]): BaseItem | null {
  const byId = candidates.find(
    (c) => (row.tmdb && c.ProviderIds?.Tmdb === row.tmdb && (!row.type || c.Type === row.type)) || (row.imdb && c.ProviderIds?.Imdb === row.imdb),
  );
  if (byId) return byId;
  const named = candidates.filter((c) => norm(c.Name) === norm(row.title) || (c.OriginalTitle && norm(c.OriginalTitle) === norm(row.title)));
  const typed = row.type ? named.filter((c) => c.Type === row.type) : named;
  const pool = typed.length ? typed : named;
  if (!row.year) return pool[0] ?? null;
  return pool.find((c) => c.ProductionYear === row.year) ?? pool.find((c) => c.ProductionYear && Math.abs(c.ProductionYear - row.year!) <= 1) ?? null;
}

export interface ImportResult {
  state: RatingsState;
  matched: number;
  unmatched: string[];
}

/** Looks each row up in your library (four at a time) and builds ratings for the matches. */
export async function matchRows(rows: ImportRow[], onProgress?: (done: number) => void): Promise<ImportResult> {
  const state = emptyRatings();
  const unmatched: string[] = [];
  let done = 0;
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        const found = await getItems({
          searchTerm: row.title,
          includeItemTypes: row.type ? [row.type] : ["Movie", "Series"],
          recursive: true,
          limit: 12,
          fields: ["ProviderIds", "OriginalTitle"],
          enableImageTypes: [],
        });
        const item = pickMatch(row, found.Items);
        if (item) {
          state.ratings[item.Id] = {
            stars: row.stars,
            note: row.note,
            ratedAt: row.date ?? Date.now(),
            name: item.Name,
            type: item.Type === "Series" ? "Series" : "Movie",
            tags: row.tags,
          };
        } else unmatched.push(row.year ? `${row.title} (${row.year})` : row.title);
      } catch {
        unmatched.push(row.title);
      }
      onProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { state, matched: Object.keys(state.ratings).length, unmatched };
}

export function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

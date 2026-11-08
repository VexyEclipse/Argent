// TVmaze's public schedule API (https://www.tvmaze.com/api): free, no key, CORS-enabled.
// Only a show's TVDB/IMDb id is sent. Requests carry no cookies, no Jellyfin token and no
// referrer, so TVmaze never learns your server address or account.

import { parseRef, parseSchedule, parseShowId, type ShowSchedule } from "./logic";

const API = "https://api.tvmaze.com";
/** TVmaze allows at least 20 calls per 10 seconds; stay comfortably under. */
const MIN_GAP_MS = 600;
const TIMEOUT_MS = 10_000;

let lastCall = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RateLimited extends Error {}

async function get(path: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const response = await fetch(`${API}${path}`, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (response.status === 429) {
      await sleep(10_000);
      continue;
    }
    if (!response.ok) throw new Error(`TVmaze ${response.status}`);
    return response.json();
  }
  throw new RateLimited("TVmaze rate limit");
}

/** The TVmaze id for a "tvdb:…" or "imdb:…" reference; null when TVmaze doesn't know it. */
export async function lookupShow(ref: string): Promise<number | null> {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  return parseShowId(await get(`/lookup/shows?${parsed.key}=${encodeURIComponent(parsed.value)}`));
}

/** Next and previous episode and season list for a show. */
export async function fetchSchedule(tvmazeId: number): Promise<ShowSchedule | null> {
  if (!Number.isInteger(tvmazeId) || tvmazeId <= 0) return null;
  return parseSchedule(await get(`/shows/${tvmazeId}?embed%5B%5D=nextepisode&embed%5B%5D=previousepisode&embed%5B%5D=seasons`));
}

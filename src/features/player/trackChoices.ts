// The subtitle and audio track last chosen for a show, so its next episode starts with the
// same ones. Jellyfin only remembers a choice per episode (its own web app carries it over
// by itself), so without this every new episode went back to the server's default. Track
// numbers differ between files, so a choice is kept as what the track is: its language,
// title ("Signs", "Full [BD]"), and whether it's forced or for the hard of hearing. Synced
// through the user's Jellyfin DisplayPreferences, so it follows them to every device.

import { createSyncedMap } from "@/api/syncedMap";
import type { BaseItem, MediaStream, UserConfiguration } from "@/api/types";

export interface TrackPick {
  language?: string;
  title?: string;
  codec?: string;
  forced?: boolean;
  hearingImpaired?: boolean;
}

export interface TrackChoice {
  /** "off": subtitles turned off. */
  subtitle?: TrackPick | "off";
  audio?: TrackPick;
}

const choices = createSyncedMap<TrackChoice>({ prefsId: "argent-tracks", field: "series", storageKey: "argent.trackChoices", max: 500 });

const norm = (s?: string) => s?.trim().toLowerCase() || undefined;

export function describeTrack(s: MediaStream): TrackPick {
  return {
    language: norm(s.Language),
    title: s.Title?.trim() || undefined,
    codec: norm(s.Codec),
    forced: Boolean(s.IsForced),
    hearingImpaired: Boolean(s.IsHearingImpaired),
  };
}

/**
 * The track in `streams` most like `pick`: the same language (else none: the server's
 * default stands), then the same title, forced or not, for the hard of hearing or not,
 * and format. The first such track when several are as alike.
 */
export function matchTrack(streams: MediaStream[], type: "Audio" | "Subtitle", pick: TrackPick): number | undefined {
  const same = streams.filter((s) => s.Type === type && norm(s.Language) === pick.language);
  let best: MediaStream | undefined;
  let bestScore = -1;
  for (const s of same) {
    const score =
      (pick.title && s.Title?.trim() === pick.title ? 8 : 0) +
      (Boolean(s.IsForced) === Boolean(pick.forced) ? 4 : 0) +
      (Boolean(s.IsHearingImpaired) === Boolean(pick.hearingImpaired) ? 2 : 0) +
      (pick.codec && norm(s.Codec) === pick.codec ? 1 : 0);
    if (score > bestScore) [best, bestScore] = [s, score];
  }
  return best?.Index;
}

/**
 * The tracks to start an episode with, from the show's last choice: undefined where
 * there's none, it can't be matched, or the user's Jellyfin settings say not to remember.
 */
export function carriedTracks(
  userId: string | undefined,
  item: BaseItem,
  streams: MediaStream[] | undefined,
  config: UserConfiguration | undefined,
): { audioIndex?: number; subtitleIndex?: number } {
  if (!userId || item.Type !== "Episode" || !item.SeriesId || !streams?.length) return {};
  const choice = choices.read(userId)[item.SeriesId];
  if (!choice) return {};
  const out: { audioIndex?: number; subtitleIndex?: number } = {};
  if (choice.subtitle && config?.RememberSubtitleSelections !== false)
    out.subtitleIndex = choice.subtitle === "off" ? -1 : matchTrack(streams, "Subtitle", choice.subtitle);
  if (choice.audio && config?.RememberAudioSelections !== false) out.audioIndex = matchTrack(streams, "Audio", choice.audio);
  return out;
}

/** Remembers a track picked in an episode for the rest of its show (index -1: subtitles off). */
export function rememberTrack(userId: string | undefined, item: BaseItem, streams: MediaStream[], type: "Audio" | "Subtitle", index: number) {
  if (!userId || item.Type !== "Episode" || !item.SeriesId) return;
  const current = choices.read(userId)[item.SeriesId] ?? {};
  if (type === "Subtitle") {
    const s = streams.find((x) => x.Type === "Subtitle" && x.Index === index);
    if (index >= 0 && !s) return;
    choices.set(userId, item.SeriesId, { ...current, subtitle: s ? describeTrack(s) : "off" });
  } else {
    const s = streams.find((x) => x.Type === "Audio" && x.Index === index);
    if (s) choices.set(userId, item.SeriesId, { ...current, audio: describeTrack(s) });
  }
}

// Your corrections to shows' editions (see "editions" in duplicates.ts): names of your own,
// folders that are editions though Argent didn't see it, and folders that aren't. Kept per
// show, and synced through the user's Jellyfin DisplayPreferences.

import type { EditionSettings } from "./duplicates";
import { client } from "./jellyfin";
import { createSyncedMap } from "./syncedMap";

const store = createSyncedMap<EditionSettings>({ prefsId: "argent-library", field: "editions", storageKey: "argent.editionSettings", max: 1000 });

const NONE: EditionSettings = {};

const userId = () => {
  try {
    return client().userId ?? "";
  } catch {
    return "";
  }
};

/** A show's corrections, for the signed-in user. */
export function editionSettingsOf(seriesId: string): EditionSettings {
  const id = userId();
  return (id && store.read(id)[seriesId]) || NONE;
}

/** A show's corrections, re-rendering when they change (here or, once a session, from another device). */
export function useEditionSettings(seriesId: string): EditionSettings {
  return store.use()[seriesId] ?? NONE;
}

const isEmpty = (s: EditionSettings) => !Object.keys(s.names ?? {}).length && !Object.keys(s.added ?? {}).length && !s.removed?.length;

export function saveEditionSettings(seriesId: string, settings: EditionSettings) {
  const id = userId();
  if (!id) return;
  if (isEmpty(settings)) store.remove(id, seriesId);
  else store.set(id, seriesId, settings);
}

// "Remind me": shows you asked to hear about. A reminded show is checked on TVmaze even if
// you haven't started it, and you get a notification when its next episode or season airs
// and again when it's in your library to watch. The list syncs through your Jellyfin
// account; what has already been announced is remembered per device.

import { useAuth } from "@/auth/AuthProvider";
import { createSyncedMap } from "@/api/syncedMap";
import type { BaseItem } from "@/api/types";
import { showToast } from "@/components/Toast";
import { askToNotify } from "@/platform/notify";

export interface Reminder {
  name: string;
  /** When it was set (ms): episodes already in the library by then aren't news. */
  at: number;
}

const reminders = createSyncedMap<Reminder>({ prefsId: "argent-reminders", field: "reminders", storageKey: "argent.reminders", max: 300 });

export const readReminders = (userId: string) => reminders.read(userId);

/** Shows that can be reminded: series still running (or not known to have ended). */
export const canRemind = (item: Pick<BaseItem, "Type" | "Status">) => item.Type === "Series" && item.Status !== "Ended";

/** Whether a show has a reminder, plus a toggle for it. */
export function useReminder(item: Pick<BaseItem, "Id" | "Name" | "Type" | "Status"> | undefined) {
  const { user } = useAuth();
  const list = reminders.use();
  const on = Boolean(item && list[item.Id]);
  const toggle = async () => {
    if (!user || !item) return;
    if (on) {
      reminders.remove(user.Id, item.Id);
      showToast(`Reminder for ${item.Name} turned off`);
      return;
    }
    reminders.set(user.Id, item.Id, { name: item.Name, at: Date.now() });
    const allowed = await askToNotify();
    showToast(allowed ? `We'll let you know when new episodes of ${item.Name} arrive` : `Reminder set. Notifications are blocked here, so it will show while Argent is open.`);
  };
  return { on, toggle };
}

// ---- what has been announced (this device) ------------------------------------------

const announcedKey = (userId: string) => `argent.reminded.${userId}`;

/** series id → the newest library episode already announced. */
export function readAnnounced(userId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(announcedKey(userId)) || "{}") ?? {};
  } catch {
    return {};
  }
}

export function writeAnnounced(userId: string, value: Record<string, string>) {
  try {
    localStorage.setItem(announcedKey(userId), JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

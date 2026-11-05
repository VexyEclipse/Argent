// System notifications wherever Argent runs: the Android app posts its own (bridge),
// the desktop app and browsers use the Notification API. Where neither is allowed, the
// news shows as a toast while Argent is open.

import { showToast } from "@/components/Toast";
import { androidApp, onNativeEvent } from "./android";
import { desktop } from "./desktop";

export interface AppNotification {
  title: string;
  body: string;
  /** Where clicking it goes ("/details/…"). */
  path?: string;
  /** Replaces an earlier notification with the same tag. */
  tag?: string;
}

// Set by the shell, which owns the router.
let openPath: (path: string) => void = () => {};
let offNative: (() => void) | null = null;

/** Where clicked notifications navigate. Also hears clicks on the Android app's notifications. */
export function setNotificationTarget(fn: (path: string) => void) {
  openPath = fn;
  offNative ??= onNativeEvent<{ type: string; path?: string }>((d) => {
    if (d.type === "open" && typeof d.path === "string" && d.path.startsWith("/")) openPath(d.path);
  });
}

const webNotifications = () => typeof Notification !== "undefined";

/** Whether a notification would reach the system (rather than a toast). */
export function canNotify(): boolean {
  if (androidApp?.notify) return true;
  return webNotifications() && (Boolean(desktop) || Notification.permission === "granted");
}

/** Asks for permission where it's needed (call from a click). Resolves to whether notifications will show. */
export async function askToNotify(): Promise<boolean> {
  if (androidApp?.notify) {
    androidApp.requestNotifications?.();
    return true;
  }
  if (!webNotifications()) return false;
  if (desktop || Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function notify(n: AppNotification) {
  if (androidApp?.notify) {
    androidApp.notify(JSON.stringify(n));
    return;
  }
  if (canNotify()) {
    try {
      const shown = new Notification(n.title, { body: n.body, tag: n.tag });
      shown.onclick = () => {
        desktop?.showWindow();
        window.focus();
        if (n.path) openPath(n.path);
      };
      return;
    } catch {
      // Some browsers only allow notifications from a service worker: fall through.
    }
  }
  showToast(`${n.title}: ${n.body}`);
}

// The Vault: every show and film you've had in your library, kept after it's gone. Stored
// locally for speed and mirrored to the user's Jellyfin DisplayPreferences so it follows
// them across devices. A check of the library runs every few hours (and on demand); what
// it finds missing is announced once.

import { useEffect, useSyncExternalStore } from "react";
import { client } from "@/api/jellyfin";
import type { BaseItem, User } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { readRatings } from "@/features/ratings/store";
import { notify } from "@/platform/notify";
import { getUsers, applyVisibility, usersByShortId } from "./access";
import { forgetPosters, keepPosters } from "./artwork";
import {
  applyScan,
  emptyVault,
  forget,
  importInto,
  keyOfItem,
  markResetPeak,
  mergeCustomPrefs,
  normalise,
  parseImport,
  pruneRemoved,
  setHidden,
  setVisibility,
  shortId,
  toCustomPrefs,
  type ScanResult,
  type VaultEntry,
  type VaultState,
} from "./logic";
import { readLibrary } from "./scan";

const PREFS_ID = "argent-vault";
const PREFS_CLIENT = "Argent";
/** How often the library is checked while Argent is open. */
const CHECK_EVERY = 6 * 60 * 60_000;
/** The first check waits until the home page has loaded. */
const FIRST_CHECK_AFTER = 20_000;

export const VAULT_PATH = "/profile?tab=settings#settings-vault";

const storageKey = (userId: string) => `argent.vault.${userId}`;
const metaKey = (userId: string) => `argent.vault-meta.${userId}`;

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => listeners.forEach((fn) => fn());

// ---- the list ---------------------------------------------------------------------------------

// useSyncExternalStore needs the same object back until something changes.
let cache: { userId: string; raw: string | null; state: VaultState } = { userId: "", raw: null, state: emptyVault() };

export function readVault(userId: string): VaultState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(userId));
  } catch {
    /* ignore */
  }
  if (userId === cache.userId && raw === cache.raw) return cache.state;
  let state = emptyVault();
  try {
    state = normalise(JSON.parse(raw || "null"));
  } catch {
    /* ignore */
  }
  cache = { userId, raw, state };
  return state;
}

let syncTimer = 0;

function write(userId: string, state: VaultState, sync = true) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    /* full or blocked: the in-memory copy still works this session */
    cache = { userId, raw: null, state };
  }
  emit();
  if (!sync) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => pushToServer(userId), 1500);
}

interface DisplayPreferences {
  Id?: string;
  CustomPrefs?: Record<string, string | null>;
  [k: string]: unknown;
}

const prefsPath = `/DisplayPreferences/${PREFS_ID}`;

async function pushToServer(userId: string) {
  try {
    const c = client();
    const query = { userId, client: PREFS_CLIENT };
    const current = await c.request<DisplayPreferences>(prefsPath, { query });
    // Fold in anything another device saved meanwhile before overwriting.
    const merged = mergeCustomPrefs(readVault(userId), current?.CustomPrefs);
    write(userId, merged, false);
    const body: DisplayPreferences = { ...current, CustomPrefs: { ...(current?.CustomPrefs ?? {}), ...toCustomPrefs(merged) } };
    await c.request<void>(prefsPath, { method: "POST", query, body });
  } catch {
    /* offline or older server: the local copy still works */
  }
}

const pulled = new Set<string>();

/** Merge what other devices saved into the local copy (once per session per user). */
async function pullFromServer(userId: string) {
  if (pulled.has(userId)) return;
  pulled.add(userId);
  try {
    const prefs = await client().request<DisplayPreferences>(prefsPath, { query: { userId, client: PREFS_CLIENT } });
    const local = readVault(userId);
    const merged = mergeCustomPrefs(local, prefs?.CustomPrefs);
    if (JSON.stringify(merged) !== JSON.stringify(local)) write(userId, merged, false);
  } catch {
    pulled.delete(userId);
  }
}

// ---- when it was checked and visited (this device) --------------------------------------------

export interface VaultMeta {
  /** ms: the last finished check. */
  checkedAt: number;
  /** ms: the last time the Vault was open. Titles missing since then are news. */
  visitedAt: number;
}

// Until this device has started its Vault, nothing counts as news.
const FRESH: VaultMeta = { checkedAt: 0, visitedAt: Number.MAX_SAFE_INTEGER };
let metaCache: { userId: string; raw: string | null; meta: VaultMeta } = { userId: "", raw: null, meta: FRESH };

export function readMeta(userId: string): VaultMeta {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(metaKey(userId));
  } catch {
    /* ignore */
  }
  if (userId === metaCache.userId && raw === metaCache.raw) return metaCache.meta;
  let meta = FRESH;
  try {
    const parsed = JSON.parse(raw || "null");
    if (parsed) meta = { checkedAt: Number(parsed.checkedAt) || 0, visitedAt: Number(parsed.visitedAt) || 0 };
  } catch {
    /* ignore */
  }
  metaCache = { userId, raw, meta };
  return meta;
}

function writeMeta(userId: string, patch: Partial<VaultMeta>) {
  const current = readMeta(userId);
  const next = { ...(current === FRESH ? { checkedAt: 0, visitedAt: Date.now() } : current), ...patch };
  try {
    localStorage.setItem(metaKey(userId), JSON.stringify(next));
  } catch {
    metaCache = { userId, raw: null, meta: next };
  }
  emit();
}

/** A new device: what went missing before it was set up isn't news here. */
function startMeta(userId: string) {
  if (readMeta(userId) === FRESH) writeMeta(userId, {});
}

/** The Vault was looked at: its missing titles are no longer news. */
export function markVisited(userId: string) {
  if (!userId) return;
  const meta = readMeta(userId);
  const news = Object.values(readVault(userId).entries).some((e) => e.missing && e.missing > meta.visitedAt && !e.hidden);
  if (news) writeMeta(userId, { visitedAt: Date.now() });
}

// ---- checking the library ---------------------------------------------------------------------

export interface CheckStatus {
  checking: boolean;
  error: string | null;
}

let status: CheckStatus = { checking: false, error: null };
const setStatus = (next: CheckStatus) => {
  status = next;
  emit();
};

export interface CheckOutcome {
  ok: boolean;
  missing: number;
  returned: number;
  added: number;
}

const inflight = new Map<string, Promise<CheckOutcome>>();

function listNames(names: string[]): string {
  if (names.length <= 3) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** Tells you once when titles leave the library. */
function announce(gone: VaultEntry[]) {
  if (!gone.length) return;
  const names = gone.map((e) => e.name);
  notify({
    title: gone.length === 1 ? `${names[0]} left your library` : `${gone.length} titles left your library`,
    body: gone.length === 1 ? "It's kept in your Vault, with your progress." : `${listNames(names)}. They're kept in your Vault.`,
    path: VAULT_PATH,
    tag: "vault-missing",
  });
}

/** Hides re-added titles again (they came back without their tags), and private ones from new users. */
async function reapply(userId: string, jobs: ScanResult["reapply"], users: User[]) {
  const byShort = usersByShortId(users);
  for (const job of jobs) {
    const owner = job.owner ? byShort.get(job.owner) : undefined;
    const hideFrom = job.hiddenFrom.map((s) => byShort.get(s)).filter((u): u is User => Boolean(u) && u!.Id !== owner?.Id);
    if (!hideFrom.length) continue;
    const failed = await applyVisibility([{ Id: job.itemId }], hideFrom, owner?.Id).catch(() => [job.itemId]);
    if (!failed.length) write(userId, setVisibility(readVault(userId), job.itemId, hideFrom.map((u) => shortId(u.Id)), owner ? shortId(owner.Id) : undefined));
  }
}

/** Checks the library now. One check at a time per user; a second call joins the first. */
export function checkVault(userId: string, admin: boolean): Promise<CheckOutcome> {
  const running = inflight.get(userId);
  if (running) return running;
  const job = (async (): Promise<CheckOutcome> => {
    setStatus({ checking: true, error: null });
    try {
      await pullFromServer(userId);
      const ratings = readRatings(userId).ratings;
      const users = admin ? await getUsers().catch(() => null) : null;
      const titles = await readLibrary({ tags: admin, ratingOf: (id) => ratings[id]?.stars });
      const current = readVault(userId);
      const inLibrary = Object.values(current.entries).filter((e) => !e.missing).length;
      // Nothing at all while the Vault knows a library full of titles: far more likely a
      // server hiccup than everything gone at once. Try again later rather than raise alarms.
      if (!titles.length && inLibrary >= 5) throw new Error("The server didn't list any titles. Trying again later.");
      const result = applyScan(current, titles, Date.now(), { tags: admin, users: users?.map((u) => shortId(u.Id)) });
      write(userId, pruneRemoved(result.state), result.changed);
      writeMeta(userId, { checkedAt: Date.now() });
      announce(result.newlyMissing.filter((e) => !e.hidden));
      if (users && result.reapply.length) await reapply(userId, result.reapply, users);
      const present = Object.entries(readVault(userId).entries).filter(([, e]) => !e.missing);
      void keepPosters(
        userId,
        present.map(([key, e]) => ({ key, id: e.id, tag: e.tag })),
      );
      setStatus({ checking: false, error: null });
      return { ok: true, missing: result.newlyMissing.length, returned: result.returned.length, added: result.added };
    } catch (e) {
      setStatus({ checking: false, error: e instanceof Error ? e.message : "Couldn't check the library" });
      return { ok: false, missing: 0, returned: 0, added: 0 };
    } finally {
      inflight.delete(userId);
    }
  })();
  inflight.set(userId, job);
  return job;
}

/** Runs in the shell: merges other devices' copies and checks the library every few hours. */
export function useVaultSync() {
  const { user, isAdmin } = useAuth();
  const userId = user?.Id ?? "";
  useEffect(() => {
    if (!userId) return;
    startMeta(userId);
    void pullFromServer(userId);
    const due = () => {
      if (Date.now() - readMeta(userId).checkedAt >= CHECK_EVERY && !document.hidden) void checkVault(userId, isAdmin);
    };
    const first = window.setTimeout(due, FIRST_CHECK_AFTER);
    const every = window.setInterval(due, 30 * 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [userId, isAdmin]);
}

// ---- hooks ------------------------------------------------------------------------------------

export function useVault(): VaultState {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  return useSyncExternalStore(subscribe, () => readVault(userId));
}

export function useVaultMeta(): VaultMeta {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  return useSyncExternalStore(subscribe, () => readMeta(userId));
}

export const useCheckStatus = () => useSyncExternalStore(subscribe, () => status);

/** Titles that went missing since the Vault was last opened. */
export function useVaultNews(): number {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  return useSyncExternalStore(subscribe, () => {
    if (!userId) return 0;
    const since = readMeta(userId).visitedAt;
    let n = 0;
    for (const e of Object.values(readVault(userId).entries)) if (e.missing && e.missing > since && !e.hidden) n++;
    return n;
  });
}

// Item id → how many users it's hidden from, for the lock on posters (administrators).
let restricted: { state: VaultState | null; map: Map<string, number> } = { state: null, map: new Map() };

function restrictedMap(state: VaultState): Map<string, number> {
  if (restricted.state === state) return restricted.map;
  const map = new Map<string, number>();
  for (const e of Object.values(state.entries)) if (!e.missing && e.hiddenFrom?.length) map.set(e.id, e.hiddenFrom.length);
  restricted = { state, map };
  return map;
}

/** How many people a title is hidden from (administrators only; 0 otherwise). */
export function useRestriction(itemId: string): number {
  const { user, isAdmin } = useAuth();
  const userId = isAdmin ? (user?.Id ?? "") : "";
  return useSyncExternalStore(subscribe, () => (userId ? (restrictedMap(readVault(userId)).get(itemId) ?? 0) : 0));
}

// ---- actions ----------------------------------------------------------------------------------

export function hideInVault(userId: string, key: string, hidden: boolean) {
  write(userId, setHidden(readVault(userId), key, hidden));
}

export function forgetInVault(userId: string, keys: string[]) {
  write(userId, forget(readVault(userId), keys));
  forgetPosters(userId, keys);
}

/**
 * Titles deleted in Argent leave the Vault (you meant it); a deleted season or episode
 * makes the show's new episode count its complete one.
 */
export function noteDeleted(userId: string, items: Pick<BaseItem, "Id" | "Type" | "SeriesId">[]) {
  let state = readVault(userId);
  const titles = items.filter((i) => i.Type === "Series" || i.Type === "Movie");
  const keys = titles.map((i) => keyOfItem(state, i.Id)).filter((k): k is string => Boolean(k));
  state = forget(state, keys);
  const shows = items.filter((i) => (i.Type === "Season" || i.Type === "Episode") && i.SeriesId).map((i) => i.SeriesId!);
  state = markResetPeak(state, shows);
  write(userId, state);
  forgetPosters(userId, keys);
}

/** After changing who can see titles: the Vault (and the locks on posters) follow at once. */
export function noteVisibility(userId: string, itemIds: string[], hiddenFrom: string[], owner?: string) {
  let state = readVault(userId);
  for (const id of itemIds) state = setVisibility(state, id, hiddenFrom, owner);
  write(userId, state);
}

/** Loads a file saved by Export. Resolves to how many titles were added, or null if it isn't one. */
export function importVaultFile(userId: string, text: string): number | null {
  const incoming = parseImport(text);
  if (!incoming) return null;
  const { state, added } = importInto(readVault(userId), incoming);
  write(userId, state);
  return added;
}

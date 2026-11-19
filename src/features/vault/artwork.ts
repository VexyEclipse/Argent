// Small posters kept on the device, so a title that left the server (and its artwork with
// it) still looks like itself in the Vault. IndexedDB, which works on plain-http pages and
// in the apps; where it's missing, cards fall back to the BlurHash and the title.

import { useEffect, useState } from "react";
import { client } from "@/api/jellyfin";

const DB_NAME = "argent-vault";
const STORE = "posters";
const WIDTH = 180;

interface Stored {
  tag: string;
  blob: Blob;
}

let opening: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve) => {
        if (!d) return resolve(undefined);
        try {
          const req = fn(d.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

const posterKey = (userId: string, key: string) => `${userId}:${key}`;

/** Which posters are kept (key → image tag), for one user. */
async function keptTags(userId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const d = await db();
  if (!d) return out;
  await new Promise<void>((resolve) => {
    try {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        const k = String(cursor.key);
        if (k.startsWith(`${userId}:`)) out.set(k.slice(userId.length + 1), (cursor.value as Stored).tag);
        cursor.continue();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  return out;
}

/**
 * Saves a small copy of each poster that isn't kept yet (or has changed), a few at a time.
 * Skipped on connections that ask to save data.
 */
export async function keepPosters(userId: string, titles: { key: string; id: string; tag?: string }[]) {
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const kept = await keptTags(userId);
  const todo = titles.filter((t) => t.tag && kept.get(t.key) !== t.tag);
  const worker = async () => {
    for (let t = todo.shift(); t; t = todo.shift()) {
      try {
        const url = client().imageUrl(t.id, "Primary", { tag: t.tag, maxWidth: WIDTH, quality: 75 });
        const res = await fetch(url, { credentials: "omit" });
        if (!res.ok) continue;
        const blob = await res.blob();
        await run("readwrite", (s) => s.put({ tag: t.tag!, blob } satisfies Stored, posterKey(userId, t.key)));
        changed.add(posterKey(userId, t.key));
      } catch {
        /* the card keeps its BlurHash */
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (changed.size) listeners.forEach((fn) => fn());
}

export function forgetPosters(userId: string, keys: string[]) {
  for (const k of keys) void run("readwrite", (s) => s.delete(posterKey(userId, k)));
}

const changed = new Set<string>();
const listeners = new Set<() => void>();

/** The kept poster for a Vault title, as an object URL while the card is on screen. */
export function useKeptPoster(userId: string, key: string, enabled: boolean): string | undefined {
  const [url, setUrl] = useState<string>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fn = () => changed.has(posterKey(userId, key)) && setVersion((v) => v + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [userId, key]);
  useEffect(() => {
    if (!enabled || !userId) return;
    let objectUrl: string | undefined;
    let live = true;
    run<Stored>("readonly", (s) => s.get(posterKey(userId, key))).then((stored) => {
      if (!live || !stored?.blob) return;
      objectUrl = URL.createObjectURL(stored.blob);
      setUrl(objectUrl);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [userId, key, enabled, version]);
  return url;
}

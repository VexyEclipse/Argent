// Identify in the background (administrators). Choosing the right match queues it, and the
// dialog can close straight away: matches are applied one after another while you carry
// on, even across pages. Jellyfin answers an apply only once it has refreshed the title,
// which for a long series takes a while. The queue is kept on this device, so a reload
// picks up where it stopped.

import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { client } from "@/api/jellyfin";
import { applyMatch, updateItemMetadata, type RemoteSearchResult } from "@/api/manage";
import { randomId } from "@/api/client";
import type { BaseItem } from "@/api/types";
import { showToast } from "@/components/Toast";

export type JobState = "queued" | "running" | "done" | "failed";

export interface IdentifyJob {
  id: string;
  itemId: string;
  itemName: string;
  match: RemoteSearchResult;
  replaceImages: boolean;
  /** The item was locked: unlock it first, or the new details wouldn't be saved. */
  unlock: boolean;
  state: JobState;
  error?: string;
  /** Which server and user queued it (another account's queue is left alone). */
  owner: string;
  addedAt: number;
  finishedAt?: number;
}

const STORAGE_KEY = "argent.identifyQueue";
/** Finished jobs are kept this long for the list, then dropped. */
const KEEP_FINISHED_MS = 30 * 60_000;

let jobs: IdentifyJob[] = load();
let running = false;
let queryClient: QueryClient | null = null;
const listeners = new Set<() => void>();

function load(): IdentifyJob[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    // One that was running when the app closed is applied again: harmless if it had finished.
    return list.filter((j) => j && typeof j.itemId === "string").map((j: IdentifyJob) => (j.state === "running" ? { ...j, state: "queued" } : j));
  } catch {
    return [];
  }
}

function save() {
  const now = Date.now();
  jobs = jobs.filter((j) => !j.finishedAt || now - j.finishedAt < KEEP_FINISHED_MS || j.state === "failed");
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

function update(id: string, patch: Partial<IdentifyJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  save();
}

const ownerKey = () => {
  try {
    const c = client();
    return `${c.serverUrl}|${c.userId ?? ""}`;
  } catch {
    return "";
  }
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** The signed-in account's jobs, oldest first. */
export function useIdentifyJobs(): IdentifyJob[] {
  return useSyncExternalStore(subscribe, () => jobs);
}

export const mine = (list: IdentifyJob[]) => {
  const owner = ownerKey();
  return list.filter((j) => j.owner === owner);
};

/** The job for an item that hasn't finished yet, if any. */
export const pendingFor = (list: IdentifyJob[], itemId: string) => list.find((j) => j.itemId === itemId && (j.state === "queued" || j.state === "running"));

/** Lets the runner refresh what's on screen once a title is updated. */
export function setIdentifyQueryClient(qc: QueryClient) {
  queryClient = qc;
  if (jobs.some((j) => j.state === "queued")) void run();
}

export function queueIdentify(item: Pick<BaseItem, "Id" | "Name">, match: RemoteSearchResult, opts: { replaceImages: boolean; unlock: boolean }) {
  const owner = ownerKey();
  // A newer choice for the same title replaces one still waiting.
  jobs = jobs.filter((j) => !(j.itemId === item.Id && j.state === "queued" && j.owner === owner));
  jobs = [
    ...jobs,
    {
      id: randomId(),
      itemId: item.Id,
      itemName: item.Name,
      match,
      replaceImages: opts.replaceImages,
      unlock: opts.unlock,
      state: "queued",
      owner,
      addedAt: Date.now(),
    },
  ];
  save();
  void run();
}

export function retryIdentify(id: string) {
  update(id, { state: "queued", error: undefined, finishedAt: undefined });
  void run();
}

export function removeIdentify(id: string) {
  jobs = jobs.filter((j) => j.id !== id || j.state === "running");
  save();
}

/** Clears finished and failed jobs from the list. */
export function clearFinishedIdentify() {
  const owner = ownerKey();
  jobs = jobs.filter((j) => j.owner !== owner || j.state === "queued" || j.state === "running");
  save();
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

function refresh() {
  const qc = queryClient;
  if (!qc) return;
  // The server finishes images and episodes after it answers: pick those up as they land.
  qc.invalidateQueries();
  window.setTimeout(() => qc.invalidateQueries(), 4000);
  window.setTimeout(() => qc.invalidateQueries(), 15000);
}

async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const owner = ownerKey();
      const job = jobs.find((j) => j.state === "queued" && j.owner === owner);
      if (!job) break;
      update(job.id, { state: "running" });
      try {
        if (job.unlock) await updateItemMetadata(job.itemId, { LockData: false });
        await applyMatch(job.itemId, job.match, job.replaceImages);
        update(job.id, { state: "done", finishedAt: Date.now() });
        showToast(`Identified ${job.itemName} as ${job.match.Name ?? "the chosen title"}`);
        refresh();
      } catch (e) {
        update(job.id, { state: "failed", error: errorText(e), finishedAt: Date.now() });
        showToast(`Couldn't identify ${job.itemName}: ${errorText(e)}`);
      }
    }
  } finally {
    running = false;
  }
}

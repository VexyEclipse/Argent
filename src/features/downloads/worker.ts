/// <reference lib="webworker" />
// Saves downloads to the origin private file system (storage only this app can see), in a
// worker so a long download never holds up the page. A file that was cut off resumes where
// it stopped when the server allows (Original files); a conversion starts again.

export type WorkerRequest =
  | { type: "fetch"; job: string; url: string; dir: string; file: string; resume: boolean }
  | { type: "cancel"; job: string };

export type WorkerReply =
  | { type: "progress"; job: string; bytes: number; total?: number }
  | { type: "done"; job: string; bytes: number }
  | { type: "error"; job: string; bytes: number; message: string; cancelled: boolean };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const controllers = new Map<string, AbortController>();
const PROGRESS_EVERY_MS = 500;

async function folder(path: string): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const part of path.split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir;
}

async function run(m: Extract<WorkerRequest, { type: "fetch" }>) {
  const controller = new AbortController();
  controllers.set(m.job, controller);
  let handle: FileSystemSyncAccessHandle | null = null;
  let at = 0;
  try {
    const file = await (await folder(m.dir)).getFileHandle(m.file, { create: true });
    handle = await file.createSyncAccessHandle();
    at = m.resume ? handle.getSize() : 0;
    const response = await fetch(m.url, {
      signal: controller.signal,
      credentials: "omit",
      headers: at > 0 ? { Range: `bytes=${at}-` } : undefined,
    });
    if (!response.ok || !response.body) throw new Error(`The server answered ${response.status}`);
    // The server sent the whole file rather than the rest of it: start over.
    if (at > 0 && response.status !== 206) at = 0;
    handle.truncate(at);
    const length = Number(response.headers.get("content-length")) || 0;
    const total = length ? at + length : undefined;
    const reader = response.body.getReader();
    let last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      at += handle.write(value, { at });
      if (Date.now() - last > PROGRESS_EVERY_MS) {
        last = Date.now();
        scope.postMessage({ type: "progress", job: m.job, bytes: at, total } satisfies WorkerReply);
      }
    }
    handle.flush();
    scope.postMessage({ type: "done", job: m.job, bytes: at } satisfies WorkerReply);
  } catch (e) {
    const cancelled = controller.signal.aborted;
    const message = e instanceof Error ? (e.name === "QuotaExceededError" ? "This device is out of space" : e.message) : "Download failed";
    scope.postMessage({ type: "error", job: m.job, bytes: at, message, cancelled } satisfies WorkerReply);
  } finally {
    try {
      handle?.flush();
      handle?.close();
    } catch {
      /* already closed */
    }
    controllers.delete(m.job);
  }
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === "cancel") controllers.get(m.job)?.abort();
  else if (m.type === "fetch") run(m);
};

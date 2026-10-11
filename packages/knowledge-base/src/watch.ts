import { watch } from "node:fs";
import { access, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Logger } from "@ops/core";
import { SUPPORTED } from "./extract.js";
import type { Ingester } from "./ingest.js";

// Runs tasks one at a time, so a scan and a file event never race on the same note.
// ponytail: one global queue, fine for one person's notes; per-path queues if it backs up.
export function createQueue(logger: Logger) {
  let tail = Promise.resolve();
  const enqueue = (task: () => Promise<unknown>) => {
    tail = tail.then(task).then(
      () => undefined,
      (err: unknown) => logger.error({ err }, "queued task failed"),
    );
    return tail;
  };
  return { enqueue, idle: () => tail };
}

// Watches notesDir and re-indexes files as they change. fs.watch doesn't say
// whether a file was added or deleted, so each event checks if it still exists.
// Moving or deleting a whole folder fires one event for the folder, not its
// files; the periodic rescan in watch-main picks those up.
export function watchNotes(deps: {
  notesDir: string;
  ingester: Pick<Ingester, "ingestFile" | "removeFile">;
  enqueue: (task: () => Promise<unknown>) => Promise<void>;
  logger: Logger;
  debounceMs?: number;
}) {
  const { notesDir, ingester, enqueue, logger, debounceMs = 2000 } = deps;
  const timers = new Map<string, NodeJS.Timeout>();

  const handle = (path: string) =>
    enqueue(async () => {
      const exists = await access(join(notesDir, path)).then(
        () => true,
        () => false,
      );
      if (exists) await ingester.ingestFile(path);
      else await ingester.removeFile(path);
    });

  const probe = `.watch-ready-${process.pid}-${Date.now()}`;
  let seen!: () => void;
  const seenProbe = new Promise<void>((r) => (seen = r));

  const watcher = watch(notesDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    if (filename === probe) return seen();
    const path = filename.split("\\").join("/");
    if (path.split("/").some((part) => part.startsWith("."))) return;
    if (!SUPPORTED.has(extname(path).toLowerCase())) return;
    // Editors and sync tools write a file several times per save.
    clearTimeout(timers.get(path));
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        void handle(path);
      }, debounceMs),
    );
  });
  watcher.on("error", (err) =>
    logger.error({ err }, "watcher failed, relying on periodic rescans"),
  );

  return {
    // fs.watch has no ready signal and a recursive watch can start after it
    // returns, losing events from the gap. This writes a hidden probe file
    // until the watcher reports it. Optional: watch-main skips it so it never
    // writes into the notes folder.
    async ready(timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      let done = false;
      void seenProbe.then(() => (done = true));
      while (!done && Date.now() < deadline) {
        await writeFile(join(notesDir, probe), String(Date.now()));
        await new Promise((r) => setTimeout(r, 50));
      }
      await rm(join(notesDir, probe), { force: true });
      if (!done) throw new Error("watcher did not become ready");
    },
    close() {
      watcher.close();
      for (const t of timers.values()) clearTimeout(t);
    },
  };
}

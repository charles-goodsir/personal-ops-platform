import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@ops/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createQueue, watchNotes } from "./watch.js";

const logger = createLogger({ LOG_LEVEL: "fatal" });
let dir: string;
let close: () => void;
const ingester = { ingestFile: vi.fn(), removeFile: vi.fn() };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "watch-"));
  await mkdir(join(dir, "sub"));
  vi.clearAllMocks();
  const queue = createQueue(logger);
  close = watchNotes({
    notesDir: dir,
    ingester,
    enqueue: queue.enqueue,
    logger,
    debounceMs: 100,
  }).close;
});

afterEach(async () => {
  close();
  await rm(dir, { recursive: true, force: true });
});

const settle = () => new Promise((r) => setTimeout(r, 500));

test("ingests a new or changed file once per burst of writes", async () => {
  for (const text of ["a", "ab", "abc"]) {
    await writeFile(join(dir, "sub/note.md"), text);
  }
  await vi.waitFor(() =>
    expect(ingester.ingestFile).toHaveBeenCalledWith("sub/note.md"),
  );
  await settle();
  expect(ingester.ingestFile).toHaveBeenCalledTimes(1);
});

test("removes a deleted file", async () => {
  await writeFile(join(dir, "gone.txt"), "x");
  await vi.waitFor(() => expect(ingester.ingestFile).toHaveBeenCalled());
  await rm(join(dir, "gone.txt"));
  await vi.waitFor(() =>
    expect(ingester.removeFile).toHaveBeenCalledWith("gone.txt"),
  );
});

test("ignores hidden and unsupported files", async () => {
  await mkdir(join(dir, ".obsidian"));
  await writeFile(join(dir, ".obsidian/workspace.md"), "x");
  await writeFile(join(dir, "photo.jpg"), "x");
  await settle();
  expect(ingester.ingestFile).not.toHaveBeenCalled();
});

test("queue runs tasks in order and survives a failure", async () => {
  const order: number[] = [];
  const queue = createQueue(logger);
  void queue.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push(1);
  });
  void queue.enqueue(async () => {
    throw new Error("boom");
  });
  void queue.enqueue(async () => {
    order.push(3);
  });
  await queue.idle();
  expect(order).toEqual([1, 3]);
});

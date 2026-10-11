import { createLogger, createTestDb, type Db } from "@ops/core";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Embedder } from "./embed.js";
import { createIngester } from "./ingest.js";
import { createNotesApi, notesChangedSince, type NotesApi } from "./notes.js";

// Fake embedder: one dimension per keyword, so similarity is predictable.
const KEYWORDS = ["docker", "ssh", "finance"];
const fakeEmbed: Embedder = async (texts) =>
  texts.map((t) =>
    Array.from({ length: 768 }, (_, i) =>
      t.toLowerCase().includes(KEYWORDS[i] ?? "\0") ? 1 : 0.01,
    ),
  );

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let notes: NotesApi;
let dir: string;

beforeAll(async () => {
  testDb = await createTestDb("notes");
  if (!testDb) return;
  dir = await mkdtemp(join(tmpdir(), "notes-api-"));
  const files: [string, string, number][] = [
    ["docker.md", "# Docker\n## Ports\ndocker publishes ports past ufw", 1],
    ["ssh.md", "# SSH\nssh password auth kept on the LAN", 2],
    ["money.txt", "finance notes for later", 3],
  ];
  for (const [name, text, day] of files) {
    await writeFile(join(dir, name), text);
    const when = new Date(`2026-10-0${day}T00:00:00Z`);
    await utimes(join(dir, name), when, when);
  }
  const deps = { db: testDb.db, embed: fakeEmbed, model: "fake" };
  await createIngester({
    ...deps,
    notesDir: dir,
    logger: createLogger({ LOG_LEVEL: "fatal" }),
  }).scan();
  notes = createNotesApi(deps);
});

afterAll(async () => {
  await testDb?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test.skipIf(!process.env.DATABASE_URL)(
  "search ranks the matching chunk first, with its source",
  async () => {
    const [top, ...rest] = await notes.searchNotes(
      "how does docker treat ports?",
      2,
    );
    expect(top).toMatchObject({
      title: "Docker",
      path: "docker.md",
      heading: "Docker > Ports",
    });
    expect(top?.score).toBeGreaterThan(rest[0]?.score ?? 1);
    expect(rest).toHaveLength(1);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "search ignores vectors from another model",
  async () => {
    const other = createNotesApi({
      db: testDb?.db as Db,
      embed: fakeEmbed,
      model: "other",
    });
    expect(await other.searchNotes("docker", 5)).toEqual([]);
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "getNote returns the full note, undefined if missing",
  async () => {
    const [hit] = await notes.searchNotes("ssh", 1);
    const note = await notes.getNote(hit?.noteId ?? "");
    expect(note).toMatchObject({
      title: "SSH",
      path: "ssh.md",
      content: "# SSH\nssh password auth kept on the LAN",
    });
    expect(await notes.getNote("999999")).toBeUndefined();
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "listRecentNotes is newest first",
  async () => {
    const recent = await notes.listRecentNotes(2);
    expect(recent.map((n) => n.path)).toEqual(["money.txt", "ssh.md"]);
    expect(recent[0]?.modifiedAt).toEqual(new Date("2026-10-03T00:00:00Z"));
  },
);

test.skipIf(!process.env.DATABASE_URL)(
  "notesChangedSince counts every match but returns only the newest few",
  async () => {
    const db = testDb?.db as Db;
    const since = new Date("2026-10-02T00:00:00Z");
    const one = await notesChangedSince(db, since, 1);
    expect(one.total).toBe(2);
    expect(one.notes.map((n) => n.path)).toEqual(["money.txt"]);
    expect(one.notes[0]).not.toHaveProperty("total");
    expect(
      await notesChangedSince(db, new Date("2027-01-01T00:00:00Z"), 5),
    ).toEqual({ total: 0, notes: [] });
  },
);

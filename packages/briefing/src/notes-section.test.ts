import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { notesSection } from "./notes-section.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
const build = (at: string) => notesSection(getDb(), () => new Date(at)).build();

beforeAll(async () => {
  testDb = await createTestDb("briefing_notes");
  if (!testDb) return;
  const notes: [string, string, string][] = [
    ["Old note", "old.md", "2026-10-01T09:00:00Z"],
    ...[1, 2, 3, 4, 5, 6, 7].map((i): [string, string, string] => [
      `Note ${i}`,
      `n${i}.md`,
      `2026-10-14T0${i}:00:00Z`,
    ]),
  ];
  for (const [title, path, modified] of notes)
    await getDb().query(
      `INSERT INTO notes (path, title, content, content_hash, modified_at)
       VALUES ($1, $2, 'SECRET BODY TEXT', 'h', $3)`,
      [path, title, modified],
    );
});
afterAll(() => testDb?.drop());

const run = test.skipIf(!process.env.DATABASE_URL);

run(
  "lists the newest titles and counts the rest, never the note text",
  async () => {
    const text = await build("2026-10-14T18:00:00Z");
    expect(text).toBe(
      "Notes\n7 changed in the last day: Note 7, Note 6, Note 5, Note 4, Note 3 and 2 more",
    );
    expect(text).not.toContain("SECRET");
  },
);

run("says nothing when no note changed in the last day", async () => {
  expect(await build("2026-10-20T18:00:00Z")).toBeNull();
});

run("a note modified just over 24 hours ago is left out", async () => {
  // Note 1 is 01:00Z on the 14th; at 01:00:01Z on the 15th it's 24h and 1s old.
  expect(await build("2026-10-15T01:00:01Z")).toBe(
    "Notes\n6 changed in the last day: Note 7, Note 6, Note 5, Note 4, Note 3 and 1 more",
  );
});

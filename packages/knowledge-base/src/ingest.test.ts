import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Embedder } from "./embed.js";
import { createIngester, listFiles } from "./ingest.js";

const url = process.env.DATABASE_URL;
let testDb: Awaited<ReturnType<typeof createTestDb>>;
let db: Db | undefined;
const getDb = () => {
  if (!db) throw new Error("no database");
  return db;
};
let dir: string;

beforeAll(async () => {
  testDb = await createTestDb("ingest");
  db = testDb?.db;
});
afterAll(() => testDb?.drop());

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notes-"));
  await db?.query("TRUNCATE notes CASCADE");
  return () => rm(dir, { recursive: true, force: true });
});

// Deterministic fake: a 768-dim vector seeded from the text length.
const fakeEmbed = vi.fn<Embedder>(async (texts) =>
  texts.map((t) =>
    Array.from({ length: 768 }, (_, i) => (i === t.length % 768 ? 1 : 0)),
  ),
);

function ingester(model = "test-model") {
  fakeEmbed.mockClear();
  return createIngester({
    db: getDb(),
    embed: fakeEmbed,
    model,
    notesDir: dir,
    logger: createLogger({ LOG_LEVEL: "fatal" }),
  });
}

const write = async (path: string, text: string) => {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), text);
};

const chunksOf = async (path: string) =>
  (
    await getDb().query<{
      content: string;
      heading: string | null;
      model: string;
    }>(
      `SELECT c.content, c.heading, c.model FROM chunks c JOIN notes n ON n.id = c.note_id
       WHERE n.path = $1 ORDER BY c.ordinal`,
      [path],
    )
  ).rows;

test("listFiles: supported types only, relative, skips hidden", async () => {
  await write("a.md", "x");
  await write("sub/b.txt", "x");
  await write("photo.jpg", "x");
  await write(".obsidian/c.md", "x");
  await write(".hidden.md", "x");
  expect(await listFiles(dir)).toEqual(["a.md", "sub/b.txt"]);
});

test.skipIf(!url)(
  "adds, skips unchanged, updates changed, removes deleted",
  async () => {
    await write("docker.md", "# Docker\n## Ports\nbind to loopback");
    await write("sub/old.txt", "old note");

    expect(await ingester().scan()).toMatchObject({ added: 2, failed: 0 });
    expect(await chunksOf("docker.md")).toEqual([
      {
        content: "bind to loopback",
        heading: "Docker > Ports",
        model: "test-model",
      },
    ]);
    // The heading is embedded with the text.
    expect(fakeEmbed.mock.calls.flatMap(([t]) => t)).toContain(
      "Docker > Ports\n\nbind to loopback",
    );

    const again = ingester();
    expect(await again.scan()).toMatchObject({ unchanged: 2, added: 0 });
    expect(fakeEmbed).not.toHaveBeenCalled();

    await write("docker.md", "# Docker\nnew text");
    await rm(join(dir, "sub/old.txt"));
    expect(await ingester().scan()).toMatchObject({
      updated: 1,
      removed: 1,
      unchanged: 0,
    });
    expect(await chunksOf("docker.md")).toEqual([
      { content: "new text", heading: "Docker", model: "test-model" },
    ]);
    expect(await chunksOf("sub/old.txt")).toEqual([]);
  },
);

test.skipIf(!url)("a new model re-embeds unchanged files", async () => {
  await write("a.md", "text");
  await ingester("model-a").scan();
  expect(await ingester("model-b").scan()).toMatchObject({ updated: 1 });
  expect((await chunksOf("a.md"))[0]?.model).toBe("model-b");
});

test.skipIf(!url)("an empty folder keeps the existing index", async () => {
  await write("a.md", "text");
  await ingester().scan();
  await rm(join(dir, "a.md"));
  expect(await ingester().scan()).toMatchObject({ removed: 0 });
  expect(await chunksOf("a.md")).toHaveLength(1);
});

test.skipIf(!url)("one failing file doesn't stop the scan", async () => {
  await write("bad.pdf", "not really a pdf");
  await write("good.md", "fine");
  expect(await ingester().scan()).toMatchObject({ added: 1, failed: 1 });
  expect(await chunksOf("good.md")).toHaveLength(1);
});

test.skipIf(!url)("removeFile deletes the note and its chunks", async () => {
  await write("a.md", "text");
  const ing = ingester();
  await ing.scan();
  expect(await ing.removeFile("a.md")).toBe(true);
  expect(await ing.removeFile("a.md")).toBe(false);
  expect(await chunksOf("a.md")).toEqual([]);
});

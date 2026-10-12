import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { chunkMarkdown, chunkText } from "./chunk.js";
import type { Embedder } from "./embed.js";
import { createIngester } from "./ingest.js";

// Batch C (C4, C5, C6) of the threat model: files in the notes folder that I did
// not write, or that are broken. Real Postgres. Each test asserts the secure
// behaviour, so a failure is a finding.
const timed = async <T>(fn: () => T | Promise<T>) => {
  const t = Date.now();
  const out = await fn();
  return { out, ms: Date.now() - t };
};

describe("C6: pathological Markdown and text", () => {
  test.each<[string, () => string]>([
    ["one 1 MB line", () => "x".repeat(1_000_000)],
    ["one 1 MB line of words", () => "word ".repeat(200_000)],
    [
      "50,000 headings",
      () =>
        Array.from({ length: 50_000 }, (_, i) => `# h${i}\ntext`).join("\n"),
    ],
    [
      "deeply nested heading levels",
      () => "#".repeat(100_000) + " title\ntext",
    ],
    ["200,000 blank lines", () => "\n".repeat(200_000)],
    ["200,000 one-letter lines", () => "a\n".repeat(200_000)],
    [
      "a code fence that never closes",
      () => "```\n" + "line\n".repeat(100_000),
    ],
    [
      "a frontmatter that never closes",
      () => "---\n" + "key: v\n".repeat(100_000),
    ],
  ])(
    "%s is chunked in under two seconds, in bounded pieces",
    async (_n, make) => {
      const text = make();
      const md = await timed(() => chunkMarkdown(text));
      const plain = await timed(() => chunkText(text));
      expect(md.ms).toBeLessThan(2000);
      expect(plain.ms).toBeLessThan(2000);
      for (const c of [...md.out, ...plain.out])
        expect(c.content.length).toBeLessThanOrEqual(1500);
    },
  );
});

const run = process.env.DATABASE_URL ? describe : describe.skip;
const embed = vi.fn<Embedder>(async (texts) =>
  texts.map(() => Array.from({ length: 768 }, () => 0.01)),
);
let testDb: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let notesDir: string;
let outside: string;
let ingester: ReturnType<typeof createIngester>;
const rows = async () =>
  (
    await db.query<{ path: string; content: string }>(
      "SELECT path, content FROM notes",
    )
  ).rows;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  testDb = await createTestDb("attack_ingest");
  if (!testDb) return;
  db = testDb.db;
  notesDir = await mkdtemp(join(tmpdir(), "attack-notes-"));
  outside = await mkdtemp(join(tmpdir(), "attack-outside-"));
  ingester = createIngester({
    db,
    embed,
    model: "fake",
    notesDir,
    logger: createLogger({ LOG_LEVEL: "fatal" }),
  });
});
afterAll(() => testDb?.drop());

run("C4: links and odd paths", () => {
  test("a symlink to a file outside the folder is never indexed, by a scan or by a file event", async () => {
    await writeFile(
      join(outside, "secret.md"),
      "# Secret\nTOP SECRET OUTSIDE TEXT",
    );
    await writeFile(join(notesDir, "ok.md"), "# Ok\nordinary");
    await symlink(join(outside, "secret.md"), join(notesDir, "link.md"));
    await ingester.scan();
    // The watcher hands a changed path straight to ingestFile, not through the scan.
    await ingester.ingestFile("link.md").catch(() => undefined);
    const all = await rows();
    expect(all.map((r) => r.path)).toEqual(["ok.md"]);
    expect(JSON.stringify(all)).not.toContain("TOP SECRET");
  });

  test("a symlink to a note inside the folder is not indexed a second time", async () => {
    await symlink(join(notesDir, "ok.md"), join(notesDir, "inner-link.md"));
    await ingester.scan();
    await ingester.ingestFile("inner-link.md").catch(() => undefined);
    expect((await rows()).map((r) => r.path)).not.toContain("inner-link.md");
  });

  test("a symlinked folder is not followed", async () => {
    await writeFile(
      join(outside, "inside.md"),
      "# Inside\nTOP SECRET FOLDER TEXT",
    );
    await symlink(outside, join(notesDir, "linkdir"));
    await ingester.scan();
    await ingester.ingestFile("linkdir/inside.md").catch(() => undefined);
    expect(JSON.stringify(await rows())).not.toContain("TOP SECRET");
  });

  test("a path that climbs out of the folder is refused", async () => {
    await writeFile(join(outside, "up.md"), "# Up\nTOP SECRET CLIMB TEXT");
    const rel = `../${outside.split("/").pop()}/up.md`;
    await ingester.ingestFile(rel).catch(() => undefined);
    expect(JSON.stringify(await rows())).not.toContain("TOP SECRET");
  });

  test("a file name with a newline and odd characters is handled", async () => {
    await writeFile(
      join(notesDir, "odd\nname 'quoted' \"x\" ; DROP.md"),
      "# Odd\nbody",
    );
    await ingester.scan();
    expect((await rows()).length).toBeGreaterThan(0);
  });
});

run("C5: broken and huge files", () => {
  test("a malformed PDF is logged and skipped, and the other notes are still indexed", async () => {
    await writeFile(
      join(notesDir, "garbage.pdf"),
      Buffer.from([1, 2, 3, 255, 0, 9]),
    );
    await writeFile(join(notesDir, "trunc.pdf"), "%PDF-1.4\n1 0 obj\n<< /Type");
    await writeFile(join(notesDir, "after.md"), "# After\nstill indexed");
    const counts = await ingester.scan();
    expect(counts.failed).toBeGreaterThanOrEqual(2);
    expect((await rows()).map((r) => r.path)).toContain("after.md");
  });

  test("a file over the size limit is skipped before it reaches the embedder", async () => {
    const calls = embed.mock.calls.length;
    await writeFile(
      join(notesDir, "big.txt"),
      "line of text\n".repeat(2_000_000), // about 26 MB
    );
    const { ms } = await timed(() =>
      ingester.ingestFile("big.txt").catch(() => undefined),
    );
    expect(embed.mock.calls.length).toBe(calls);
    expect(ms).toBeLessThan(2000);
    expect((await rows()).map((r) => r.path)).not.toContain("big.txt");
  });

  test("a scan after a bad file still removes notes whose file has gone", async () => {
    await writeFile(join(notesDir, "gone.md"), "# Gone\nsoon");
    await ingester.scan();
    expect((await rows()).map((r) => r.path)).toContain("gone.md");
    await rm(join(notesDir, "gone.md"));
    await ingester.scan();
    expect((await rows()).map((r) => r.path)).not.toContain("gone.md");
  });
});

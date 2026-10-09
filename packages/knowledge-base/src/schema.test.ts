import { createDb } from "@ops/core";
import { afterAll, expect, test } from "vitest";

// Integration test: runs only when a migrated database is available.
const url = process.env.DATABASE_URL;
const db = url ? createDb({ DATABASE_URL: url }) : undefined;
afterAll(() => db?.end());

// A 768-dim vector with a single 1 at position i.
const unit = (i: number) =>
  `[${Array.from({ length: 768 }, (_, j) => (j === i ? 1 : 0)).join(",")}]`;

test.skipIf(!db)(
  "stores chunks, finds the nearest, cascades deletes",
  async () => {
    if (!db) return;
    const client = await db.connect();
    try {
      await client.query("BEGIN"); // rolled back, so nothing is left behind
      const {
        rows: [note],
      } = await client.query<{ id: string }>(
        `INSERT INTO notes (path, title, content, content_hash, modified_at)
       VALUES ('test/a.md', 'A', 'body', 'hash', now()) RETURNING id`,
      );
      await client.query(
        `INSERT INTO chunks (note_id, ordinal, content, embedding, model)
       VALUES ($1, 0, 'near', $2, 'test'), ($1, 1, 'far', $3, 'test')`,
        [note?.id, unit(0), unit(1)],
      );

      const { rows: nearest } = await client.query<{ content: string }>(
        "SELECT content FROM chunks ORDER BY embedding <=> $1 LIMIT 1",
        [unit(0)],
      );
      expect(nearest[0]?.content).toBe("near");

      // Savepoint, because a failed statement aborts the whole transaction.
      await client.query("SAVEPOINT dims");
      await expect(
        client.query(
          `INSERT INTO chunks (note_id, ordinal, content, embedding, model)
         VALUES ($1, 2, 'bad', '[1,2,3]', 'test')`,
          [note?.id],
        ),
      ).rejects.toThrow(/expected 768 dimensions/);
      await client.query("ROLLBACK TO SAVEPOINT dims");

      await client.query("DELETE FROM notes WHERE id = $1", [note?.id]);
      const { rows: left } = await client.query(
        "SELECT 1 FROM chunks WHERE note_id = $1",
        [note?.id],
      );
      expect(left).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  },
);

import { readdir, readFile } from "node:fs/promises";
import { createDb, type Db } from "./db.js";

// Integration tests run in a throwaway schema built from the real migrations,
// so they can never touch real notes. Returns undefined without DATABASE_URL.
export async function createTestDb(
  name: string,
): Promise<{ db: Db; drop: () => Promise<void> } | undefined> {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  const schema = `kb_test_${name}_${process.pid}`;
  const scoped = new URL(url);
  scoped.searchParams.set("options", `-c search_path=${schema},public`);
  const db = createDb({ DATABASE_URL: scoped.href });
  await db.query(`CREATE SCHEMA ${schema}`);
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir)).sort()) {
    const sql = await readFile(new URL(file, dir), "utf8");
    await db.query(sql.split("-- Down Migration")[0] ?? "");
  }
  return {
    db,
    drop: async () => {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await db.end();
    },
  };
}

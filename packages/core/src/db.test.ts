import { afterAll, expect, test } from "vitest";
import { checkDb, createDb } from "./db.js";

// Integration test: runs only when a database is available.
const url = process.env.DATABASE_URL;
const db = url ? createDb({ DATABASE_URL: url }) : undefined;
afterAll(() => db?.end());

test.skipIf(!db)("connects to Postgres", async () => {
  if (!db) return;
  expect(await checkDb(db)).toBe(true);
});

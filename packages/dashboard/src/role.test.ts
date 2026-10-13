import { createDb, createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { readOnlyUrl } from "./config.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let ro: Db | undefined;

beforeAll(async () => {
  testDb = await createTestDb("dashboard_role");
  if (!testDb) return;
  const { rows } = await testDb.db.query<{ schema: string }>(
    "SELECT current_schema() AS schema",
  );
  // The real tables live in public, where everyone has USAGE. A throwaway
  // schema does not, so the role is given it here.
  await testDb.db.query(
    `GRANT USAGE ON SCHEMA ${rows[0]?.schema} TO dashboard_ro`,
  );
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.set("options", `-c search_path=${rows[0]?.schema},public`);
  ro = createDb({ DATABASE_URL: readOnlyUrl(url.href) });
});
afterAll(async () => {
  await ro?.end();
  await testDb?.drop();
});

const needsDb = test.skipIf(!process.env.DATABASE_URL);
const db = () => {
  if (!ro) throw new Error("no database");
  return ro;
};

needsDb(
  "D4: the connection runs as dashboard_ro and reads the four tables",
  async () => {
    const { rows } = await db().query("SELECT current_user AS u");
    expect(rows[0]?.u).toBe("dashboard_ro");
    for (const table of ["transactions", "accounts", "budgets", "job_runs"])
      await db().query(`SELECT count(*) FROM ${table}`);
  },
);

needsDb("D4: it cannot write, delete, truncate or create", async () => {
  for (const sql of [
    "INSERT INTO budgets (category, monthly_limit) VALUES ('Groceries', 1)",
    "UPDATE budgets SET monthly_limit = 1",
    "DELETE FROM transactions",
    "TRUNCATE accounts",
    "UPDATE job_runs SET consecutive_failures = 0",
    "CREATE TABLE x (a int)",
  ])
    await expect(db().query(sql), sql).rejects.toThrow(/permission denied/);
});

needsDb("D4: it cannot read tables the page does not need", async () => {
  for (const table of ["category_rules", "notes", "chunks"])
    await expect(db().query(`SELECT 1 FROM ${table}`), table).rejects.toThrow(
      /permission denied/,
    );
});

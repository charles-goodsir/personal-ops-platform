import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { financeSection } from "./finance-section.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
const build = (at: string) =>
  financeSection(getDb(), () => new Date(at)).build();

beforeAll(async () => {
  testDb = await createTestDb("briefing_finance");
  if (!testDb) return;
  const db = getDb();
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  const rows: [string, string, number, string][] = [
    ["2026-10-14", "COUNTDOWN PONSONBY", -30, "Groceries"],
    ["2026-10-14", "CAFE", -12.1, "Eating out"],
    ["2026-10-14", "TICKETMASTER 1234567890", -300, "Entertainment"],
    ["2026-10-03", "COUNTDOWN", -100, "Groceries"],
    ["2026-10-05", "PAK N SAVE", -50, "Groceries"],
    ["2026-10-10", "TO SAVINGS", -500, "Transfers"],
    ["2026-09-02", "COUNTDOWN", -200, "Groceries"],
    ["2026-09-10", "PAK N SAVE", -90, "Groceries"],
    ...[16, 18, 20, 22, 24].map((d): [string, string, number, string] => [
      `2026-09-${d}`,
      `CINEMA ${d}`,
      -20,
      "Entertainment",
    ]),
  ];
  for (const [i, [date, description, amount, category]] of rows.entries()) {
    await db.query(
      `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
       VALUES ($1, 'acc', $2::date + time '10:59', $3, $4, 'EFTPOS', $5, now())`,
      [`t${i}`, date, description, amount, category],
    );
  }
});
afterAll(() => testDb?.drop());

const run = test.skipIf(!process.env.DATABASE_URL);

// 07:00 NZDT on 15 October: yesterday is the 14th.
run(
  "yesterday, the month so far against last month, and an unusual charge",
  async () => {
    expect(await build("2026-10-14T18:00:00Z")).toBe(
      [
        "Finance",
        "Yesterday: $342.10 (Entertainment $300.00, Groceries $30.00)",
        "This month so far: $492.10 vs $290.00 at this point last month",
        "Unusual: TICKETMASTER [number] $300.00, about 15x the usual Entertainment charge of $20.00",
      ].join("\n"),
    );
  },
);

run(
  "transfers don't count, and the text carries no raw description",
  async () => {
    const text = await build("2026-10-14T18:00:00Z");
    expect(text).not.toContain("500");
    for (const leak of ["1234567890", "PONSONBY", "Everyday"])
      expect(text).not.toContain(leak);
  },
);

run("a day with no spending says so and flags nothing", async () => {
  const text = await build("2026-10-19T18:00:00Z");
  expect(text).toContain("Yesterday: nothing spent");
  expect(text).not.toContain("Unusual");
});

run("on the 1st there is no month so far to compare", async () => {
  // 07:00 NZDT on 1 November.
  const text = await build("2026-10-31T18:00:00Z");
  expect(text).toContain("Yesterday: nothing spent");
  expect(text).not.toContain("This month so far");
});

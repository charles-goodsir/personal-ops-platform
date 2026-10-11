import { createTestDb, type Db, type Logger } from "@ops/core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { buildDigest, plainSummary, sendWeeklySummary } from "./summary.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
// A Monday afternoon in NZ: the week to summarise is 5 to 11 October.
const now = new Date("2026-10-12T00:00:00Z");

beforeAll(async () => {
  testDb = await createTestDb("summary");
  if (!testDb) return;
  const db = getDb();
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
  const rows: [string, string, number, string, string | null][] = [
    ["2026-10-06", "COUNTDOWN PONSONBY", -100, "Groceries", null],
    ["2026-10-07", "NETFLIX.COM", -19.99, "Entertainment", "Netflix"],
    ["2026-10-08", "TICKETMASTER 1234567890", -300, "Entertainment", null],
    ["2026-10-09", "SHARESIES", -200, "Investments", null],
    ["2026-10-10", "TO SAVINGS", -500, "Transfers", null],
    ["2026-10-01", "COUNTDOWN PONSONBY", -50, "Groceries", null],
    ["2026-08-07", "NETFLIX.COM", -19.99, "Entertainment", "Netflix"],
    ["2026-09-07", "NETFLIX.COM", -19.99, "Entertainment", "Netflix"],
    ...[10, 12, 14, 16, 18].map(
      (d): [string, string, number, string, string | null] => [
        `2026-09-${d}`,
        `CINEMA ${d}`,
        -20,
        "Entertainment",
        null,
      ],
    ),
  ];
  for (const [
    i,
    [date, description, amount, category, merchant],
  ] of rows.entries()) {
    await db.query(
      `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, merchant, synced_at)
       VALUES ($1, 'acc', $2::date + time '11:59', $3, $4, 'EFTPOS', $5, $6, now())`,
      [`t${i}`, date, description, amount, category, merchant],
    );
  }
});
afterAll(() => testDb?.drop());

const run = test.skipIf(!process.env.DATABASE_URL);

run("digest: the week against the three before, extras flagged", async () => {
  const d = await buildDigest(getDb(), now);
  expect(d.week).toMatchObject({
    label: "2026-10-05 to 2026-10-11",
    spent: 419.99,
    invested: 200,
  });
  expect(d.previousWeeks).toHaveLength(3);
  expect(d.previousWeeks[0]).toMatchObject({ spent: 50 });
  expect(d.newSubscriptions).toEqual([
    { payee: "Netflix", cadence: "monthly", amount: 19.99 },
  ]);
  expect(d.unusual).toMatchObject([
    { payee: "TICKETMASTER [number]", amount: 300 },
  ]);
});

run("digest: no transaction text, account names or long numbers", async () => {
  const json = JSON.stringify(await buildDigest(getDb(), now));
  for (const leak of ["1234567890", "Everyday", "PONSONBY", "SAVINGS"])
    expect(json).not.toContain(leak);
});

run("a failing model still sends the plain numbers", async () => {
  const send = vi.fn(async () => {});
  const warn = vi.fn();
  await sendWeeklySummary({
    db: getDb(),
    send,
    summarise: async () => {
      throw new Error("model down");
    },
    logger: { warn } as unknown as Logger,
    now,
  });
  expect(warn).toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith(
    plainSummary(await buildDigest(getDb(), now)),
  );
});

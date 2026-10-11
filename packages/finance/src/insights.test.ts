import { expect, test } from "vitest";
import {
  detectRecurring,
  findAnomalies,
  payeeKey,
  type Tx,
} from "./insights.js";

const now = new Date("2026-10-11T00:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const tx = (
  days: number,
  description: string,
  amount: number,
  category: string | null = "Other",
  merchant: string | null = null,
): Tx => ({
  date: ago(days),
  description,
  merchant,
  amount,
  category,
});

test("payeeKey prefers the merchant, else strips digits and punctuation", () => {
  expect(
    payeeKey({ merchant: "Netflix", description: "NETFLIX.COM 0423" }),
  ).toBe("Netflix");
  expect(payeeKey({ merchant: null, description: "NETFLIX.COM 0423" })).toBe(
    payeeKey({ merchant: null, description: "NETFLIX.COM 0523" }),
  );
});

test("finds a monthly subscription even when the date drifts a few days", () => {
  const txs = [0, 31, 59, 90, 121].map((d) =>
    tx(d + 5, `SPOTIFY P${d}`, -16.99, "Subscriptions"),
  );
  const [sub, ...rest] = detectRecurring(txs, now);
  expect(rest).toEqual([]);
  expect(sub).toMatchObject({
    payee: "spotify p",
    cadence: "monthly",
    typicalAmount: 16.99,
    monthlyCost: 16.99,
    charges: 5,
    active: true,
    category: "Subscriptions",
  });
});

test("weekly and yearly cadences, with monthly cost converted", () => {
  const weekly = [0, 7, 14, 21].map((d) => tx(d, "GYM", -10));
  const yearly = [10, 375].map((d) => tx(d, "DOMAIN RENEWAL", -30));
  const found = detectRecurring([...weekly, ...yearly], now);
  expect(found.map((r) => [r.payee, r.cadence, r.monthlyCost])).toEqual([
    ["gym", "weekly", 43.49],
    ["domain renewal", "yearly", 2.5],
  ]);
});

test("ignores irregular gaps, wildly varying amounts and too few charges", () => {
  const irregular = [0, 3, 40, 41, 90].map((d) => tx(d, "CAFE", -5));
  const varying = [0, 30, 60, 90].map((d, i) =>
    tx(d, "POWER CO", -([50, 120, 45, 200][i] ?? 0)),
  );
  const twoMonthly = [0, 30].map((d) => tx(d, "TRIAL", -9));
  const income = [0, 14, 28, 42].map((d) => tx(d, "SALARY", 2000, "Income"));
  expect(
    detectRecurring([...irregular, ...varying, ...twoMonthly, ...income], now),
  ).toEqual([]);
});

test("a subscription that stopped is detected but marked inactive", () => {
  const txs = [100, 130, 160, 190].map((d) => tx(d, "OLD SERVICE", -20));
  const [sub] = detectRecurring(txs, now);
  expect(sub?.active).toBe(false);
});

test("flags a charge far above its category's normal", () => {
  const history = [20, 40, 60, 80, 100, 120].map((d) =>
    tx(d, `COUNTDOWN ${d}`, -60, "Groceries", "Countdown"),
  );
  const big = tx(2, "COUNTDOWN", -400, "Groceries", "Countdown");
  const normal = tx(3, "COUNTDOWN", -70, "Groceries", "Countdown");
  const found = findAnomalies([...history, big, normal], ago(7), now);
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({
    amount: -400,
    reason: "large_for_category",
  });
  expect(found[0]?.detail).toBe(
    "about 7x the usual Groceries charge of $60.00",
  );
});

test("flags a big first charge from a new payee, not a small one or a familiar one", () => {
  const familiar = tx(200, "BUNNINGS", -150, "Shopping", "Bunnings");
  const found = findAnomalies(
    [
      familiar,
      tx(1, "BUNNINGS", -180, "Shopping", "Bunnings"),
      tx(1, "NEW TECH STORE", -900, "Shopping"),
      tx(1, "NEW CAFE", -12, "Eating out"),
    ],
    ago(7),
    now,
  );
  expect(found.map((a) => [a.description, a.reason])).toEqual([
    ["NEW TECH STORE", "new_payee_large"],
  ]);
});

test("transfers, income and investments are never anomalies", () => {
  const found = findAnomalies(
    [
      tx(1, "RENT TO LANDLORD", -2000, "Transfers"),
      tx(1, "BONUS", 5000, "Income"),
      tx(1, "SHARESIES BLINKPAY", -500, "Investments"),
    ],
    ago(7),
    now,
  );
  expect(found).toEqual([]);
});

test("a recurring bill at its usual amount isn't unusual, a jump in it is", () => {
  const otherUtilities = [20, 40, 60, 80, 100, 120].map((d) =>
    tx(d, `WATER ${d}`, -30, "Utilities"),
  );
  const phone = [35, 65, 95, 125].map((d) =>
    tx(d, "2DEGREES", -95, "Utilities", "2degrees"),
  );
  const usual = tx(4, "2DEGREES", -98.53, "Utilities", "2degrees");
  const jump = tx(2, "2DEGREES", -300, "Utilities", "2degrees");
  const found = findAnomalies(
    [...otherUtilities, ...phone, usual, jump],
    ago(7),
    now,
  );
  expect(found.map((a) => a.amount)).toEqual([-300]);
});

test("a monthly bill paid early or late once is still monthly", () => {
  // The real 2degrees pattern: gaps of 33, 21, 38, 31, 30 days.
  const days = [0, 30, 61, 99, 120, 153];
  const txs = days.map((d, i) =>
    tx(d, "2DEGREES", -(92 + i), "Utilities", "2degrees"),
  );
  expect(detectRecurring(txs, now)).toMatchObject([
    { payee: "2degrees", cadence: "monthly" },
  ]);
});

test("a retried bill without a merchant still matches its recurring payee", () => {
  const otherUtilities = [20, 40, 60, 80, 100, 120].map((d) =>
    tx(d, `WATER ${d}`, -30, "Utilities"),
  );
  const phone = [35, 65, 95, 125].map((d) =>
    tx(d, "2DEGREES 123", -95, "Utilities", "2degrees"),
  );
  const retry = tx(
    3,
    "2degrees 2degrees 99 b23ad789",
    -98.53,
    "Utilities",
    null,
  );
  expect(
    findAnomalies([...otherUtilities, ...phone, retry], ago(7), now),
  ).toEqual([]);
});

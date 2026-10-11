import { expect, test } from "vitest";
import { dateRange, resolvePeriod } from "./periods.js";

// Thursday 1 October 2026, 06:00 NZDT (+13), still 30 September in UTC.
const now = new Date("2026-09-30T17:00:00Z");
const labels = (p: Parameters<typeof resolvePeriod>[0]) =>
  resolvePeriod(p, now).label;

test("uses the New Zealand date, not the UTC one", () => {
  expect(labels("this_month")).toBe("2026-10-01 to 2026-10-01");
  expect(labels("last_month")).toBe("2026-09-01 to 2026-09-30");
});

test("weeks run Monday to Sunday", () => {
  expect(labels("this_week")).toBe("2026-09-28 to 2026-10-01");
  expect(labels("last_week")).toBe("2026-09-21 to 2026-09-27");
});

test("last 30 days and this year include today", () => {
  expect(labels("last_30_days")).toBe("2026-09-02 to 2026-10-01");
  expect(labels("this_year")).toBe("2026-01-01 to 2026-10-01");
});

test("January's last month is December of the year before", () => {
  expect(
    resolvePeriod("last_month", new Date("2026-01-15T00:00:00Z")).label,
  ).toBe("2025-12-01 to 2025-12-31");
});

test("a range picks up Akahu's 23:59 NZ stamps for exactly those dates", () => {
  const { from, to } = resolvePeriod("last_month", now);
  // 30 Sep 23:59 NZST(+12) = 11:59Z; 1 Oct 23:59 NZDT(+13) = 10:59Z.
  const lastOfSept = new Date("2026-09-30T11:59:00Z");
  const firstOfOct = new Date("2026-10-01T10:59:00Z");
  const lastOfAug = new Date("2026-08-31T11:59:00Z");
  const inRange = (d: Date) => d >= from && d < to;
  expect([lastOfAug, lastOfSept, firstOfOct].map(inRange)).toEqual([
    false,
    true,
    false,
  ]);
});

test("explicit dates are inclusive, and must be in order", () => {
  expect(dateRange("2026-09-01", "2026-09-30").label).toBe(
    "2026-09-01 to 2026-09-30",
  );
  expect(() => dateRange("2026-09-30", "2026-09-01")).toThrow(/on or before/);
});

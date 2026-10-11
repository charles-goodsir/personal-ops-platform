// Calendar periods in New Zealand time, as [from, to) UTC instants.
//
// Akahu stamps a transaction at 23:59 NZ time on its date, so a range of NZ
// dates [d1, d2) maps to [d1 00:00Z, d2 00:00Z): that window holds exactly
// the stamps for d1 .. d2-1, whatever the NZ offset that day.

export const PERIODS = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_30_days",
  "this_year",
] as const;
export type Period = (typeof PERIODS)[number];

export type Range = { from: Date; to: Date; label: string };

const DAY = 86_400_000;
const utcDate = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Today's calendar date in New Zealand.
function nzToday(now: Date): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
  })
    .format(now)
    .split("-")
    .map(Number);
  return utcDate(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const range = (from: Date, to: Date): Range => ({
  from,
  to,
  label: `${iso(from)} to ${iso(new Date(to.getTime() - DAY))}`,
});

// Weeks start on Monday. Current periods run to the end of today.
export function resolvePeriod(period: Period, now = new Date()): Range {
  const today = nzToday(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const monday = new Date(
    today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY,
  );
  switch (period) {
    case "this_week":
      return range(monday, tomorrow);
    case "last_week":
      return range(new Date(monday.getTime() - 7 * DAY), monday);
    case "this_month":
      return range(utcDate(y, m, 1), tomorrow);
    case "last_month":
      return range(utcDate(y, m - 1, 1), utcDate(y, m, 1));
    case "last_30_days":
      return range(new Date(tomorrow.getTime() - 30 * DAY), tomorrow);
    case "this_year":
      return range(utcDate(y, 0, 1), tomorrow);
  }
}

// Explicit inclusive NZ dates, e.g. from "2026-09-01" to "2026-09-30".
export function dateRange(from: string, to: string): Range {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + DAY);
  if (!(start < end)) throw new Error("from must be on or before to");
  return range(start, end);
}

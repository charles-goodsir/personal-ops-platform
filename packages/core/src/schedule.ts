// When to run next, in New Zealand time. Clock changes are handled: "08:00"
// stays 08:00 on the wall clock either side of daylight saving.
const TZ = "Pacific/Auckland";

export type Schedule = {
  time: string; // "HH:MM", 24-hour, NZ time
  weekday?: number; // 0 = Sunday .. 6 = Saturday; every day when left out
};

const offsetMs = (t: number) => {
  const name =
    new Intl.DateTimeFormat("en", { timeZone: TZ, timeZoneName: "longOffset" })
      .formatToParts(t)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /([+-])(\d\d):(\d\d)/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
};

export function nextRun(now: Date, { time, weekday }: Schedule): Date {
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!t) throw new Error("time must be HH:MM, 24-hour");
  // NZ wall clock, read through UTC fields.
  const local = new Date(now.getTime() + offsetMs(now.getTime()));
  for (let d = 0; d <= 7; d++) {
    const wall = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + d,
      Number(t[1]),
      Number(t[2]),
    );
    if (weekday !== undefined && new Date(wall).getUTCDay() !== weekday)
      continue;
    // Look up the offset twice: the first guess can land on the wrong side of
    // a clock change. Times inside the skipped or repeated hour stay ambiguous.
    const guess = wall - offsetMs(wall - 12 * 3_600_000);
    const at = new Date(wall - offsetMs(guess));
    if (at > now) return at;
  }
  throw new Error("no matching day in the next 8 days");
}

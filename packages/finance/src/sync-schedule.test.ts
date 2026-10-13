import { expect, test } from "vitest";
import { nextSlot } from "./sync-schedule.js";

const slots = [
  { time: "08:00", alerts: true },
  { time: "00:05", alerts: false },
];
const next = (now: string, s = slots) => {
  const r = nextSlot(new Date(now), s);
  return { at: r.at.toISOString(), alerts: r.alerts };
};

test("in the evening the next sync is the quiet one just after midnight", () => {
  // 23:00 NZDT on 14 October.
  expect(next("2026-10-14T10:00:00Z")).toEqual({
    at: "2026-10-14T11:05:00.000Z", // 00:05 NZDT on the 15th
    alerts: false,
  });
});

test("after the night sync the next one is 08:00, with alerts", () => {
  // 00:10 NZDT on 15 October.
  expect(next("2026-10-14T11:10:00Z")).toEqual({
    at: "2026-10-14T19:00:00.000Z", // 08:00 NZDT on the 15th
    alerts: true,
  });
});

test("once the morning sync has passed, the next one is the quiet night sync again", () => {
  // 10:00 NZDT on 15 October: 08:00 has gone, so the next is 00:05 on the 16th.
  expect(next("2026-10-14T21:00:00Z")).toEqual({
    at: "2026-10-15T11:05:00.000Z",
    alerts: false,
  });
});

test("with the night sync off there is only the morning one", () => {
  const morning = [{ time: "08:00", alerts: true }];
  expect(next("2026-10-14T10:00:00Z", morning)).toEqual({
    at: "2026-10-14T19:00:00.000Z",
    alerts: true,
  });
});

test("the 00:05 time stays on the wall clock the night daylight saving starts", () => {
  // Clocks go forward at 02:00 on 27 September 2026, so 00:05 that night is +12, not +13.
  expect(next("2026-09-26T10:00:00Z", slots).at).toBe(
    "2026-09-26T12:05:00.000Z",
  );
});

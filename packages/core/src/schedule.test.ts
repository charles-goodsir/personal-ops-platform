import { expect, test } from "vitest";
import { nextRun, type Schedule } from "./schedule.js";

const weekly: Schedule = { time: "08:00", weekday: 1 };
const next = (now: string, s = weekly) =>
  nextRun(new Date(now), s).toISOString();

test("weekly: Monday 08:00 NZ, later the same day or a week on", () => {
  // Monday 07:00 NZDT, then 09:00 NZDT.
  expect(next("2026-10-11T18:00:00Z")).toBe("2026-10-11T19:00:00.000Z");
  expect(next("2026-10-11T20:00:00Z")).toBe("2026-10-18T19:00:00.000Z");
});

test("weekly: across the daylight saving ends (4 April 2027, NZST is +12)", () => {
  expect(next("2027-03-30T00:00:00Z")).toBe("2027-04-04T20:00:00.000Z");
});

test("weekly: across the daylight saving start (27 September 2026, NZDT is +13)", () => {
  // Monday 28 September 08:00 NZDT.
  expect(next("2026-09-22T00:00:00Z")).toBe("2026-09-27T19:00:00.000Z");
});

test("daily: today if the time hasn't passed, else tomorrow", () => {
  const daily = { time: "07:00" };
  // 06:00 NZDT on 14 October, then 07:30.
  expect(next("2026-10-13T17:00:00Z", daily)).toBe("2026-10-13T18:00:00.000Z");
  expect(next("2026-10-13T18:30:00Z", daily)).toBe("2026-10-14T18:00:00.000Z");
});

test("daily: a run exactly at the time moves to the next day", () => {
  expect(next("2026-10-13T18:00:00Z", { time: "07:00" })).toBe(
    "2026-10-14T18:00:00.000Z",
  );
});

test("daily: stays 07:00 on the wall clock the morning daylight saving starts", () => {
  // 27 September 2026: clocks go forward at 02:00, so 07:00 is +13 that day.
  expect(next("2026-09-26T12:00:00Z", { time: "07:00" })).toBe(
    "2026-09-26T18:00:00.000Z",
  );
});

test("rejects a time that isn't HH:MM", () => {
  for (const time of ["7:00", "24:00", "07:60", "noon"])
    expect(() => nextRun(new Date(), { time })).toThrow(/HH:MM/);
});

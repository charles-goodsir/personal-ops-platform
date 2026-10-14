import { nextRun } from "@ops/core";

// A time of day (NZ) the sync runs at, and whether it may send alerts.
export type Slot = { time: string; alerts: boolean };

// The soonest of the daily slots after `now`.
export function nextSlot(
  now: Date,
  slots: Slot[],
): { at: Date; alerts: boolean } {
  return slots
    .map((s) => ({ at: nextRun(now, { time: s.time }), alerts: s.alerts }))
    .reduce((a, b) => (b.at < a.at ? b : a));
}

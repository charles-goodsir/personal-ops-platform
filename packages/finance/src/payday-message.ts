import type { Goal } from "./goals.js";
import type { BigCharge } from "./payday-plan.js";
import { formatPlan } from "./format.js";
import { computePlan, lastPayday, nzDate } from "./payday-plan.js";
import type { PaydaySettings } from "./payday-settings.js";

const DAY = 86_400_000;
// The message goes out the day after payday. If a send fails it is tried again
// at each morning sync for three more days, then skipped.
const FIRST_DAY = 1;
const LAST_DAY = 4;

export type PaydayResult =
  "sent" | "not set" | "not yet" | "too early" | "already sent" | "late";

// Sends the payday message when it is due, once per payday. Call it after the
// morning sync. A failed send throws before anything is recorded, so the next
// call tries again. Nothing is sent or recorded in any other case.
export async function sendPaydayMessage(
  deps: {
    settings: {
      getSettings(): Promise<PaydaySettings>;
      lastSent(): Promise<string | null>;
      markSent(payday: string): Promise<void>;
    };
    goals: { listGoals(): Promise<Goal[]> };
    spent: (payday: string) => Promise<number>;
    biggest?: (payday: string) => Promise<BigCharge | null>;
    paySeen: (payday: string, pay: number) => Promise<boolean>;
    send: (text: string) => Promise<void>;
  },
  now = new Date(),
): Promise<PaydayResult> {
  const settings = await deps.settings.getSettings();
  if (settings.payday === null) return "not set";
  const today = nzDate(now);
  const payday = lastPayday(settings.payday, today);
  if (payday === null) return "not yet";
  const days =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${payday}T00:00:00Z`)) /
    DAY;
  if (days < FIRST_DAY) return "too early";
  if (days > LAST_DAY) return "late";
  const sent = await deps.settings.lastSent();
  if (sent !== null && sent >= payday) return "already sent";

  const goals = await deps.goals.listGoals();
  const unset = computePlan(settings, 0, goals);
  let text: string;
  if (!unset.ready) text = formatPlan(unset, payday);
  else {
    text = formatPlan(
      computePlan(settings, await deps.spent(payday), goals),
      payday,
      (await deps.biggest?.(payday)) ?? null,
    );
    if (!(await deps.paySeen(payday, settings.pay as number)))
      text += "\nThe pay is not in my data yet, so this uses the pay you set.";
  }
  await deps.send(text);
  await deps.settings.markSent(payday);
  return "sent";
}

import type { Db } from "@ops/core";
import { createPaydaySettingsApi, currentMeter, nzDate } from "@ops/finance";
import type { Section } from "./runner.js";

// This fortnight's spending against the target. Nothing to say, and no
// heading, until a payday and a spending target are set.
export function spendingSection(db: Db, now = () => new Date()): Section {
  return {
    name: "Spending this fortnight",
    async build() {
      const settings = await createPaydaySettingsApi(db).getSettings();
      const m = await currentMeter(db, settings, nzDate(now()));
      if (m === null) return null;
      return `$${m.spent.toFixed(2)} of $${m.target.toFixed(2)} (${m.percent}%), ${m.daysLeft} days to payday${m.percent >= 100 ? " OVER" : ""}`;
    },
  };
}

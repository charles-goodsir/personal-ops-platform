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
      const m = await currentMeter(db, settings, nzDate(now()), now());
      if (m === null) return null;
      const nzd = (n: number) => `$${n.toFixed(2)}`;
      const days = `${m.daysLeft} days to payday`;
      const p = m.pending;
      // With charges still pending, the headline is settled plus pending, as
      // an estimate, and the split follows. Without them the line is as before.
      if (p && p.count > 0)
        return `about ${nzd(m.spent + p.spent)} of ${nzd(m.target)} (${p.percent}%), ${days}${p.percent >= 100 ? " OVER" : ""}. ${nzd(m.spent)} settled, about ${nzd(p.spent)} pending (${p.count} ${p.count === 1 ? "charge" : "charges"}).`;
      return `${nzd(m.spent)} of ${nzd(m.target)} (${m.percent}%), ${days}${m.percent >= 100 ? " OVER" : ""}`;
    },
  };
}

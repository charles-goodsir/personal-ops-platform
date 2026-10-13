import type { Db } from "@ops/core";
import {
  createFinanceApi,
  dateRange,
  findAnomalies,
  formatFreshness,
  loadRecentTxs,
  maskDigits,
} from "@ops/finance";
import type { Section } from "./runner.js";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const usd = (n: number) => `$${n.toFixed(2)}`;

// Yesterday's spending, the month so far against the same point last month,
// and any unusual charge from yesterday. Spending leaves out transfers and
// investments, as everywhere else. Akahu refreshes once a day, so a late
// refresh can make yesterday look light.
export function financeSection(db: Db, now = () => new Date()): Section {
  return {
    name: "Finance",
    async build() {
      const at = now();
      // Today's date in NZ, as a UTC midnight.
      const today = new Date(
        `${new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(at)}T00:00:00Z`,
      );
      const yesterday = new Date(today.getTime() - DAY);
      const api = createFinanceApi(db);

      const day = await api.getSpending(
        dateRange(iso(yesterday), iso(yesterday)),
      );
      const top = day.byCategory
        .slice(0, 2)
        .map((c) => `${c.category} ${usd(c.spent)}`)
        .join(", ");
      const lines = [
        "Finance",
        day.total > 0
          ? `Yesterday: ${usd(day.total)} (${top})`
          : "Yesterday: nothing spent",
      ];

      // On the 1st there's no month so far to compare.
      const dom = today.getUTCDate();
      if (dom > 1) {
        const y = today.getUTCFullYear();
        const m = today.getUTCMonth();
        const lastLen = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const [now1, last1] = await Promise.all([
          api.getSpending(
            dateRange(iso(new Date(Date.UTC(y, m, 1))), iso(yesterday)),
          ),
          api.getSpending(
            dateRange(
              iso(new Date(Date.UTC(y, m - 1, 1))),
              iso(new Date(Date.UTC(y, m - 1, Math.min(dom - 1, lastLen)))),
            ),
          ),
        ]);
        lines.push(
          `This month so far: ${usd(now1.total)} vs ${usd(last1.total)} at this point last month`,
        );
      }

      const unusual = findAnomalies(
        await loadRecentTxs(db, at),
        yesterday,
        today,
      );
      for (const a of unusual.slice(0, 3))
        lines.push(
          `Unusual: ${maskDigits(a.merchant ?? a.description)} ${usd(-a.amount)}, ${a.detail}`,
        );
      lines.push(formatFreshness(await api.getBankFreshness(), at));
      return lines.join("\n");
    },
  };
}

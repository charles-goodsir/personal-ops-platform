import type { Db } from "@ops/core";

export type Tx = {
  date: Date;
  description: string;
  merchant: string | null;
  amount: number; // negative = money out
  category: string | null;
};

const DAY = 86_400_000;

// Groups charges from the same payee: Akahu's merchant when it has one,
// otherwise the description without digits and punctuation, so
// "NETFLIX.COM 0423" and "NETFLIX.COM 0523" land together.
export const payeeKey = (t: Pick<Tx, "merchant" | "description">) =>
  (t.merchant ??
    t.description
      .toLowerCase()
      .replace(/[^a-z ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()) ||
  t.description;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

const CADENCES = [
  { name: "weekly", min: 6, max: 8, days: 7, minCharges: 3 },
  { name: "fortnightly", min: 13, max: 15, days: 14, minCharges: 3 },
  { name: "monthly", min: 27, max: 33, days: 30.44, minCharges: 3 },
  { name: "yearly", min: 350, max: 380, days: 365.25, minCharges: 2 },
] as const;

export type Recurring = {
  payee: string;
  cadence: (typeof CADENCES)[number]["name"];
  typicalAmount: number; // positive, money out
  monthlyCost: number;
  charges: number;
  firstDate: Date;
  lastDate: Date;
  nextExpected: Date;
  category: string | null;
  active: boolean;
};

// Recurring charges: a typical gap that fits a cadence, and similar amounts,
// from one payee. The median gap ignores the odd early or late payment (a
// real 2degrees bill went 33, 21, 38, 31 days); steady amounts guard against
// matching a shop I just happen to visit often.
// ponytail: fixed cadence bands and thresholds; tune them if real data shows misses.
export function detectRecurring(txs: Tx[], now: Date): Recurring[] {
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const key = payeeKey(t);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const found: Recurring[] = [];
  for (const [payee, list] of groups) {
    const charges = [...list].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const gaps = charges
      .slice(1)
      .map(
        (t, i) => (t.date.getTime() - (charges[i]?.date.getTime() ?? 0)) / DAY,
      );
    const amounts = charges.map((t) => -t.amount);
    const typical = median(amounts);
    const steady = amounts.filter(
      (a) => Math.abs(a - typical) <= typical * 0.25,
    ).length;
    if (steady < amounts.length * 0.8) continue;
    const typicalGap = median(gaps);
    const cadence = CADENCES.find(
      (c) =>
        charges.length >= c.minCharges &&
        typicalGap >= c.min &&
        typicalGap <= c.max,
    );
    const first = charges[0];
    const last = charges.at(-1);
    if (!cadence || !first || !last) continue;
    found.push({
      payee,
      cadence: cadence.name,
      typicalAmount: Math.round(typical * 100) / 100,
      monthlyCost: Math.round(((typical * 30.44) / cadence.days) * 100) / 100,
      charges: charges.length,
      firstDate: first.date,
      lastDate: last.date,
      nextExpected: new Date(last.date.getTime() + cadence.days * DAY),
      category: last.category,
      active: now.getTime() - last.date.getTime() <= cadence.days * 1.5 * DAY,
    });
  }
  return found.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export type Anomaly = Tx & {
  reason: "large_for_category" | "new_payee_large";
  detail: string;
};

// Not spending, so never "unusual spending".
const IGNORED = new Set(["Transfers", "Income", "Investments"]);

// Unusual money out in [since, now): far above the category's normal, or a
// big first charge from a payee not seen for a year. A known recurring charge
// at its usual amount is never unusual, however it compares to its category.
export function findAnomalies(txs: Tx[], since: Date, now: Date): Anomaly[] {
  const recurring = new Map(
    detectRecurring(
      txs.filter((t) => t.date < since),
      since,
    ).map((r) => [r.payee, r.typicalAmount]),
  );
  const out = txs.filter((t) => t.amount < 0 && !IGNORED.has(t.category ?? ""));
  const before = out.filter((t) => t.date < since);
  const recent = out.filter((t) => t.date >= since && t.date < now);
  const found: Anomaly[] = [];
  for (const t of recent) {
    const spent = -t.amount;
    // Match by key, or by the payee's name inside the description: a retried
    // bill can arrive without Akahu's merchant and in a different format.
    const text = t.description.toLowerCase();
    const typical =
      recurring.get(payeeKey(t)) ??
      [...recurring].find(
        ([payee]) => payee.length >= 4 && text.includes(payee.toLowerCase()),
      )?.[1];
    if (typical !== undefined && Math.abs(spent - typical) <= typical * 0.25)
      continue;
    const sameCategory = before
      .filter(
        (b) =>
          b.category === t.category &&
          since.getTime() - b.date.getTime() <= 180 * DAY,
      )
      .map((b) => -b.amount);
    const usual = median(sameCategory);
    if (sameCategory.length >= 5 && spent > 50 && spent > usual * 3) {
      found.push({
        ...t,
        reason: "large_for_category",
        detail: `about ${Math.round(spent / usual)}x the usual ${t.category ?? "uncategorised"} charge of $${usual.toFixed(2)}`,
      });
      continue;
    }
    const key = payeeKey(t);
    const seenBefore = before.some(
      (b) =>
        payeeKey(b) === key && since.getTime() - b.date.getTime() <= 365 * DAY,
    );
    if (!seenBefore && spent > 100) {
      found.push({
        ...t,
        reason: "new_payee_large",
        detail: `first charge from this payee in over a year`,
      });
    }
  }
  return found.sort((a, b) => a.amount - b.amount);
}

// Loads the last ~13 months of transactions for both checks.
export async function loadRecentTxs(db: Db, now = new Date()): Promise<Tx[]> {
  const { rows } = await db.query<{
    date: Date;
    description: string;
    merchant: string | null;
    amount: string;
    category: string | null;
  }>(
    `SELECT date, description, merchant, amount, category FROM transactions
     WHERE date > $1::timestamptz - interval '400 days' AND date <= $1 ORDER BY date`,
    [now],
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

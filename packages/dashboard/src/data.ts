import {
  JOBS,
  jobHealth,
  listJobRuns,
  type Db,
  type JobHealth,
} from "@ops/core";
import {
  createFinanceApi,
  createGoalsApi,
  createPaydaySettingsApi,
  currentMeter,
  formatFreshness,
  dateRange,
  nzDate,
  resolvePeriod,
  type Goal,
  type Meter,
  type Recurring,
  type Spending,
} from "@ops/finance";

export type Dashboard = {
  freshness: string; // when the bank data was last pulled
  month: Spending;
  fortnight: Meter | null; // null until a payday and spending target are set
  goals: Goal[];
  trend: { label: string; total: number; current: boolean }[]; // oldest first
  subscriptions: Recurring[];
  jobs: { job: string; health: JobHealth }[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const MONTHS = 6;
const SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]; // prettier-ignore

// Everything the page shows, read in parallel. Nothing here writes, and the
// connection could not if it tried: it runs as dashboard_ro.
export async function loadDashboard(
  db: Db,
  now = new Date(),
): Promise<Dashboard> {
  const finance = createFinanceApi(db);
  const thisMonth = resolvePeriod("this_month", now);
  const y = thisMonth.from.getUTCFullYear();
  const m = thisMonth.from.getUTCMonth();
  // The five full months before this one, as inclusive NZ dates.
  const earlier = Array.from({ length: MONTHS - 1 }, (_, i) => {
    const first = new Date(Date.UTC(y, m - (MONTHS - 1) + i, 1));
    const last = new Date(Date.UTC(y, m - (MONTHS - 1) + i + 1, 0));
    return { first, range: dateRange(iso(first), iso(last)) };
  });

  const [month, fortnight, goals, past, subscriptions, runs, refreshed] =
    await Promise.all([
      finance.getSpending(thisMonth),
      createPaydaySettingsApi(db)
        .getSettings()
        .then((settings) => currentMeter(db, settings, nzDate(now))),
      createGoalsApi(db).listGoals(),
      Promise.all(earlier.map((e) => finance.getSpending(e.range))),
      finance.listSubscriptions(false, now),
      listJobRuns(db),
      finance.getBankFreshness(),
    ]);
  return {
    freshness: formatFreshness(refreshed, now),
    month,
    fortnight,
    goals,
    trend: [
      ...earlier.map((e, i) => ({
        label: SHORT[e.first.getUTCMonth()] as string,
        total: past[i]?.total ?? 0,
        current: false,
      })),
      { label: SHORT[m] as string, total: month.total, current: true },
    ],
    subscriptions,
    jobs: JOBS.map((job) => ({
      job,
      health: jobHealth(
        job,
        runs.find((r) => r.job === job),
        now,
      ),
    })),
  };
}

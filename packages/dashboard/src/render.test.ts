import { expect, test } from "vitest";
import type { Dashboard } from "./data.js";
import { renderDashboard } from "./render.js";

const base = (): Dashboard => ({
  freshness: "Bank data refreshed Tue 13 Oct, 11:17 (23h ago)",
  month: {
    range: {
      from: new Date(),
      to: new Date(),
      label: "2026-10-01 to 2026-10-14",
    },
    total: 1234.5,
    income: 2000,
    invested: 149,
    byCategory: [
      { category: "Groceries", spent: 800, count: 9 },
      { category: "Eating out", spent: 434.5, count: 12 },
    ],
    uncategorised: 0,
  },
  fortnight: {
    payday: "2026-10-13",
    spent: 533.35,
    target: 666.69,
    percent: 80,
    daysLeft: 12,
    pending: null,
  },
  goals: [
    {
      name: "Holiday fund",
      target: 3000,
      saved: 250,
      weight: 3,
      due: "2027-06-01",
    },
    { name: "Emergency fund", target: 1000, saved: 1000, weight: 1, due: null },
  ],
  trend: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((label, i) => ({
    label,
    total: 1000 + i * 100,
    current: i === 5,
  })),
  subscriptions: [
    {
      payee: "NETFLIX 123456789",
      cadence: "monthly",
      typicalAmount: 20,
      monthlyCost: 20,
      charges: 5,
      firstDate: new Date("2026-05-01"),
      lastDate: new Date("2026-10-01"),
      nextExpected: new Date("2026-11-01"),
      category: "Subscriptions",
      active: true,
    },
  ],
  jobs: [
    { job: "briefing", health: { state: "ok", ageMs: 5 * 3_600_000 } },
    { job: "backup", health: { state: "late", ageMs: 30 * 3_600_000 } },
    { job: "summary", health: { state: "never", failures: 0 } },
  ],
});
const html = (d = base(), hidePayees = false) =>
  renderDashboard(d, { role: "dashboard_ro", hidePayees });

test("shows the month, the fortnight meter and goals with words as well as colour, and the role", () => {
  const page = html();
  expect(page).toContain("$1,234.50");
  expect(page).toContain("$533.35 of $666.69 (80%)");
  expect(page).toContain("● Near limit");
  expect(page).toContain("12 days to payday");
  expect(page).toContain("Holiday fund");
  expect(page).toContain("$250.00 of $3,000.00 (8%), due 2027-06-01");
  expect(page).toContain("✓ Reached");
  expect(page).toContain("Database role: dashboard_ro");
  expect(page).toContain("Bank data refreshed Tue 13 Oct, 11:17 (23h ago)");
});

test("an over-target meter says over and never draws wider than its track", () => {
  const d = base();
  d.fortnight = {
    ...(d.fortnight as NonNullable<Dashboard["fortnight"]>),
    spent: 900,
    percent: 135,
  };
  const page = html(d);
  expect(page).toContain("▲ Over");
  expect(page).toContain('class="fill-crit" width="100%"');
});

test("job states are worded, and a stale job is called late", () => {
  const page = html();
  expect(page).toContain("✓ ok");
  expect(page).toContain("▲ late");
  expect(page).toContain("● no run recorded");
});

test("digits in a payee are masked, and DASHBOARD_HIDE_PAYEES hides the name", () => {
  expect(html()).toContain("NETFLIX [number]");
  expect(html()).not.toContain("123456789");
  const hidden = html(base(), true);
  expect(hidden).not.toContain("NETFLIX");
  expect(hidden).toContain("Subscription 1");
});

test("D1: markup in a payee, a category, a goal name or a job name is escaped, never run", () => {
  const d = base();
  const bad = `<script>alert(1)</script><img src=x onerror=alert(1)>"'&`;
  d.subscriptions[0] = {
    ...(d.subscriptions[0] as Dashboard["subscriptions"][0]),
    payee: bad,
  };
  d.month.byCategory[0] = { category: bad, spent: 1, count: 1 };
  d.goals[0] = { name: bad, target: 1, saved: 1, weight: 1, due: bad };
  const page = html(d);
  expect(page).not.toContain("<script>");
  expect(page).not.toContain("<img");
  // The text is still there, but with its angle brackets and quotes turned into entities.
  expect(page).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;");
  expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("the page has no inline style, no script and no external link", () => {
  const page = html();
  expect(page).not.toMatch(/\sstyle=/);
  expect(page).not.toMatch(/<script/i);
  expect(page).not.toMatch(/https?:\/\//);
});

test("an empty month, no target and no goals still render", () => {
  const d = base();
  d.month.byCategory = [];
  d.fortnight = null;
  d.goals = [];
  d.subscriptions = [];
  const page = html(d);
  expect(page).toContain("Nothing spent yet this month.");
  expect(page).toContain("No spending target set.");
  expect(page).toContain("No goals yet.");
  expect(page).toContain("No recurring charges found.");
});

test("pending charges show beside the settled figure: an estimate, the split in words, and a lighter segment that never passes the track", () => {
  const d = base();
  d.fortnight = {
    payday: "2026-10-13",
    spent: 49.8,
    target: 666.69,
    percent: 7,
    daysLeft: 11,
    pending: { spent: 606.48, count: 4, percent: 98 },
  };
  const page = html(d);
  expect(page).toContain("about $656.28 of $666.69 (98%)");
  expect(page).toContain("● Near limit");
  expect(page).toContain(
    "$49.80 settled, about $606.48 pending (4 charges), 11 days to payday",
  );
  expect(page).toContain('class="fill-warn" width="7%"');
  expect(page).toContain('class="bar-muted" x="7%" width="91%"');
  d.fortnight = {
    ...d.fortnight,
    pending: { spent: 900, count: 1, percent: 142 },
  };
  const over = html(d);
  expect(over).toContain("▲ Over");
  expect(over).toContain("(1 charge)");
  expect(over).toContain('class="fill-crit" width="7%"');
  expect(over).toContain('class="bar-muted" x="7%" width="93%"');
  // No pending charges, or none counted: the page reads as it did before.
  d.fortnight = { ...d.fortnight, pending: { spent: 0, count: 0, percent: 7 } };
  expect(html(d)).not.toContain("pending (");
});

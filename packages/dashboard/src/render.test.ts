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
  budgets: [
    { category: "Groceries", limit: 600, spent: 800, percent: 133 },
    { category: "Eating out", limit: 500, spent: 434.5, percent: 87 },
    { category: "Travel", limit: 100, spent: 10, percent: 10 },
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

test("shows the month, budgets with words as well as colour, and the role", () => {
  const page = html();
  expect(page).toContain("$1,234.50");
  expect(page).toContain("▲ Over");
  expect(page).toContain("● Near limit");
  expect(page).toContain("✓ On track");
  expect(page).toContain("Database role: dashboard_ro");
  expect(page).toContain("Bank data refreshed Tue 13 Oct, 11:17 (23h ago)");
  // An over-budget meter never draws wider than its track.
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

test("D1: markup in a payee, a category or a job name is escaped, never run", () => {
  const d = base();
  const bad = `<script>alert(1)</script><img src=x onerror=alert(1)>"'&`;
  d.subscriptions[0] = {
    ...(d.subscriptions[0] as Dashboard["subscriptions"][0]),
    payee: bad,
  };
  d.month.byCategory[0] = { category: bad, spent: 1, count: 1 };
  d.budgets[0] = { category: bad, limit: 1, spent: 1, percent: 100 };
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

test("an empty month and no budgets still render", () => {
  const d = base();
  d.month.byCategory = [];
  d.budgets = [];
  d.subscriptions = [];
  const page = html(d);
  expect(page).toContain("Nothing spent yet this month.");
  expect(page).toContain("No budgets set.");
  expect(page).toContain("No recurring charges found.");
});

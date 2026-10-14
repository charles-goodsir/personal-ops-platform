import type { JobRun } from "@ops/core";
import type {
  BudgetsApi,
  FinanceApi,
  GoalsApi,
  PaydaySettingsApi,
} from "@ops/finance";
import { beforeEach, expect, test, vi } from "vitest";
import { createCommandHandler } from "./commands.js";

// Tuesday 14 October 2026, 07:00 NZDT.
const now = new Date("2026-10-13T18:00:00Z");
const range = { from: new Date(), to: new Date(), label: "the range" };
const finance = {
  getSpending: vi.fn(),
  getCategorySpending: vi.fn(),
  listSubscriptions: vi.fn(),
};
const budgets = {
  setBudget: vi.fn(),
  removeBudget: vi.fn(),
  budgetStatus: vi.fn(),
};
const payday = { getSettings: vi.fn(), setAmount: vi.fn(), setPayday: vi.fn() };
const goals = {
  listGoals: vi.fn(),
  addGoal: vi.fn(),
  setSaved: vi.fn(),
  setWeight: vi.fn(),
  removeGoal: vi.fn(),
};
const spent = vi.fn();
const notes = { searchNotes: vi.fn() };
const briefing = vi.fn();
const jobs = vi.fn();
const handle = createCommandHandler({
  finance: finance as unknown as FinanceApi,
  budgets: budgets as unknown as BudgetsApi,
  payday: payday as unknown as PaydaySettingsApi,
  goals: goals as unknown as GoalsApi,
  spent,
  notes,
  briefing,
  jobs,
  now: () => now,
});
const hit = (noteId: string, title: string, path: string) => ({
  noteId,
  title,
  path,
  heading: "A heading",
  content: "SECRET NOTE TEXT",
  score: 0.9,
});

beforeEach(() => {
  vi.resetAllMocks();
  finance.getSpending.mockResolvedValue({
    range,
    total: 10,
    income: 0,
    invested: 0,
    byCategory: [{ category: "Groceries", spent: 10, count: 1 }],
    uncategorised: 0,
  });
  finance.getCategorySpending.mockResolvedValue({
    range,
    category: "Eating out",
    spent: 5,
    count: 1,
    topPayees: [{ payee: "Cafe", spent: 5, count: 1 }],
  });
  finance.listSubscriptions.mockResolvedValue([]);
  notes.searchNotes.mockResolvedValue([]);
  briefing.mockResolvedValue("the briefing");
  jobs.mockResolvedValue([]);
});

test("/spend with nothing defaults to this month, all categories", async () => {
  expect(await handle("/spend")).toBe(
    "Spending the range: $10.00\n  Groceries: $10.00 (1)\nIncome: $0.00\nInvested: $0.00",
  );
  const r = finance.getSpending.mock.calls[0]?.[0];
  expect(r.label).toBe("2026-10-01 to 2026-10-14");
});

test("/spend takes a period written with spaces or underscores, then a category", async () => {
  await handle("/spend last month");
  await handle("/spend LAST_MONTH");
  expect(finance.getSpending.mock.calls.map((c) => c[0].label)).toEqual([
    "2026-09-01 to 2026-09-30",
    "2026-09-01 to 2026-09-30",
  ]);
  expect(await handle("/spend last week Eating out")).toContain("Cafe");
  expect(finance.getCategorySpending).toHaveBeenCalledWith(
    expect.objectContaining({ label: "2026-10-05 to 2026-10-11" }),
    "Eating out",
  );
});

test("/spend with only a category uses this month", async () => {
  await handle("/spend groceries");
  expect(finance.getCategorySpending).toHaveBeenCalledWith(
    expect.objectContaining({ label: "2026-10-01 to 2026-10-14" }),
    "Groceries",
  );
});

test("an unknown category or period never reaches the database", async () => {
  expect(await handle("/spend gambling")).toMatch(/^Unknown category/);
  expect(await handle("/spend last decade")).toMatch(/^Unknown category/);
  expect(await handle("/spend groceries; DROP TABLE transactions")).toMatch(
    /^Unknown category/,
  );
  expect(finance.getSpending).not.toHaveBeenCalled();
  expect(finance.getCategorySpending).not.toHaveBeenCalled();
});

test("/subs shows active ones, and all with the all argument", async () => {
  expect(await handle("/subs")).toBe("No recurring charges found.");
  expect(finance.listSubscriptions).toHaveBeenCalledWith(false, now);
  await handle("/subs all");
  expect(finance.listSubscriptions).toHaveBeenLastCalledWith(true, now);
  expect(await handle("/subs everything")).toBe("Use /subs or /subs all.");
});

test("/help lists the commands, periods and categories; the bot's name suffix is accepted", async () => {
  const help = await handle("/help");
  expect(help).toContain("/spend");
  expect(help).toContain("last month");
  expect(help).toContain("Eating out");
  expect(await handle("/help@my_ops_bot")).toBe(help);
  expect(await handle("/start")).toBe(help);
});

test("unknown commands, plain text and long messages get a short refusal", async () => {
  expect(await handle("/delete everything")).toBe(
    "Unknown command. Send /help.",
  );
  expect(await handle("how much did I spend?")).toBe(
    "Send /help to see the commands.",
  );
  expect(await handle(`/spend ${"a".repeat(200)}`)).toBe(
    "That message is too long.",
  );
  expect(finance.getSpending).not.toHaveBeenCalled();
});

test("/notes lists each matching note once, by title and path, never its text", async () => {
  notes.searchNotes.mockResolvedValue([
    hit("1", "Docker", "docker.md"),
    hit("1", "Docker", "docker.md"), // a second chunk of the same note
    hit("2", "SSH", "ssh.md"),
  ]);
  const reply = await handle("/notes firewall rules");
  expect(reply).toBe(
    'Notes matching "firewall rules":\n1. Docker (docker.md)\n2. SSH (ssh.md)',
  );
  expect(reply).not.toContain("SECRET");
  expect(notes.searchNotes).toHaveBeenCalledWith("firewall rules", 15);
});

test("/notes shows at most five notes, and says when nothing matched or no words were given", async () => {
  notes.searchNotes.mockResolvedValue(
    Array.from({ length: 9 }, (_, i) => hit(`${i}`, `Note ${i}`, `n${i}.md`)),
  );
  expect((await handle("/notes many")).split("\n")).toHaveLength(6);
  notes.searchNotes.mockResolvedValue([]);
  expect(await handle("/notes nothing")).toBe("No matching notes.");
  expect(await handle("/notes")).toBe("Use /notes followed by a few words.");
});

test("/briefing sends whatever the briefing builds", async () => {
  expect(await handle("/briefing")).toBe("the briefing");
  expect(briefing).toHaveBeenCalledOnce();
});

const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const run = (job: string, over: Partial<JobRun>): JobRun => ({
  job,
  lastSuccess: null,
  lastFailure: null,
  consecutiveFailures: 0,
  alertedAt: null,
  ...over,
});

test("/status shows each job: ok, failing, late, or not yet run", async () => {
  jobs.mockResolvedValue([
    run("finance-sync", { lastSuccess: hoursAgo(3) }),
    run("knowledge-base-scan", { lastSuccess: hoursAgo(0.2) }),
    run("briefing", { lastSuccess: hoursAgo(20), consecutiveFailures: 2 }),
    run("backup", { lastSuccess: hoursAgo(80) }),
  ]);
  expect(await handle("/status")).toBe(
    [
      "finance-sync: ok, 3h ago",
      "knowledge-base-scan: ok, 12m ago",
      "briefing: failing (2 in a row), last ok 20h ago",
      "summary: no run recorded yet",
      "diary: no run recorded yet",
      "backup: LATE, last ok 3d ago",
    ].join("\n"),
  );
});

test("/status says so when a job has failed and never succeeded", async () => {
  jobs.mockResolvedValue([run("summary", { consecutiveFailures: 3 })]);
  expect(await handle("/status")).toContain(
    "summary: failing (3 in a row), never succeeded",
  );
});

test("/budget shows spent against each limit for this month, and says when none are set", async () => {
  budgets.budgetStatus.mockResolvedValueOnce([
    { category: "Eating out", limit: 100, spent: 120, percent: 120 },
    { category: "Groceries", limit: 600, spent: 150.5, percent: 25 },
  ]);
  expect(await handle("/budget")).toBe(
    "Budgets 2026-10-01 to 2026-10-14:\n  Eating out: $120.00 of $100.00 (120%) OVER\n  Groceries: $150.50 of $600.00 (25%)",
  );
  expect(budgets.budgetStatus.mock.calls[0]?.[0].label).toBe(
    "2026-10-01 to 2026-10-14",
  );
  budgets.budgetStatus.mockResolvedValueOnce([]);
  expect(await handle("/budget")).toMatch(/No budgets set/);
});

test("/budget set takes a category with spaces, in any case, and an amount", async () => {
  budgets.setBudget.mockResolvedValueOnce({
    category: "Eating out",
    limit: 80.5,
    replaced: null,
  });
  expect(await handle("/budget set EATING out 80.50")).toBe(
    "Budget for Eating out set to $80.50 a month.",
  );
  expect(budgets.setBudget).toHaveBeenCalledWith("Eating out", 80.5);
  budgets.setBudget.mockResolvedValueOnce({
    category: "Groceries",
    limit: 700,
    replaced: 600,
  });
  expect(await handle("/budget set groceries 700")).toBe(
    "Budget for Groceries changed from $600.00 to $700.00 a month.",
  );
});

test("/budget set refuses a bad amount or category before the database", async () => {
  for (const bad of [
    "/budget set groceries",
    "/budget set groceries 0",
    "/budget set groceries -5",
    "/budget set groceries 1e9",
    "/budget set groceries 12345678",
    "/budget set groceries 1,000",
    "/budget set groceries 10.123",
    "/budget set groceries NaN",
    "/budget set groceries \u0663\u0660\u0660",
    "/budget set income 100",
    "/budget set transfers 100",
    "/budget set nonsense 100",
    "/budget set 100",
    "/budget change groceries 100",
  ])
    await handle(bad);
  expect(budgets.setBudget).not.toHaveBeenCalled();
});

test("/budget remove removes one, and says when there was none", async () => {
  budgets.removeBudget.mockResolvedValueOnce({
    category: "Groceries",
    removed: true,
  });
  expect(await handle("/budget remove Groceries")).toBe(
    "Removed the Groceries budget.",
  );
  budgets.removeBudget.mockResolvedValueOnce({
    category: "Travel",
    removed: false,
  });
  expect(await handle("/budget remove travel")).toBe(
    "No budget set for Travel.",
  );
  expect(await handle("/budget remove income")).toMatch(/Budget categories/);
  expect(budgets.removeBudget).toHaveBeenCalledTimes(2);
});

test("/payday and /goal reach the payday commands, with today's date in New Zealand", async () => {
  payday.getSettings.mockResolvedValue({
    pay: null,
    rent: null,
    savings: null,
    invest: null,
    spending: null,
    payday: "2026-10-13",
  });
  goals.listGoals.mockResolvedValue([]);
  expect(await handle("/payday")).toBe(
    "Payday plan: still to set: pay, rent, savings, invest. Use /payday set <item> <amount>.",
  );
  expect(await handle("/goal")).toBe(
    "No goals yet. Use /goal add <name> <target> [date].",
  );
  expect(await handle("/help")).toContain("/payday set <item> <amount>");
});

import type { FinanceApi } from "@ops/finance";
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
const handle = createCommandHandler({
  finance: finance as unknown as FinanceApi,
  now: () => now,
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

import { expect, test } from "vitest";
import { computePlan, type Plan } from "./payday-plan.js";
import { formatGoals, formatPlan } from "./format.js";

const settings = {
  pay: 1000,
  rent: 300,
  savings: 200,
  invest: 50,
  spending: null,
  payday: "2026-10-13",
};
const plan = (
  spent: number,
  goals: Parameters<typeof computePlan>[2] = [],
  over = {},
): Plan => computePlan({ ...settings, ...over }, spent, goals);

test("an under-target fortnight shows the surplus, the split and each goal", () => {
  expect(
    formatPlan(
      plan(350, [{ name: "Holiday", target: 1000, saved: 950, weight: 1 }]),
      "2026-10-13",
    ),
  ).toBe(
    [
      "Payday plan for 2026-10-13",
      "Spent 2026-09-30 to 2026-10-13: $350.00 of a $450.00 target ($100.00 under)",
      "Rent and bills: $300.00",
      "Savings: $280.00 (usual $200.00 plus $80.00)",
      "Investments: $70.00 (usual $50.00 plus $20.00)",
      "  Holiday: $50.00 (reaches its target)",
      "Once it is in, record it: /goal saved <name> <new total>",
      "Not going to a goal: $230.00",
    ].join("\n"),
  );
});

test("an over-target fortnight shows the usual amounts and by how much", () => {
  const text = formatPlan(plan(500), "2026-10-13");
  expect(text).toContain("of a $450.00 target ($50.00 over)");
  expect(text).toContain("Savings: $200.00\n");
  expect(text).not.toContain("usual");
  expect(formatPlan(plan(450), "2026-10-13")).toContain("(on target)");
});

test("the goal reminder only appears when a goal gets money", () => {
  const reminder = "/goal saved <name> <new total>";
  expect(
    formatPlan(
      plan(350, [{ name: "A", target: 1000, saved: 0, weight: 1 }]),
      "2026-10-13",
    ),
  ).toContain(reminder);
  expect(formatPlan(plan(350), "2026-10-13")).not.toContain(reminder);
  expect(
    formatPlan(
      plan(500, [{ name: "A", target: 1000, saved: 0, weight: 1 }]),
      "2026-10-13",
    ),
  ).toContain(reminder);
});

test("a pay that falls short says so, and unset items are listed", () => {
  expect(formatPlan(plan(0, [], { pay: 500 }), "2026-10-13")).toContain(
    "The pay is $50.00 short of rent and the usual savings and investments.",
  );
  expect(formatPlan(plan(0, [], { pay: null }), "2026-10-13")).toBe(
    "Payday plan: still to set: pay. Use /payday set <item> <amount>.",
  );
});

test("goals are listed with progress, date and weight, or a prompt when there are none", () => {
  expect(formatGoals([])).toBe(
    "No goals yet. Use /goal add <name> <target> [date].",
  );
  expect(
    formatGoals([
      { name: "Car", target: 800, saved: 100, weight: 1, due: null },
    ]),
  ).toBe("Goals:\n  Car: $100.00 of $800.00 (13%), weight 1");
});

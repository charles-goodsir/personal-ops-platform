import type { GoalsApi, PaydaySettingsApi } from "@ops/finance";
import { beforeEach, expect, test, vi } from "vitest";
import { createPaydayCommands } from "./payday-commands.js";

const payday = { getSettings: vi.fn(), setAmount: vi.fn(), setPayday: vi.fn() };
const goals = {
  listGoals: vi.fn(),
  addGoal: vi.fn(),
  setSaved: vi.fn(),
  setWeight: vi.fn(),
  removeGoal: vi.fn(),
};
const spent = vi.fn();
const cmd = createPaydayCommands({
  payday: payday as unknown as PaydaySettingsApi,
  goals: goals as unknown as GoalsApi,
  spent,
});
const full = {
  pay: 1000,
  rent: 300,
  savings: 200,
  invest: 50,
  spending: null,
  payday: "2026-10-13",
};

beforeEach(() => {
  vi.resetAllMocks();
  payday.getSettings.mockResolvedValue(full);
  goals.listGoals.mockResolvedValue([]);
  spent.mockResolvedValue(350);
});

test("/payday needs a payday, waits for the first one, and lists what is still unset", async () => {
  payday.getSettings.mockResolvedValueOnce({ ...full, payday: null });
  expect(await cmd.payday([], "2026-10-14")).toMatch(/Set a payday first/);
  expect(await cmd.payday([], "2026-10-12")).toBe(
    "The first payday, 2026-10-13, has not come yet.",
  );
  payday.getSettings.mockResolvedValueOnce({ ...full, pay: null, rent: null });
  expect(await cmd.payday([], "2026-10-14")).toBe(
    "Payday plan: still to set: pay, rent. Use /payday set <item> <amount>.",
  );
  expect(spent).not.toHaveBeenCalled(); // nothing to work out yet
});

test("/payday works out the plan for the latest payday, with what I spent", async () => {
  goals.listGoals.mockResolvedValue([
    { name: "Holiday", target: 1000, saved: 0, weight: 1, due: null },
  ]);
  const text = await cmd.payday([], "2026-10-20");
  expect(spent).toHaveBeenCalledExactlyOnceWith("2026-10-13");
  expect(text).toBe(
    [
      "Payday plan for 2026-10-13",
      "Spent 2026-09-30 to 2026-10-13: $350.00 of a $450.00 target ($100.00 under)",
      "Rent and bills: $300.00",
      "Savings: $280.00 (usual $200.00 plus $80.00)",
      "Investments: $70.00 (usual $50.00 plus $20.00)",
      "  Holiday: $280.00",
    ].join("\n"),
  );
});

test("/payday set takes an item in any case and a plain amount", async () => {
  payday.setAmount.mockResolvedValueOnce({ item: "pay", amount: 1000.5 });
  expect(await cmd.payday(["set", "PAY", "1000.50"], "2026-10-14")).toBe(
    "Pay set to $1000.50.",
  );
  expect(payday.setAmount).toHaveBeenCalledWith("pay", 1000.5);
  payday.setAmount.mockResolvedValueOnce({ item: "spending", amount: 400 });
  expect(await cmd.payday(["set", "spending", "400"], "2026-10-14")).toBe(
    "Spending target set to $400.00.",
  );
  payday.setPayday.mockResolvedValueOnce({ payday: "2026-10-13" });
  expect(
    await cmd.payday(["set", "payday", "2026-10-13"], "2026-10-14"),
  ).toMatch(/Payday set to 2026-10-13/);
});

test("/payday set takes several pairs at once, and saves none of them if one is bad", async () => {
  payday.setAmount.mockImplementation(async (item, amount) => ({
    item,
    amount,
  }));
  payday.setPayday.mockResolvedValueOnce({ payday: "2026-10-13" });
  expect(
    await cmd.payday(
      ["set", "pay", "1914.69", "rent", "450", "payday", "2026-10-13"],
      "2026-10-14",
    ),
  ).toBe(
    "Pay set to $1914.69.\nRent and bills set to $450.00.\nPayday set to 2026-10-13. Paydays fall every 14 days from it.",
  );
  expect(payday.setAmount).toHaveBeenCalledTimes(2);
  payday.setAmount.mockClear();
  await cmd.payday(["set", "pay", "100", "rent", "-5"], "2026-10-14");
  await cmd.payday(["set", "pay", "100", "salary", "5"], "2026-10-14");
  expect(payday.setAmount).not.toHaveBeenCalled();
});

test("/payday set refuses a bad item, amount or date before the database, and shows the API's message for a date that is not real", async () => {
  for (const args of [
    ["set", "salary", "100"],
    ["set", "pay"],
    ["set", "pay", "0"],
    ["set", "pay", "-5"],
    ["set", "pay", "1e3"],
    ["set", "pay", "100", "extra"],
    ["change", "pay", "100"],
    ["set", "constructor", "100"],
  ])
    await cmd.payday(args, "2026-10-14");
  expect(payday.setAmount).not.toHaveBeenCalled();
  payday.setPayday.mockRejectedValueOnce(
    new Error("date must be a real date written YYYY-MM-DD"),
  );
  expect(
    await cmd.payday(["set", "payday", "2026-02-30"], "2026-10-14"),
  ).toMatch(/real date/);
});

test("/goal lists goals, and adds one with a name of several words, a target and an optional date", async () => {
  goals.listGoals.mockResolvedValueOnce([
    {
      name: "Holiday fund",
      target: 3000,
      saved: 250,
      weight: 3,
      due: "2027-06-01",
    },
  ]);
  expect(await cmd.goal([])).toBe(
    "Goals:\n  Holiday fund: $250.00 of $3000.00 (8%), due 2027-06-01, weight 3",
  );
  goals.addGoal.mockResolvedValueOnce({
    name: "Holiday fund",
    target: 3000,
    saved: 0,
    weight: 1,
    due: "2027-06-01",
  });
  expect(await cmd.goal(["add", "Holiday", "fund", "3000", "2027-06-01"])).toBe(
    "Added goal Holiday fund: $3000.00, due 2027-06-01.",
  );
  expect(goals.addGoal).toHaveBeenCalledWith({
    name: "Holiday fund",
    target: 3000,
    due: "2027-06-01",
  });
  goals.addGoal.mockResolvedValueOnce({
    name: "Car",
    target: 800.5,
    saved: 0,
    weight: 1,
    due: null,
  });
  await cmd.goal(["add", "Car", "800.50"]);
  expect(goals.addGoal).toHaveBeenLastCalledWith({
    name: "Car",
    target: 800.5,
    due: undefined,
  });
});

test("a duplicate name or an unreal date from the API is shown, and any other error is not", async () => {
  goals.addGoal.mockRejectedValueOnce(
    new Error("a goal called Car already exists"),
  );
  expect(await cmd.goal(["add", "Car", "100"])).toBe(
    "a goal called Car already exists",
  );
  goals.addGoal.mockRejectedValueOnce(
    new Error("date must be a real date written YYYY-MM-DD"),
  );
  expect(await cmd.goal(["add", "Car", "100", "2026-02-30"])).toMatch(
    /real date/,
  );
  goals.addGoal.mockRejectedValueOnce(
    new Error('connect ECONNREFUSED 10.0.0.5:5432 password="x"'),
  );
  await expect(cmd.goal(["add", "Car", "100"])).rejects.toThrow(/ECONNREFUSED/); // the bot replies generically
});

test("/goal saved, weight and remove find a goal by name, and say so when there is none", async () => {
  goals.setSaved.mockResolvedValueOnce({
    name: "Car",
    target: 800,
    saved: 100,
    weight: 1,
    due: null,
  });
  expect(await cmd.goal(["saved", "car", "100"])).toBe(
    "Car: $100.00 saved of $800.00.",
  );
  expect(goals.setSaved).toHaveBeenCalledWith("car", 100);
  goals.setSaved.mockResolvedValueOnce(null);
  expect(await cmd.goal(["saved", "Nothing", "5"])).toBe(
    "No goal called Nothing.",
  );
  goals.setWeight.mockResolvedValueOnce({
    name: "Car",
    target: 800,
    saved: 0,
    weight: 5,
    due: null,
  });
  expect(await cmd.goal(["weight", "Car", "5"])).toBe("Car: weight 5.");
  goals.removeGoal.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await cmd.goal(["remove", "Car"])).toBe("Removed the goal Car.");
  expect(await cmd.goal(["remove", "Car"])).toBe("No goal called Car.");
});

test("a name that breaks the rules gets the API's own sentence and goes no further", async () => {
  expect(await cmd.goal(["add", "<b>x</b>", "100"])).toMatch(/^name can use/);
  expect(await cmd.goal(["remove", "a;b"])).toMatch(/^name can use/);
  expect(goals.addGoal).not.toHaveBeenCalled();
  expect(goals.removeGoal).not.toHaveBeenCalled();
});

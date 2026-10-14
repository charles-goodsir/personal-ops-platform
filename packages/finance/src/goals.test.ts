import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createGoalsApi, normaliseName } from "./goals.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("goals");
});
afterAll(() => testDb?.drop());
beforeEach(async () => {
  if (testDb) await getDb().query("TRUNCATE goals");
});

const live = () => (testDb ? createGoalsApi(getDb()) : undefined);
const needsDb = test.skipIf(!process.env.DATABASE_URL);

test("names are tidied, and anything outside letters, digits and a few marks is refused", () => {
  expect(normaliseName("  Holiday   fund ")).toBe("Holiday fund");
  expect(normaliseName("Rainy-day (2027) & car")).toBe(
    "Rainy-day (2027) & car",
  );
  expect(normaliseName("Café 2")).toBe("Café 2");
  // A newline or tab becomes one space, so a name can never carry a second line.
  expect(normaliseName("line one\nfake line")).toBe("line one fake line");
  expect(normaliseName("tab\there")).toBe("tab here");
  for (const bad of [
    "",
    "   ",
    "a".repeat(41),
    "<script>alert(1)</script>",
    `"quoted"`,
    "a;b",
    "-leading mark",
    "nul\u0000byte",
    "rtl‮override",
    "emoji 🚀",
  ])
    expect(() => normaliseName(bad), JSON.stringify(bad)).toThrow(/name/);
  expect(normaliseName("a".repeat(40))).toHaveLength(40);
});

needsDb(
  "adds, lists in the order added, and keeps names unique without regard to case",
  async () => {
    const api = live();
    expect(
      await api?.addGoal({
        name: "Holiday",
        target: 3000,
        due: "2027-06-01",
        weight: 3,
      }),
    ).toEqual({
      name: "Holiday",
      target: 3000,
      saved: 0,
      weight: 3,
      due: "2027-06-01",
    });
    await api?.addGoal({ name: "Car repairs", target: 800.456 });
    expect(await api?.listGoals()).toEqual([
      { name: "Holiday", target: 3000, saved: 0, weight: 3, due: "2027-06-01" },
      { name: "Car repairs", target: 800.46, saved: 0, weight: 1, due: null },
    ]);
    await expect(
      api?.addGoal({ name: "  HOLIDAY ", target: 1 }),
    ).rejects.toThrow(/already exists/);
    expect(await api?.listGoals()).toHaveLength(2);
  },
);

needsDb(
  "bad targets, dates and weights are refused and write nothing",
  async () => {
    const api = live();
    for (const target of [0, -1, 1e9, NaN, Infinity])
      await expect(
        api?.addGoal({ name: "G", target }),
        String(target),
      ).rejects.toThrow(/target/);
    for (const due of ["tomorrow", "2026-02-30", "1999-01-01"])
      await expect(
        api?.addGoal({ name: "G", target: 10, due }),
        due,
      ).rejects.toThrow(/date/);
    for (const weight of [0, 11, 1.5, NaN, -1])
      await expect(
        api?.addGoal({ name: "G", target: 10, weight }),
        String(weight),
      ).rejects.toThrow(/weight/);
    expect(await api?.listGoals()).toEqual([]);
  },
);

needsDb(
  "saved is set, not added to, and is found without regard to case",
  async () => {
    const api = live();
    await api?.addGoal({ name: "Holiday", target: 1000 });
    expect((await api?.setSaved("holiday", 250.5))?.saved).toBe(250.5);
    expect((await api?.setSaved(" HOLIDAY ", 250.5))?.saved).toBe(250.5); // sent twice
    expect((await api?.setSaved("Holiday", 0))?.saved).toBe(0);
    expect((await api?.setSaved("Holiday", 1200))?.saved).toBe(1200); // past the target is fine
    expect(await api?.setSaved("Nothing", 5)).toBeNull();
    for (const bad of [-1, NaN, 1e9])
      await expect(api?.setSaved("Holiday", bad), String(bad)).rejects.toThrow(
        /saved/,
      );
    expect((await api?.listGoals())?.[0]?.saved).toBe(1200);
  },
);

needsDb("weight can change, and a goal can be removed once", async () => {
  const api = live();
  await api?.addGoal({ name: "Holiday", target: 1000 });
  expect((await api?.setWeight("holiday", 5))?.weight).toBe(5);
  await expect(api?.setWeight("Holiday", 0)).rejects.toThrow(/weight/);
  expect(await api?.setWeight("Nothing", 2)).toBeNull();
  expect(await api?.removeGoal("HOLIDAY")).toBe(true);
  expect(await api?.removeGoal("Holiday")).toBe(false);
  expect(await api?.listGoals()).toEqual([]);
});

needsDb("the table refuses what the code refuses", async () => {
  const db = getDb();
  const insert = (name: string, target = 10) =>
    db.query("INSERT INTO goals (name, target) VALUES ($1, $2)", [
      name,
      target,
    ]);
  await expect(insert("line\nforged")).rejects.toThrow(/check/i);
  await expect(insert(" padded ")).rejects.toThrow(/check/i);
  await expect(insert("")).rejects.toThrow(/check/i);
  await expect(insert("x".repeat(41))).rejects.toThrow(/check/i);
  await expect(insert("ok", -1)).rejects.toThrow(/check/i);
  await insert("Same");
  await expect(insert("SAME")).rejects.toThrow(/duplicate|unique/i);
});

import { createTestDb, type Db } from "@ops/core";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { sendPaydayMessage } from "./payday-message.js";
import { paySeen } from "./payday-plan.js";
import {
  createPaydaySettingsApi,
  type PaydaySettings,
} from "./payday-settings.js";

const settings: PaydaySettings = {
  pay: 1000,
  rent: 300,
  savings: 200,
  invest: 50,
  spending: null,
  payday: "2026-10-13", // a Tuesday
};

// A fake store that remembers the last payday sent, as the table does.
function setup(over: Partial<PaydaySettings> = {}) {
  let sent: string | null = null;
  const send = vi.fn<(text: string) => Promise<void>>(async () => {});
  const store = {
    getSettings: vi.fn(async () => ({ ...settings, ...over })),
    lastSent: vi.fn(async () => sent),
    markSent: vi.fn(async (d: string) => void (sent = d)),
  };
  const deps = {
    settings: store,
    goals: { listGoals: vi.fn(async () => []) },
    spent: vi.fn(async () => 350),
    paySeen: vi.fn(async () => true),
    send,
  };
  return {
    deps,
    send,
    store,
    run: (now: string) => sendPaydayMessage(deps, new Date(now)),
  };
}
// 08:00 NZ on a date, in UTC. NZDT (+13) from 27 September 2026, NZST (+12) before.
const morning = (date: string) =>
  new Date(
    Date.parse(`${date}T08:00:00Z`) -
      (date >= "2026-09-27" ? 13 : 12) * 3_600_000,
  ).toISOString();

test("nothing happens until a payday is set, or before the first one", async () => {
  const none = setup({ payday: null });
  expect(await none.run(morning("2026-10-14"))).toBe("not set");
  const early = setup();
  expect(await early.run(morning("2026-10-12"))).toBe("not yet");
  expect(early.send).not.toHaveBeenCalled();
  expect(none.send).not.toHaveBeenCalled();
});

test("on payday itself it waits, because the pay is not in the data yet", async () => {
  const s = setup();
  expect(await s.run(morning("2026-10-13"))).toBe("too early");
  expect(s.send).not.toHaveBeenCalled();
});

test("the morning after payday it sends the plan once, and not again that day or later", async () => {
  const s = setup();
  expect(await s.run(morning("2026-10-14"))).toBe("sent");
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.send.mock.calls[0]?.[0]).toContain("Payday plan for 2026-10-13");
  expect(s.send.mock.calls[0]?.[0]).not.toContain("not in my data");
  expect(s.store.markSent).toHaveBeenCalledExactlyOnceWith("2026-10-13");
  expect(await s.run(morning("2026-10-14"))).toBe("already sent"); // a second sync, or a restart
  expect(await s.run(morning("2026-10-15"))).toBe("already sent");
  expect(s.send).toHaveBeenCalledTimes(1);
});

test("a failed send records nothing, is tried again the next morning, and stops after the grace days", async () => {
  const s = setup();
  s.send.mockRejectedValueOnce(new Error("telegram down"));
  await expect(s.run(morning("2026-10-14"))).rejects.toThrow(/telegram down/);
  expect(s.store.markSent).not.toHaveBeenCalled();
  expect(await s.run(morning("2026-10-15"))).toBe("sent");
  const late = setup();
  expect(await late.run(morning("2026-10-17"))).toBe("sent"); // the last day it is tried: four after payday
  const gone = setup();
  expect(await gone.run(morning("2026-10-18"))).toBe("late");
  expect(gone.send).not.toHaveBeenCalled();
});

test("the next payday, 14 days on, sends again", async () => {
  const s = setup();
  await s.run(morning("2026-10-14"));
  expect(await s.run(morning("2026-10-27"))).toBe("too early");
  expect(await s.run(morning("2026-10-28"))).toBe("sent");
  expect(s.send).toHaveBeenCalledTimes(2);
  expect(s.send.mock.calls[1]?.[0]).toContain("Payday plan for 2026-10-27");
  expect(s.deps.spent).toHaveBeenLastCalledWith("2026-10-27");
});

test("if the pay is not in the data it says so and still shows the plan", async () => {
  const s = setup();
  s.deps.paySeen.mockResolvedValue(false);
  await s.run(morning("2026-10-14"));
  const text = s.send.mock.calls[0]?.[0] as string;
  expect(text).toContain("Savings: $280.00");
  expect(text).toContain(
    "The pay is not in my data yet, so this uses the pay you set.",
  );
  expect(s.deps.paySeen).toHaveBeenCalledWith("2026-10-13", 1000);
});

test("with a setting missing it says what is missing, once, without reading any spending", async () => {
  const s = setup({ pay: null });
  expect(await s.run(morning("2026-10-14"))).toBe("sent");
  expect(s.send.mock.calls[0]?.[0]).toBe(
    "Payday plan: still to set: pay. Use /payday set <item> <amount>.",
  );
  expect(s.deps.spent).not.toHaveBeenCalled();
  expect(await s.run(morning("2026-10-15"))).toBe("already sent");
});

test("the day is the New Zealand day, either side of the clock change", async () => {
  // Payday Tuesday 22 September; the message is due Wednesday 23rd, 08:00 NZST.
  const a = setup({ payday: "2026-09-22" });
  expect(await a.run(morning("2026-09-23"))).toBe("sent");
  // Paydays 22 Sept and 6 October; Wednesday 7 October 08:00 is NZDT.
  const b = setup({ payday: "2026-09-22" });
  await b.run(morning("2026-09-23"));
  expect(await b.run(morning("2026-10-07"))).toBe("sent");
  expect(b.send.mock.calls[1]?.[0]).toContain("Payday plan for 2026-10-06");
  // 23:30 NZ on the payday is still the payday.
  const c = setup({ payday: "2026-10-13" });
  expect(await c.run("2026-10-13T10:30:00Z")).toBe("too early");
});

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const getDb = (): Db => {
  if (!testDb) throw new Error("no database");
  return testDb.db;
};
beforeAll(async () => {
  testDb = await createTestDb("payday_message");
});
afterAll(() => testDb?.drop());
beforeEach(async () => {
  if (!testDb) return;
  const db = getDb();
  await db.query("TRUNCATE transactions, accounts, payday_settings");
  await db.query(
    `INSERT INTO accounts (akahu_id, name, bank, type, status, currency, synced_at)
     VALUES ('acc', 'Everyday', 'Westpac', 'CHECKING', 'ACTIVE', 'NZD', now())`,
  );
});
const needsDb = test.skipIf(!process.env.DATABASE_URL);
const tx = (i: number, date: string, amount: number, category: string) =>
  getDb().query(
    `INSERT INTO transactions (akahu_id, account_id, date, description, amount, type, category, synced_at)
     VALUES ($1, 'acc', $2::date + time '10:59', 'X', $3, 'EFTPOS', $4, now())`,
    [`t${i}`, date, amount, category],
  );

needsDb(
  "the pay counts as seen only for a big enough income on payday itself",
  async () => {
    expect(await paySeen(getDb(), "2026-10-13", 1000)).toBe(false);
    await tx(1, "2026-10-13", 899.99, "Income"); // under 90% of the pay
    await tx(2, "2026-10-12", 1000, "Income"); // the day before
    await tx(3, "2026-10-14", 1000, "Income"); // the day after
    await tx(4, "2026-10-13", 1000, "Transfers"); // not income
    await tx(5, "2026-10-13", -1000, "Income"); // money out
    expect(await paySeen(getDb(), "2026-10-13", 1000)).toBe(false);
    await tx(6, "2026-10-13", 900, "Income");
    expect(await paySeen(getDb(), "2026-10-13", 1000)).toBe(true);
  },
);

needsDb(
  "the last payday sent is stored, replaced, and must be a real date",
  async () => {
    const api = createPaydaySettingsApi(getDb());
    expect(await api.lastSent()).toBeNull();
    await api.markSent("2026-10-13");
    expect(await api.lastSent()).toBe("2026-10-13");
    await api.markSent("2026-10-27");
    expect(await api.lastSent()).toBe("2026-10-27");
    await expect(api.markSent("2026-02-30")).rejects.toThrow(/date/);
    await api.setAmount("pay", 100); // other settings leave it alone
    expect(await api.lastSent()).toBe("2026-10-27");
  },
);

// E4 against the real table: the stored date is what stops a repeat, so it
// has to survive a restart, which a new set of objects over the same database
// stands in for.
needsDb(
  "E4: two syncs on one morning, and a restart between them, send the message once; a failed send is tried again",
  async () => {
    const make = () => {
      const db = getDb();
      const send = vi.fn<(text: string) => Promise<void>>(async () => {});
      return {
        send,
        run: (now: string) =>
          sendPaydayMessage(
            {
              settings: createPaydaySettingsApi(db),
              goals: { listGoals: async () => [] },
              spent: async () => 350,
              paySeen: async () => true,
              send,
            },
            new Date(now),
          ),
      };
    };
    const api = createPaydaySettingsApi(getDb());
    for (const [item, amount] of [
      ["pay", 1000],
      ["rent", 300],
      ["savings", 200],
      ["invest", 50],
    ] as const)
      await api.setAmount(item, amount);
    await api.setPayday("2026-10-13");

    const failing = make();
    failing.send.mockRejectedValueOnce(new Error("telegram down"));
    await expect(failing.run(morning("2026-10-14"))).rejects.toThrow();
    expect(await api.lastSent()).toBeNull();

    const first = make();
    expect(await first.run(morning("2026-10-14"))).toBe("sent");
    expect(await first.run(morning("2026-10-14"))).toBe("already sent");
    const restarted = make();
    expect(await restarted.run(morning("2026-10-14"))).toBe("already sent");
    expect(await restarted.run(morning("2026-10-15"))).toBe("already sent");
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(restarted.send).not.toHaveBeenCalled();
    expect(await api.lastSent()).toBe("2026-10-13");
  },
);

import { expect, test, vi } from "vitest";
import type { AkahuAccount } from "./akahu.js";
import { refreshBankData } from "./refresh.js";

const NOW = Date.parse("2026-10-14T00:00:00Z"); // 13:00 NZDT
const iso = (hoursAgo: number) =>
  new Date(NOW - hoursAgo * 3_600_000).toISOString();
const acct = (id: string, hoursAgo?: number, status = "ACTIVE") =>
  ({
    _id: id,
    status,
    refreshed:
      hoursAgo === undefined ? undefined : { transactions: iso(hoursAgo) },
  }) as unknown as AkahuAccount;

// listAccounts answers from a script, one entry per call; the clock moves with sleep.
function setup(script: AkahuAccount[][]) {
  let clock = NOW;
  let calls = 0;
  const akahu = {
    listAccounts: vi.fn(
      async () =>
        script[Math.min(calls++, script.length - 1)] as AkahuAccount[],
    ),
    refresh: vi.fn(async () => {}),
  };
  const opts = {
    now: () => clock,
    sleep: async (ms: number) => void (clock += ms),
    timeoutMs: 60_000,
    pollMs: 15_000,
  };
  return { akahu, opts };
}

test("data under an hour old is left alone, inside Akahu's rest period", async () => {
  const { akahu, opts } = setup([[acct("a", 0.5), acct("b", 0.2)]]);
  expect(await refreshBankData(akahu, opts)).toBe("fresh");
  expect(akahu.refresh).not.toHaveBeenCalled();
});

test("stale data is refreshed, then it waits until every account has moved", async () => {
  const { akahu, opts } = setup([
    [acct("a", 23), acct("b", 23)], // before
    [acct("a", 23), acct("b", 23)], // asked, nothing yet
    [acct("a", 0), acct("b", 23)], // one moved
    [acct("a", 0), acct("b", 0)], // both moved
  ]);
  expect(await refreshBankData(akahu, opts)).toBe("refreshed");
  expect(akahu.refresh).toHaveBeenCalledTimes(1);
  // The list before, then three polls: it did not stop when only one account moved.
  expect(akahu.listAccounts).toHaveBeenCalledTimes(4);
});

test("if Akahu never moves, it gives up at the timeout and carries on", async () => {
  const { akahu, opts } = setup([[acct("a", 23)]]);
  expect(await refreshBankData(akahu, opts)).toBe("timed out");
  expect(akahu.refresh).toHaveBeenCalledTimes(1);
  expect(akahu.listAccounts).toHaveBeenCalledTimes(1 + 4); // before, then every 15s for 60s
});

test("an account with no refresh time counts as stale, and inactive ones are ignored", async () => {
  const { akahu, opts } = setup([
    [acct("a", 0.1), acct("b", undefined)],
    [acct("a", 0), acct("b", 0)],
  ]);
  expect(await refreshBankData(akahu, opts)).toBe("refreshed");
  const old = setup([[acct("a", 0.1), acct("gone", 90, "INACTIVE")]]);
  expect(await refreshBankData(old.akahu, old.opts)).toBe("fresh");
});

test("a refused refresh rejects, so the caller decides what to do", async () => {
  const { akahu, opts } = setup([[acct("a", 23)]]);
  akahu.refresh.mockRejectedValueOnce(new Error("Akahu refresh failed: 429"));
  await expect(refreshBankData(akahu, opts)).rejects.toThrow(/429/);
});

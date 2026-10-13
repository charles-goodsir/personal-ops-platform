import type { AkahuClient } from "./akahu.js";

const HOUR = 3_600_000;

export type RefreshResult = "fresh" | "refreshed" | "timed out";

const time = (iso: string | undefined) => (iso ? Date.parse(iso) : 0);

// Akahu pulls from the banks about once a day, at its own time, which for me
// is after the morning sync. So the sync asks for a pull first and waits for
// every account's `refreshed.transactions` to move. A personal app has a rest
// period of an hour: a request inside it is ignored, so data under an hour old
// is left alone. A timeout is not a failure: the sync goes on with what Akahu has.
export async function refreshBankData(
  akahu: Pick<AkahuClient, "listAccounts" | "refresh">,
  opts: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<RefreshResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const before = new Map(
    (await akahu.listAccounts())
      .filter((a) => a.status === "ACTIVE")
      .map((a) => [a._id, time(a.refreshed?.transactions)]),
  );
  if (before.size === 0) return "fresh";
  if (now() - Math.min(...before.values()) < HOUR) return "fresh";

  await akahu.refresh();
  const deadline = now() + (opts.timeoutMs ?? 3 * 60_000);
  while (now() < deadline) {
    await sleep(opts.pollMs ?? 15_000);
    const after = await akahu.listAccounts();
    if (
      [...before].every(([id, was]) => {
        const a = after.find((x) => x._id === id);
        return a && time(a.refreshed?.transactions) > was;
      })
    )
      return "refreshed";
  }
  return "timed out";
}

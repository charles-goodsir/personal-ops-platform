import Anthropic from "@anthropic-ai/sdk";
import type { Db, Logger } from "@ops/core";
import { maskDigits } from "./categorise.js";
import { detectRecurring, findAnomalies, loadRecentTxs } from "./insights.js";
import { resolvePeriod } from "./periods.js";
import { createFinanceApi, type Spending } from "./read.js";

const DAY = 86_400_000;

// Everything the model sees: totals and category sums, payee names for new
// subscriptions and unusual charges (digits masked). No transaction rows,
// no account names, no descriptions.
export type Digest = {
  week: WeekTotals;
  previousWeeks: WeekTotals[];
  newSubscriptions: { payee: string; cadence: string; amount: number }[];
  unusual: { payee: string; date: string; amount: number; why: string }[];
};

type WeekTotals = {
  label: string;
  spent: number;
  income: number;
  invested: number;
  byCategory: { category: string; spent: number }[];
};

const totals = (s: Spending): WeekTotals => ({
  label: s.range.label,
  spent: s.total,
  income: s.income,
  invested: s.invested,
  byCategory: s.byCategory.map(({ category, spent }) => ({ category, spent })),
});

// The week that just finished (Monday to Sunday, NZ time) against the three before it.
export async function buildDigest(db: Db, now: Date): Promise<Digest> {
  const api = createFinanceApi(db);
  const week = resolvePeriod("last_week", now);
  const spending = await Promise.all(
    [0, 1, 2, 3].map((k) =>
      api.getSpending(
        resolvePeriod("last_week", new Date(now.getTime() - k * 7 * DAY)),
      ),
    ),
  );

  const txs = await loadRecentTxs(db, now);
  const before = new Set(
    detectRecurring(
      txs.filter((t) => t.date < week.from),
      week.from,
    ).map((r) => r.payee),
  );
  const newSubscriptions = detectRecurring(txs, now)
    .filter((r) => r.active && !before.has(r.payee))
    .map((r) => ({
      payee: maskDigits(r.payee),
      cadence: r.cadence,
      amount: r.typicalAmount,
    }));
  const unusual = findAnomalies(txs, week.from, week.to).map((a) => ({
    payee: maskDigits(a.merchant ?? a.description),
    date: a.date.toISOString().slice(0, 10),
    amount: -a.amount,
    why: a.detail,
  }));

  const [current, ...previous] = spending.map(totals);
  return {
    week: current as WeekTotals,
    previousWeeks: previous,
    newSubscriptions,
    unusual,
  };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

// What gets sent when there's no API key or the model call fails.
export function plainSummary(d: Digest): string {
  const avg =
    d.previousWeeks.reduce((s, w) => s + w.spent, 0) /
    Math.max(d.previousWeeks.length, 1);
  const lines = [
    `Week ${d.week.label}`,
    `Spent ${usd(d.week.spent)} (previous 3 weeks averaged ${usd(avg)})`,
    ...d.week.byCategory
      .slice(0, 5)
      .map((c) => `  ${c.category} ${usd(c.spent)}`),
    `Income ${usd(d.week.income)}, invested ${usd(d.week.invested)}`,
  ];
  if (d.newSubscriptions.length)
    lines.push(
      "New subscriptions: " +
        d.newSubscriptions
          .map((s) => `${s.payee} ${usd(s.amount)} ${s.cadence}`)
          .join(", "),
    );
  if (d.unusual.length)
    lines.push(
      "Unusual: " +
        d.unusual
          .map((u) => `${u.payee} ${usd(u.amount)} (${u.why})`)
          .join("; "),
    );
  return lines.join("\n");
}

export type Summariser = (digest: Digest) => Promise<string>;

const SYSTEM = `You write my weekly spending summary, sent as a Telegram text message.
You get JSON: last week's totals and category spending, the three weeks before
it, new recurring charges, and unusual charges. Amounts are NZD, spent is money
out. Plain text only, no Markdown, under 900 characters. Lead with the total and
how it compares to the previous weeks, name the categories that moved most, then
mention any new subscriptions or unusual charges. Use only the numbers given.
If there is nothing notable, say so briefly.`;

export function createClaudeSummariser(opts: {
  apiKey: string;
  model: string;
}): Summariser {
  const client = new Anthropic({ apiKey: opts.apiKey });
  return async (digest) => {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(digest) }],
    });
    const text = response.content.find((b) => b.type === "text");
    if (response.stop_reason !== "end_turn" || !text?.text.trim()) {
      throw new Error(`summary stopped: ${response.stop_reason ?? "unknown"}`);
    }
    return text.text.trim();
  };
}

// Plain text, no parse_mode, so nothing in the message can break formatting.
// Errors carry Telegram's description only: the URL holds the bot token.
export function createTelegramSender(opts: {
  token: string;
  chatId: string;
  fetchFn?: typeof fetch;
}) {
  const doFetch = opts.fetchFn ?? fetch;
  return async (text: string): Promise<void> => {
    const res = await doFetch(
      `https://api.telegram.org/bot${opts.token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: opts.chatId,
          text: text.slice(0, 4000),
        }),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        description?: string;
      };
      throw new Error(
        `telegram send failed: ${res.status} ${body.description ?? ""}`.trim(),
      );
    }
  };
}

export async function sendWeeklySummary(opts: {
  db: Db;
  send: (text: string) => Promise<void>;
  summarise?: Summariser;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  const digest = await buildDigest(opts.db, opts.now ?? new Date());
  let text = plainSummary(digest);
  if (opts.summarise) {
    try {
      text = await opts.summarise(digest);
    } catch (err) {
      opts.logger.warn({ err }, "summary model failed, sending plain numbers");
    }
  }
  await opts.send(text);
}

// Monday 08:00 in New Zealand, after `now`.
const TZ = "Pacific/Auckland";
const RUN_HOUR = 8;

const offsetMs = (t: number) => {
  const name =
    new Intl.DateTimeFormat("en", { timeZone: TZ, timeZoneName: "longOffset" })
      .formatToParts(t)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /([+-])(\d\d):(\d\d)/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
};

export function nextRun(now: Date): Date {
  // NZ wall clock, read through UTC fields.
  const local = new Date(now.getTime() + offsetMs(now.getTime()));
  for (let d = 0; d <= 7; d++) {
    const wall = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + d,
      RUN_HOUR,
    );
    if (new Date(wall).getUTCDay() !== 1) continue;
    // Clock changes happen at 2-3am, so the offset 12h before 08:00 is the one in force at 08:00.
    const at = new Date(wall - offsetMs(wall - 12 * 3_600_000));
    if (at > now) return at;
  }
  throw new Error("no Monday found in the next 8 days");
}

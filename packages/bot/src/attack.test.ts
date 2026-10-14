import type { Logger } from "@ops/core";
import { expect, test, vi } from "vitest";
import { createCommandHandler } from "./commands.js";
import { createBot, isAuthorised, type Update } from "./poller.js";

// Batch C (C1, C2) of the threat model: the Telegram bot, with updates and
// commands that only a hostile or broken sender would produce. Each test asserts
// the secure behaviour, so a failure is a finding.
const ME = "42";
const SECRET = "123456:secret-bot-token";

function setup(handle = vi.fn(async (t: string) => `ok ${t}`)) {
  const sent: string[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
    sent.push(JSON.parse(init?.body as string).text);
    return Response.json({ ok: true, result: true });
  });
  const logger = { warn: vi.fn(), error: vi.fn() };
  const bot = createBot({
    token: SECRET,
    chatId: ME,
    handle,
    logger: logger as unknown as Logger,
    fetchFn,
  });
  return { bot, handle, sent, logger };
}
const message = (id: number, over: Record<string, unknown> = {}) =>
  ({
    update_id: id,
    message: {
      text: "/help",
      chat: { id: 42, type: "private" },
      from: { id: 42 },
      ...over,
    },
  }) as unknown as Update;

test.each<[string, Update]>([
  ["a group with my id", message(1, { chat: { id: 42, type: "group" } })],
  ["a supergroup", message(2, { chat: { id: 42, type: "supergroup" } })],
  ["a channel", message(3, { chat: { id: 42, type: "channel" } })],
  [
    "a stranger's private chat",
    message(4, { chat: { id: 7, type: "private" }, from: { id: 7 } }),
  ],
  ["my chat but another sender", message(5, { from: { id: 7 } })],
  ["my chat and no sender", message(6, { from: undefined })],
  ["a sender that is a bot", message(7, { from: { id: 7, is_bot: true } })],
  [
    "an edited message",
    { update_id: 8, edited_message: message(8).message } as unknown as Update,
  ],
  [
    "a channel post",
    { update_id: 9, channel_post: message(9).message } as unknown as Update,
  ],
  [
    "a callback query",
    {
      update_id: 10,
      callback_query: { id: "1", from: { id: 42 } },
    } as unknown as Update,
  ],
  [
    "an inline query",
    {
      update_id: 11,
      inline_query: { id: "1", from: { id: 42 }, query: "/help" },
    } as unknown as Update,
  ],
  [
    "a membership change",
    { update_id: 12, my_chat_member: {} } as unknown as Update,
  ],
  ["an empty update", { update_id: 13 } as unknown as Update],
])("C1: %s gets no reply and runs nothing", async (_name, update) => {
  const { bot, handle, sent } = setup();
  await bot.process([update]);
  expect(handle).not.toHaveBeenCalled();
  expect(sent).toEqual([]);
});

test("C1: my own message with no text (a photo, a sticker) runs nothing", async () => {
  const { bot, handle, sent } = setup();
  await bot.process([message(1, { text: undefined })]);
  expect(handle).not.toHaveBeenCalled();
  expect(sent).toEqual([]);
});

test("C1: an update with no chat at all does not stop the bot, and the offset moves on", async () => {
  // A poison pill: if this threw, the poll loop would ask for the same update again forever.
  const { bot } = setup();
  const broken = {
    update_id: 20,
    message: { text: "/help" },
  } as unknown as Update;
  const next = await bot.process([broken, message(21)]);
  expect(next).toBe(22);
});

test("C1: a stranger's message never shows up in a log line", async () => {
  const { bot, logger } = setup();
  await bot.process([
    message(1, {
      chat: { id: 7, type: "private" },
      from: { id: 7 },
      text: "my password is hunter2",
    }),
  ]);
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("hunter2");
});

const finance = () => ({
  getSpending: vi.fn(async () => {
    throw new Error("must not be reached");
  }),
  getCategorySpending: vi.fn(async () => {
    throw new Error("must not be reached");
  }),
  listSubscriptions: vi.fn(async () => []),
  getTransactions: vi.fn(async () => []),
});
function commands() {
  const f = finance();
  const searchNotes = vi.fn(async () => []);
  const payday = {
    getSettings: vi.fn(),
    setAmount: vi.fn(),
    setPayday: vi.fn(),
  };
  const goals = {
    listGoals: vi.fn(async () => []),
    addGoal: vi.fn(async (g: { name: string; target: number }) => ({
      ...g,
      saved: 0,
      weight: 1,
      due: null,
    })),
    setSaved: vi.fn(),
    setWeight: vi.fn(),
    removeGoal: vi.fn(),
  };
  const handle = createCommandHandler({
    finance: f as never,
    payday: payday as never,
    goals: goals as never,
    spent: async () => 0,
    notes: { searchNotes },
    briefing: async () => "briefing",
    jobs: async () => [],
  });
  return { handle, f, searchNotes, payday, goals };
}

test.each([
  "/spend\u0000",
  "/spend‮",
  "/ѕpend", // a Cyrillic s
  "/spend\n/subs",
  "/spend last month ; DROP TABLE transactions",
  "/spend last month Groceries Groceries",
  "/spend last month '; --",
  "//spend",
  "/ spend",
  "/spend " + "x".repeat(150),
  "\ud83d",
  "/subs\u0000all",
])("C2: %j never reaches the database as free text", async (text) => {
  const { handle, f } = commands();
  const reply = await handle(text);
  expect(typeof reply).toBe("string");
  expect(reply.length).toBeLessThan(4000);
  // The finance calls only ever get a period and a known category.
  for (const call of [
    ...f.getCategorySpending.mock.calls,
    ...f.getSpending.mock.calls,
  ])
    expect(JSON.stringify(call)).not.toMatch(/DROP|;|--/);
});

test.each([
  "/payday set pay 100\u0000",
  "/payday set pay 100\u202e",
  "/payday set pay 1e3",
  "/payday set pay 0x10",
  "/payday set pay -5",
  "/payday set pay +5",
  "/payday set pay 0",
  "/payday set pay NaN",
  "/payday set pay 0.001",
  "/payday set pay 99999999",
  "/payday set pay \u0661\u0660\u0660", // Arabic-Indic digits
  "/payday set pay \uff11\uff10\uff10", // fullwidth digits
  "/payday set pay 100 100",
  "/payday set pay",
  "/payday set",
  "/payday set \u0440ay 100", // a Cyrillic p
  "/payday set constructor 100",
  "/payday set __proto__ 100",
  "/payday set pay; DROP TABLE payday_settings 100",
  "/payday set pay 100\n/payday set rent 1",
  "/payday change pay 100",
])("E1: %j never reaches the settings table", async (text) => {
  const { handle, payday } = commands();
  const reply = await handle(text);
  expect(typeof reply).toBe("string");
  expect(reply.length).toBeLessThan(4000);
  expect(payday.setAmount).not.toHaveBeenCalled();
});

test.each([
  "/payday set payday tomorrow",
  "/payday set payday 2026-13-45x",
  "/payday set payday 2026-10-13T00:00",
  "/payday set payday 26-10-13",
  "/payday set payday 2026-10-13 2026-10-27",
])("E1: %j never reaches the settings table as a date", async (text) => {
  const { handle, payday } = commands();
  await handle(text);
  expect(payday.setPayday).not.toHaveBeenCalled();
});

test.each([
  "/goal add Holiday 0",
  "/goal add Holiday -5",
  "/goal add Holiday 1e3",
  "/goal add Holiday 99999999",
  "/goal add Holiday \u0661\u0660\u0660",
  "/goal add 1000",
  "/goal add",
  "/goal add <script>alert(1)</script> 100",
  '/goal add "quoted" 100',
  "/goal add a;b 100",
  "/goal add -leading 100",
  "/goal add emoji \ud83d\ude80 100",
  "/goal add nul\u0000byte 100",
  "/goal add rtl\u202eoverride 100",
  `/goal add ${"x".repeat(41)} 100`,
  "/goal saved Holiday -1",
  "/goal saved Holiday 1e3",
  "/goal saved Holiday",
  "/goal weight Holiday 0",
  "/goal weight Holiday 11",
  "/goal weight Holiday 1.5",
])("E1/E2: %j never reaches the goals table", async (text) => {
  const { handle, goals } = commands();
  const reply = await handle(text);
  expect(typeof reply).toBe("string");
  expect(reply.length).toBeLessThan(4000);
  expect(goals.addGoal).not.toHaveBeenCalled();
  expect(goals.setSaved).not.toHaveBeenCalled();
  expect(goals.setWeight).not.toHaveBeenCalled();
});

test("E2: a newline in a goal name becomes a space, so no second line can reach the list", async () => {
  const { handle, goals } = commands();
  await handle("/goal add Holiday\nfake line 100");
  expect(goals.addGoal).toHaveBeenCalledExactlyOnceWith({
    name: "Holiday fake line",
    target: 100,
    due: undefined,
  });
});

test.each([
  "/payday set pay 1",
  "/payday set payday 2026-10-13",
  "/goal add Holiday 100",
  "/goal saved Holiday 100",
  "/goal remove Holiday",
])(
  "E5: %s from a group, a stranger or another sender runs nothing",
  async (text) => {
    for (const over of [
      { chat: { id: 42, type: "group" } },
      { chat: { id: 7, type: "private" }, from: { id: 7 } },
      { from: { id: 7 } },
    ]) {
      const { bot, handle, sent } = setup();
      await bot.process([message(1, { ...over, text })]);
      expect(handle).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    }
  },
);

test("C2: a message of 100 characters is handled and 101 is refused", async () => {
  const { handle, searchNotes } = commands();
  await handle("/notes " + "a".repeat(93));
  expect(searchNotes).toHaveBeenCalledTimes(1);
  expect(await handle("/notes " + "a".repeat(94))).toBe(
    "That message is too long.",
  );
  expect(searchNotes).toHaveBeenCalledTimes(1);
});

test("C2: a flood of 50 messages runs 10 and drops the rest", async () => {
  const { bot, handle, sent } = setup();
  await bot.process(Array.from({ length: 50 }, (_, i) => message(i + 1)));
  expect(handle).toHaveBeenCalledTimes(10);
  expect(sent).toHaveLength(10);
});

test("C2: when a command fails, the reply is generic and the error is not sent", async () => {
  const { bot, sent } = setup(
    vi.fn(async () => {
      throw new Error(
        "password=hunter2 at /app/packages/finance/dist/read.js:12",
      );
    }),
  );
  await bot.process([message(1)]);
  expect(sent).toEqual(["Something went wrong."]);
});

test("C1: an update with no chat is refused by the check itself, not only caught later", () => {
  const broken = { update_id: 1, message: { text: "/help", from: { id: 42 } } };
  expect(isAuthorised(broken as unknown as Update, ME)).toBe(false);
});

test("C1: an update that throws when read is skipped and the next one still runs", async () => {
  const { bot, handle } = setup();
  const poison = {
    update_id: 30,
    get message(): never {
      throw new Error("boom");
    },
  } as unknown as Update;
  const next = await bot.process([poison, message(31)]);
  expect(handle).toHaveBeenCalledTimes(1);
  expect(next).toBe(32);
});

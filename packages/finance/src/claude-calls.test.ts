import { beforeEach, expect, test, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

import { CATEGORIES } from "./categories.js";
import { createClaudeClassifier } from "./claude.js";
import { createClaudeSummariser, type Digest } from "./summary.js";

const reply = (text: string, stop_reason = "end_turn") => ({
  content: [{ type: "text", text }],
  stop_reason,
});
const item = {
  id: 1,
  description: "COUNTDOWN",
  amount: -10,
  type: "EFTPOS",
  merchant: null,
  akahuCategory: null,
};
const digest = {
  week: { label: "w", spent: 1, income: 0, invested: 0, byCategory: [] },
  previousWeeks: [],
  newSubscriptions: [],
  unusual: [],
} satisfies Digest;

beforeEach(() => create.mockReset());

test("classifier: asks for a real enum of every category, and returns the parsed results", async () => {
  create.mockResolvedValue(
    reply(JSON.stringify({ results: [{ id: 1, category: "Groceries" }] })),
  );
  const out = await createClaudeClassifier({ apiKey: "k", model: "m1" })([
    item,
  ]);
  expect(out).toEqual([{ id: 1, category: "Groceries" }]);
  const req = create.mock.calls[0]?.[0];
  expect(req.model).toBe("m1");
  expect(req.messages[0].content).toBe(JSON.stringify([item]));
  // The SDK's zod helper once turned this enum into a description.
  expect(
    req.output_config.format.schema.properties.results.items.properties.category
      .enum,
  ).toEqual([...CATEGORIES]);
});

test("classifier: a category outside the list is rejected", async () => {
  create.mockResolvedValue(
    reply(JSON.stringify({ results: [{ id: 1, category: "Gambling" }] })),
  );
  await expect(
    createClaudeClassifier({ apiKey: "k", model: "m" })([item]),
  ).rejects.toThrow();
});

test("classifier: a reply that stopped early is an error, not a partial answer", async () => {
  create.mockResolvedValue(reply("{}", "max_tokens"));
  await expect(
    createClaudeClassifier({ apiKey: "k", model: "m" })([item]),
  ).rejects.toThrow(/max_tokens/);
});

test("summariser: sends the digest as JSON and returns the trimmed text", async () => {
  create.mockResolvedValue(reply("  Spent $1.  "));
  const text = await createClaudeSummariser({ apiKey: "k", model: "m2" })(
    digest,
  );
  expect(text).toBe("Spent $1.");
  const req = create.mock.calls[0]?.[0];
  expect(req.model).toBe("m2");
  expect(req.messages[0].content).toBe(JSON.stringify(digest));
});

test("summariser: empty text or an early stop is an error, so the plain numbers are sent instead", async () => {
  const s = createClaudeSummariser({ apiKey: "k", model: "m" });
  create.mockResolvedValue(reply("   "));
  await expect(s(digest)).rejects.toThrow(/summary stopped/);
  create.mockResolvedValue(reply("text", "max_tokens"));
  await expect(s(digest)).rejects.toThrow(/max_tokens/);
});

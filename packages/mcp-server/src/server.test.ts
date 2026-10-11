import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLogger, type Db } from "@ops/core";
import type { RulesApi } from "@ops/finance";
import type { NotesApi } from "@ops/knowledge-base";
import { expect, test, vi } from "vitest";
import { createServer, MAX_NOTE_CHARS } from "./server.js";

const when = new Date("2026-10-10T00:00:00Z");
const fakeNotes = {
  searchNotes: vi.fn(async () => [
    {
      noteId: "7",
      title: "Docker",
      path: "homelab/docker.md",
      heading: "Docker > Ports",
      content: "Published ports bypass ufw.",
      score: 0.71234,
    },
    {
      noteId: "8",
      title: "scratch",
      path: "scratch.txt",
      heading: null,
      content: "loose text",
      score: 0.5,
    },
  ]),
  getNote: vi.fn(async (id: string) =>
    id === "7"
      ? {
          id,
          title: "Docker",
          path: "homelab/docker.md",
          content: "full body",
          modifiedAt: when,
        }
      : id === "9"
        ? {
            id,
            title: "Big",
            path: "big.pdf",
            content: "x".repeat(MAX_NOTE_CHARS + 10),
            modifiedAt: when,
          }
        : undefined,
  ),
  listRecentNotes: vi.fn(async () => [
    { id: "7", title: "Docker", path: "homelab/docker.md", modifiedAt: when },
  ]),
} satisfies NotesApi;

const fakeRules = {
  addRule: vi.fn(async (pattern: string, category: string) => ({
    pattern: pattern.trim().toLowerCase(),
    category,
    replaced: pattern === "countdown" ? "Eating out" : null,
    matches: 6,
    changed: 6,
  })),
  listRules: vi.fn(async () => [
    {
      pattern: "southern cross pet",
      category: "Insurance",
      matches: 6,
      createdAt: when,
    },
  ]),
  removeRule: vi.fn(async (pattern: string) =>
    pattern === "gone"
      ? { pattern, removed: false, uncategorised: 0 }
      : { pattern, removed: true, uncategorised: 6, recategorised: 0 },
  ),
} as unknown as RulesApi;

async function connect(db: Pick<Db, "query">, notes: NotesApi = fakeNotes) {
  const logger = createLogger({ LOG_LEVEL: "fatal" });
  const server = createServer({
    db: db as Db,
    logger,
    notes,
    rules: fakeRules,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

const healthyDb = {
  query: async () => ({ rows: [{ ok: 1 }] }),
} as unknown as Db;
const brokenDb = {
  query: async () => {
    throw new Error("connection refused");
  },
} as unknown as Db;

test("lists every tool, and only the rule edits can change data", async () => {
  const client = await connect(healthyDb);
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual([
    "ping",
    "search_notes",
    "get_note",
    "list_recent_notes",
    "add_category_rule",
    "list_category_rules",
    "remove_category_rule",
  ]);
  const writers = tools
    .filter((t) => !t.annotations?.readOnlyHint)
    .map((t) => t.name);
  expect(writers).toEqual(["add_category_rule", "remove_category_rule"]);
  const remove = tools.find((t) => t.name === "remove_category_rule");
  expect(remove?.annotations?.destructiveHint).toBe(true);
});

test("add_category_rule saves and reports what changed", async () => {
  const client = await connect(healthyDb);
  const result = await client.callTool({
    name: "add_category_rule",
    arguments: { pattern: "Southern Cross Pet", category: "Insurance" },
  });
  expect(fakeRules.addRule).toHaveBeenLastCalledWith(
    "Southern Cross Pet",
    "Insurance",
  );
  expect(textOf(result)).toBe(
    'Rule saved: "southern cross pet" -> Insurance. Matches 6 transactions; 6 changed category.',
  );
});

test("add_category_rule refuses a category outside the list", async () => {
  const client = await connect(healthyDb);
  vi.mocked(fakeRules.addRule).mockClear();
  const result = await client.callTool({
    name: "add_category_rule",
    arguments: { pattern: "pet", category: "Bribes" },
  });
  expect(result.isError).toBe(true);
  expect(fakeRules.addRule).not.toHaveBeenCalled();
});

test("the category list reaches the client as a real enum", async () => {
  const client = await connect(healthyDb);
  const { tools } = await client.listTools();
  const schema = tools.find((t) => t.name === "add_category_rule")
    ?.inputSchema as unknown as {
    properties: { category: { enum?: string[] } };
  };
  expect(schema.properties.category.enum).toContain("Insurance");
});

test("list and remove rules", async () => {
  const client = await connect(healthyDb);
  expect(
    textOf(
      await client.callTool({ name: "list_category_rules", arguments: {} }),
    ),
  ).toBe('"southern cross pet" -> Insurance (6 matches)');
  const removed = await client.callTool({
    name: "remove_category_rule",
    arguments: { pattern: "southern cross pet" },
  });
  expect(textOf(removed)).toBe(
    'Rule "southern cross pet" removed. 6 transactions are uncategorised until the next sync.',
  );
  const missing = await client.callTool({
    name: "remove_category_rule",
    arguments: { pattern: "gone" },
  });
  expect(missing.isError).toBe(true);
});

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { text: string }[])[0]?.text;

test("search_notes returns passages with their source", async () => {
  const client = await connect(healthyDb);
  const result = await client.callTool({
    name: "search_notes",
    arguments: { query: "docker ports" },
  });
  expect(fakeNotes.searchNotes).toHaveBeenLastCalledWith("docker ports", 5);
  expect(textOf(result)).toBe(
    "[1] Docker | homelab/docker.md > Docker > Ports | note id 7 | score 0.712\nPublished ports bypass ufw.\n\n" +
      "[2] scratch | scratch.txt | note id 8 | score 0.500\nloose text",
  );
});

test("search_notes rejects a limit over 20", async () => {
  const client = await connect(healthyDb);
  const result = await client.callTool({
    name: "search_notes",
    arguments: { query: "x", limit: 500 },
  });
  expect(result.isError).toBe(true);
});

test("get_note returns the note, an error for an unknown id", async () => {
  const client = await connect(healthyDb);
  const found = await client.callTool({
    name: "get_note",
    arguments: { id: "7" },
  });
  expect(textOf(found)).toBe(
    "Docker | homelab/docker.md | modified 2026-10-10T00:00:00.000Z\n\nfull body",
  );
  const missing = await client.callTool({
    name: "get_note",
    arguments: { id: "404" },
  });
  expect(missing.isError).toBe(true);
  expect(textOf(missing)).toBe("No note with id 404.");
});

test("get_note truncates huge notes", async () => {
  const client = await connect(healthyDb);
  const result = await client.callTool({
    name: "get_note",
    arguments: { id: "9" },
  });
  expect(textOf(result)).toMatch(/\[truncated: 50010 characters in total\]$/);
});

test("get_note rejects a non-numeric id", async () => {
  const client = await connect(healthyDb);
  const result = await client.callTool({
    name: "get_note",
    arguments: { id: "1; drop table notes" },
  });
  expect(result.isError).toBe(true);
  expect(fakeNotes.getNote).not.toHaveBeenCalledWith("1; drop table notes");
});

test("list_recent_notes lists ids, titles and dates", async () => {
  const client = await connect(healthyDb);
  const result = await client.callTool({
    name: "list_recent_notes",
    arguments: {},
  });
  expect(fakeNotes.listRecentNotes).toHaveBeenLastCalledWith(10);
  expect(textOf(result)).toBe(
    "note id 7 | Docker | homelab/docker.md | modified 2026-10-10T00:00:00.000Z",
  );
});

test("ping reports a healthy database", async () => {
  const client = await connect(healthyDb);
  const result = await client.callTool({ name: "ping" });
  expect(result.content).toEqual([
    { type: "text", text: "pong (database: ok)" },
  ]);
});

test("ping still answers when the database is down", async () => {
  const client = await connect(brokenDb);
  const result = await client.callTool({ name: "ping" });
  expect(result.content).toEqual([
    { type: "text", text: "pong (database: unreachable)" },
  ]);
});

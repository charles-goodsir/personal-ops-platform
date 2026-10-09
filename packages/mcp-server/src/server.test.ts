import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLogger, type Db } from "@ops/core";
import { expect, test } from "vitest";
import { createServer } from "./server.js";

async function connect(db: Pick<Db, "query">) {
  const logger = createLogger({ LOG_LEVEL: "fatal" });
  const server = createServer({ db: db as Db, logger });
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

test("lists ping", async () => {
  const client = await connect(healthyDb);
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(["ping"]);
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

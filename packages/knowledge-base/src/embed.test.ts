import { afterEach, expect, test, vi } from "vitest";
import { createEmbedder } from "./embed.js";

const embed = createEmbedder({
  url: "http://ollama:11434",
  model: "nomic-embed-text",
});

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

function sentBody(fetch: ReturnType<typeof mockFetch>) {
  const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  return { url: url.href, body: JSON.parse(init.body as string) };
}

test("sends the model and document prefix", async () => {
  const fetch = mockFetch(200, { embeddings: [[0.1], [0.2]] });
  await expect(embed(["a", "b"], "document")).resolves.toEqual([[0.1], [0.2]]);
  expect(sentBody(fetch)).toEqual({
    url: "http://ollama:11434/api/embed",
    body: {
      model: "nomic-embed-text",
      input: ["search_document: a", "search_document: b"],
    },
  });
});

test("uses the query prefix for queries", async () => {
  const fetch = mockFetch(200, { embeddings: [[0.1]] });
  await embed(["q"], "query");
  expect(sentBody(fetch).body.input).toEqual(["search_query: q"]);
});

test("skips the request for no input", async () => {
  const fetch = mockFetch(200, { embeddings: [] });
  await expect(embed([], "document")).resolves.toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test("throws on an HTTP error", async () => {
  mockFetch(404, { error: 'model "nomic-embed-text" not found' });
  await expect(embed(["a"], "query")).rejects.toThrow(/404.*not found/);
});

test("throws when the count does not match the input", async () => {
  mockFetch(200, { embeddings: [[0.1]] });
  await expect(embed(["a", "b"], "document")).rejects.toThrow(
    /1 embeddings for 2/,
  );
});

import { z } from "zod";

// nomic-embed-text is trained with task prefixes. Leaving them off
// noticeably hurts retrieval, so callers say which side they are on.
const prefixes = {
  document: "search_document: ",
  query: "search_query: ",
} as const;

const response = z.object({ embeddings: z.array(z.array(z.number())) });

export type Embedder = (
  texts: string[],
  kind: keyof typeof prefixes,
) => Promise<number[][]>;

export function createEmbedder(opts: { url: string; model: string }): Embedder {
  return async (texts, kind) => {
    if (texts.length === 0) return [];
    const res = await fetch(new URL("/api/embed", opts.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        input: texts.map((t) => prefixes[kind] + t),
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
    }
    const { embeddings } = response.parse(await res.json());
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Ollama returned ${embeddings.length} embeddings for ${texts.length} inputs`,
      );
    }
    return embeddings;
  };
}

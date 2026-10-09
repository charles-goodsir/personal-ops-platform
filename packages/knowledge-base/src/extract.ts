import { basename, extname } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import {
  chunkMarkdown,
  chunkText,
  markdownTitle,
  type Chunk,
} from "./chunk.js";

export type ParsedNote = { title: string; content: string; chunks: Chunk[] };

export const SUPPORTED = new Set([".md", ".markdown", ".txt", ".pdf"]);

// Turns a file into its text and chunks. Returns null for unsupported types.
export async function parseNote(
  path: string,
  data: Uint8Array,
): Promise<ParsedNote | null> {
  const ext = extname(path).toLowerCase();
  if (!SUPPORTED.has(ext)) return null;
  const fallbackTitle = basename(path, extname(path));

  if (ext === ".pdf") {
    const pdf = await getDocumentProxy(data);
    const { text } = await extractText(pdf, { mergePages: false });
    // Pages are joined as paragraphs, so a chunk rarely spans a page break.
    const content = text.map((page) => page.trim()).join("\n\n");
    return { title: fallbackTitle, content, chunks: chunkText(content) };
  }

  const content = new TextDecoder().decode(data);
  if (ext === ".txt") {
    return { title: fallbackTitle, content, chunks: chunkText(content) };
  }
  return {
    title: markdownTitle(content) ?? fallbackTitle,
    content,
    chunks: chunkMarkdown(content),
  };
}

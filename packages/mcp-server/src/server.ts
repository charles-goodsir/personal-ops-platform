import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkDb, type Db, type Logger } from "@ops/core";
import type { NotesApi } from "@ops/knowledge-base";
import { z } from "zod";

export interface Deps {
  db: Db;
  logger: Logger;
  notes: NotesApi;
}

// Keeps one huge PDF from flooding the conversation.
export const MAX_NOTE_CHARS = 50_000;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function createServer({ db, logger, notes }: Deps): McpServer {
  const server = new McpServer({ name: "personal-ops", version: "0.0.0" });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Health check. Returns pong and whether the database is reachable.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const dbOk = await checkDb(db).catch((err: unknown) => {
        logger.warn({ err }, "ping: database check failed");
        return false;
      });
      return {
        content: [
          {
            type: "text",
            text: `pong (database: ${dbOk ? "ok" : "unreachable"})`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Semantic search over my personal notes (Markdown, text, PDF). Returns the most relevant passages with their source file and heading. Cite the path when answering from them, and use get_note for the full text.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("What to look for, in plain language"),
        limit: z.number().int().min(1).max(20).default(5),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const hits = await notes.searchNotes(query, limit);
      if (hits.length === 0) return text("No matching notes.");
      return text(
        hits
          .map((h, i) => {
            const where = h.heading ? `${h.path} > ${h.heading}` : h.path;
            return `[${i + 1}] ${h.title} | ${where} | note id ${h.noteId} | score ${h.score.toFixed(3)}\n${h.content}`;
          })
          .join("\n\n"),
      );
    },
  );

  server.registerTool(
    "get_note",
    {
      title: "Get note",
      description:
        "Full text of one note, by the note id from search_notes or list_recent_notes.",
      inputSchema: { id: z.string().regex(/^\d+$/, "a numeric note id") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const note = await notes.getNote(id);
      if (!note) return { ...text(`No note with id ${id}.`), isError: true };
      const body =
        note.content.length > MAX_NOTE_CHARS
          ? `${note.content.slice(0, MAX_NOTE_CHARS)}\n\n[truncated: ${note.content.length} characters in total]`
          : note.content;
      return text(
        `${note.title} | ${note.path} | modified ${note.modifiedAt.toISOString()}\n\n${body}`,
      );
    },
  );

  server.registerTool(
    "list_recent_notes",
    {
      title: "List recent notes",
      description: "My most recently modified notes, newest first.",
      inputSchema: { n: z.number().int().min(1).max(50).default(10) },
      annotations: { readOnlyHint: true },
    },
    async ({ n }) => {
      const recent = await notes.listRecentNotes(n);
      if (recent.length === 0) return text("No notes indexed yet.");
      return text(
        recent
          .map(
            (r) =>
              `note id ${r.id} | ${r.title} | ${r.path} | modified ${r.modifiedAt.toISOString()}`,
          )
          .join("\n"),
      );
    },
  );

  return server;
}

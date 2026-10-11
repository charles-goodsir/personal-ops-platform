import type { Db } from "@ops/core";
import type { Embedder } from "./embed.js";

export type SearchHit = {
  noteId: string;
  title: string;
  path: string;
  heading: string | null;
  content: string;
  score: number; // cosine similarity, 1 = identical
};

export type Note = {
  id: string;
  title: string;
  path: string;
  content: string;
  modifiedAt: Date;
};

export type NoteSummary = Omit<Note, "content">;

// Read side of the knowledge base: what the MCP tools call.
export function createNotesApi(deps: {
  db: Db;
  embed: Embedder;
  model: string;
}) {
  const { db, embed, model } = deps;

  return {
    // Chunks nearest the query. Only vectors from the current model are
    // comparable, so rows from an older model are left out until re-indexed.
    async searchNotes(query: string, limit: number): Promise<SearchHit[]> {
      const [vector] = await embed([query], "query");
      if (!vector) return [];
      const { rows } = await db.query<SearchHit>(
        `SELECT n.id AS "noteId", n.title, n.path, c.heading, c.content,
                1 - (c.embedding <=> $1) AS score
         FROM chunks c JOIN notes n ON n.id = c.note_id
         WHERE c.model = $2
         ORDER BY c.embedding <=> $1
         LIMIT $3`,
        [`[${vector.join(",")}]`, model, limit],
      );
      return rows;
    },

    async getNote(id: string): Promise<Note | undefined> {
      const { rows } = await db.query<Note>(
        `SELECT id, title, path, content, modified_at AS "modifiedAt"
         FROM notes WHERE id = $1`,
        [id],
      );
      return rows[0];
    },

    async listRecentNotes(n: number): Promise<NoteSummary[]> {
      const { rows } = await db.query<NoteSummary>(
        `SELECT id, title, path, modified_at AS "modifiedAt"
         FROM notes ORDER BY modified_at DESC LIMIT $1`,
        [n],
      );
      return rows;
    },
  };
}

export type NotesApi = ReturnType<typeof createNotesApi>;

// Notes whose file was modified since `since`, newest first, with the full
// count. A plain function: it needs no embedder, so the briefing can use it.
export async function notesChangedSince(
  db: Db,
  since: Date,
  limit: number,
): Promise<{ total: number; notes: NoteSummary[] }> {
  const { rows } = await db.query<NoteSummary & { total: number }>(
    `SELECT id, title, path, modified_at AS "modifiedAt",
            count(*) OVER ()::int AS total
     FROM notes WHERE modified_at >= $1 ORDER BY modified_at DESC LIMIT $2`,
    [since, limit],
  );
  // With no rows there is no count to read, and nothing to count.
  return {
    total: rows[0]?.total ?? 0,
    notes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      path: r.path,
      modifiedAt: r.modifiedAt,
    })),
  };
}

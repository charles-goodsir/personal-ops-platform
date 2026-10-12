import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import type { Db, Logger } from "@ops/core";
import type { Embedder } from "./embed.js";
import { CHUNKER_VERSION } from "./chunk.js";
import { parseNote, SUPPORTED } from "./extract.js";

export type IngestResult = "added" | "updated" | "unchanged" | "skipped";

// A note bigger than this is skipped: it would be read whole into memory, chunked
// and embedded, and nothing I write by hand is this large.
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// Inputs per Ollama request. Keeps one huge PDF from becoming one huge call.
const EMBED_BATCH = 32;

export function createIngester(deps: {
  db: Db;
  embed: Embedder;
  model: string;
  notesDir: string;
  logger: Logger;
}) {
  const { db, embed, model, notesDir, logger } = deps;

  // Indexes one file, given its path relative to notesDir.
  async function ingestFile(path: string): Promise<IngestResult> {
    const full = join(notesDir, path);
    // Only a plain file that really lives inside the notes folder. A link, a
    // pipe, a "../" path, or a link in a folder on the way out all stop here:
    // the real path has to stay under the real notes folder.
    const [root, real, info] = await Promise.all([
      realpath(notesDir),
      realpath(full),
      lstat(full),
    ]);
    const rel = relative(resolve(root), resolve(real));
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error("path is outside the notes folder");
    }
    if (!info.isFile()) return "skipped";
    if (info.size > MAX_FILE_BYTES) {
      logger.warn({ path, bytes: info.size }, "note too large, skipped");
      return "skipped";
    }
    const data = await readFile(full);
    // The chunker version is part of the hash, so a chunking change re-indexes.
    const hash = createHash("sha256")
      .update(`chunker:${CHUNKER_VERSION}\n`)
      .update(data)
      .digest("hex");

    // Unchanged content, embedded by the current model: nothing to do.
    const { rowCount } = await db.query(
      `SELECT 1 FROM notes n WHERE n.path = $1 AND n.content_hash = $2
         AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.note_id = n.id AND c.model <> $3)`,
      [path, hash, model],
    );
    if (rowCount) return "unchanged";

    const note = await parseNote(path, data);
    if (!note) return "skipped";

    // Embed before opening the transaction, so a slow model never holds locks.
    // The heading goes in with the text so a chunk keeps its context.
    const texts = note.chunks.map((c) =>
      c.heading ? `${c.heading}\n\n${c.content}` : c.content,
    );
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      vectors.push(
        ...(await embed(texts.slice(i, i + EMBED_BATCH), "document")),
      );
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string; inserted: boolean }>(
        `INSERT INTO notes (path, title, content, content_hash, modified_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (path) DO UPDATE SET title = EXCLUDED.title,
           content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
           modified_at = EXCLUDED.modified_at, indexed_at = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [path, note.title, note.content, hash, info.mtime],
      );
      const row = rows[0];
      if (!row) throw new Error(`upsert returned no row for ${path}`);
      const { id, inserted } = row;
      await client.query("DELETE FROM chunks WHERE note_id = $1", [id]);
      await client.query(
        `INSERT INTO chunks (note_id, ordinal, heading, content, embedding, model)
         SELECT $1, t.ordinal - 1, t.heading, t.content, t.embedding::vector, $2
         FROM unnest($3::text[], $4::text[], $5::text[])
           WITH ORDINALITY AS t(heading, content, embedding, ordinal)`,
        [
          id,
          model,
          note.chunks.map((c) => c.heading),
          note.chunks.map((c) => c.content),
          vectors.map((v) => `[${v.join(",")}]`),
        ],
      );
      await client.query("COMMIT");
      logger.info({ path, chunks: note.chunks.length }, "note indexed");
      return inserted ? "added" : "updated";
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async function removeFile(path: string): Promise<boolean> {
    const { rowCount } = await db.query("DELETE FROM notes WHERE path = $1", [
      path,
    ]);
    if (rowCount) logger.info({ path }, "note removed");
    return Boolean(rowCount);
  }

  // Brings the index in line with the folder: indexes new and changed files,
  // removes notes whose file is gone. One bad file doesn't stop the rest.
  async function scan() {
    const counts = {
      added: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      removed: 0,
      failed: 0,
    };
    const paths = await listFiles(notesDir);
    for (const path of paths) {
      try {
        counts[await ingestFile(path)]++;
      } catch (err) {
        counts.failed++;
        logger.error({ path, err }, "failed to index note");
      }
    }

    // An empty folder usually means a missing mount, not a deliberate wipe.
    if (paths.length === 0) {
      const { rows } = await db.query<{ n: string }>(
        "SELECT count(*) AS n FROM notes",
      );
      if (Number(rows[0]?.n) > 0) {
        logger.warn(
          { notesDir },
          "notes folder is empty, keeping existing index",
        );
        return counts;
      }
    }
    const { rowCount } = await db.query(
      "DELETE FROM notes WHERE path <> ALL($1::text[])",
      [paths],
    );
    counts.removed = rowCount ?? 0;
    logger.info(counts, "scan complete");
    return counts;
  }

  return { ingestFile, removeFile, scan };
}

export type Ingester = ReturnType<typeof createIngester>;

// Supported files under dir, as forward-slash paths relative to it. Skips
// hidden files and folders (.obsidian, .git, .trash).
export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED.has(extname(e.name).toLowerCase()))
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"))
    .filter((p) => !p.split("/").some((part) => part.startsWith(".")))
    .sort();
}

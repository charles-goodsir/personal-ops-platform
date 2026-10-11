export { createEmbedder, type Embedder } from "./embed.js";
export { createIngester, listFiles, type Ingester } from "./ingest.js";
export { createQueue, watchNotes } from "./watch.js";
export {
  createNotesApi,
  notesChangedSince,
  type Note,
  type NoteSummary,
  type NotesApi,
  type SearchHit,
} from "./notes.js";

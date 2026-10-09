-- Up Migration

-- One row per file in the notes folder. content is kept so get_note
-- returns exactly what was indexed, even if the file changes later.
CREATE TABLE notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL UNIQUE, -- relative to the notes folder
  title text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL, -- sha256, so unchanged files are skipped
  modified_at timestamptz NOT NULL, -- file mtime, for list_recent_notes
  indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_id bigint NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  ordinal int NOT NULL, -- position in the note
  heading text, -- nearest Markdown heading, for citations
  content text NOT NULL,
  -- 768 = nomic-embed-text. A model with a different size needs a new
  -- migration and a full re-index; model records which one made each row.
  embedding vector(768) NOT NULL,
  model text NOT NULL,
  UNIQUE (note_id, ordinal)
);

-- Cosine distance (<=>), matching how nomic-embed-text is meant to be compared.
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

-- Down Migration
DROP TABLE chunks;
DROP TABLE notes;

# 2. Embed notes locally with Ollama

Status: accepted

## Context

Searching notes by meaning needs an embedding for every chunk. Embedding sends the whole text of each note to the model. The project's rule is that data leaves the mini PC only when it has to, and notes are the most personal text I have.

## Decision

Run `nomic-embed-text` (768 dimensions) in an Ollama container on the Compose network. It has no published port, so only other containers can reach it.

- Stored text is prefixed `search_document: ` and questions `search_query: `, as the model expects. The embedder takes a `kind` argument so a caller cannot forget the prefix. Without it nothing errors and results quietly get worse.
- Every chunk row records the model that made it, and search only compares vectors from the current model.
- The vector column is `vector(768)`. A model with a different size needs a migration and a full re-index.

## Alternatives I did not take

- Hosted embeddings (Voyage, OpenAI). Better quality is likely, but every note would leave the house.
- A larger local model. I judged it would not fit comfortably beside Postgres and the other services in 8 GB, and did not try one.

## Consequences

- Note text never leaves the mini PC, and there is no embedding bill.
- It runs on CPU. The first index of 102 notes took about 25 minutes, and later scans skip unchanged files. Ollama sits at about 420 MiB under a 2 GiB cap.
- Retrieval quality is good enough for one person's notes and has not been compared with a hosted model.
- Changing the chunker also needs a re-index. A `CHUNKER_VERSION` is mixed into the file hash so the box re-indexes when chunking changes.

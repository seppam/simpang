-- Milestone 3: retrieval (RAG) with pgvector, in the same Postgres as everything else.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id           bigserial PRIMARY KEY,
  -- NULL = shared knowledge (e.g. the public portfolio); otherwise only that tenant can retrieve it.
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  collection   text NOT NULL,          -- e.g. "portfolio"
  source       text NOT NULL,          -- file or URL the chunk came from (used for citations)
  chunk_index  integer NOT NULL,
  content      text NOT NULL,
  embedding    vector(768) NOT NULL,   -- nomic-embed-text produces 768 dimensions
  embedder     text NOT NULL,          -- which model made the vector; vectors from different models must not be mixed
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection, source, chunk_index)
);

-- HNSW = approximate nearest-neighbour index: fast similarity search without scanning every row.
-- vector_cosine_ops matches the <=> (cosine distance) operator used by the retriever.
CREATE INDEX documents_embedding_hnsw ON documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX documents_collection ON documents (collection, tenant_id);

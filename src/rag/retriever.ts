import type pg from 'pg';
import type { Embedder } from './embedder.ts';

export type Passage = { source: string; content: string; score: number };

export interface Retriever {
  search(opts: { tenantId: string; collection: string; query: string; topK: number }): Promise<Passage[]>;
}

const toVector = (v: number[]) => `[${v.join(',')}]`;

export class PgRetriever implements Retriever {
  private pool: pg.Pool;
  private embedder: Embedder;

  constructor(pool: pg.Pool, embedder: Embedder) {
    this.pool = pool;
    this.embedder = embedder;
  }

  async search(opts: { tenantId: string; collection: string; query: string; topK: number }): Promise<Passage[]> {
    const [vector] = await this.embedder.embed([opts.query], 'query');
    // <=> is cosine distance (0 = same direction). score = 1 - distance, so higher is better.
    // Tenant isolation: shared rows (tenant_id NULL) or this tenant's own rows, never another tenant's.
    // Only vectors from the same embedder are comparable, so that is filtered too.
    const { rows } = await this.pool.query<{ source: string; content: string; score: number }>(
      `SELECT source, content, 1 - (embedding <=> $1::vector) AS score
       FROM documents
       WHERE collection = $2 AND embedder = $3 AND (tenant_id IS NULL OR tenant_id = $4)
       ORDER BY embedding <=> $1::vector
       LIMIT $5`,
      [toVector(vector), opts.collection, this.embedder.name, opts.tenantId, opts.topK],
    );
    return rows.map((r) => ({ ...r, score: Number(r.score) }));
  }
}

// Replaces all chunks of one source in one transaction, so a re-ingest never leaves a mix
// of old and new chunks behind.
export async function upsertSource(
  pool: pg.Pool,
  embedder: Embedder,
  doc: { collection: string; source: string; chunks: string[]; tenantId?: string | null },
): Promise<number> {
  const vectors = doc.chunks.length ? await embedder.embed(doc.chunks, 'document') : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM documents WHERE collection = $1 AND source = $2', [doc.collection, doc.source]);
    for (let i = 0; i < doc.chunks.length; i++) {
      await client.query(
        `INSERT INTO documents (tenant_id, collection, source, chunk_index, content, embedding, embedder)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7)`,
        [doc.tenantId ?? null, doc.collection, doc.source, i, doc.chunks[i], toVector(vectors[i]), embedder.name],
      );
    }
    await client.query('COMMIT');
    return doc.chunks.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { chunkMarkdown } from '../src/rag/chunk.ts';
import { HashEmbedder, OpenAICompatibleEmbedder } from '../src/rag/embedder.ts';
import { PgRetriever, upsertSource } from '../src/rag/retriever.ts';
import { migrate } from '../src/db/migrate.ts';
import { createTenantWithKey, PgKeyStore } from '../src/db/pgKeyStore.ts';

describe('chunkMarkdown', () => {
  it('keeps paragraphs whole, respects the size limit, and repeats the title in every chunk', () => {
    const md = `# Project: URSSET\n\n${'Kalimat pertama. '.repeat(30)}\n\n${'Kalimat kedua. '.repeat(30)}\n\nPenutup.`;
    const chunks = chunkMarkdown(md, 600);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.startsWith('Project: URSSET\n\n')).toBe(true);
      expect(c.length).toBeLessThanOrEqual(600 + 'Project: URSSET\n\n'.length);
    }
    expect(chunks.at(-1)).toContain('Penutup.');
  });
});

describe('OpenAICompatibleEmbedder', () => {
  it('adds nomic task prefixes and checks the vector size', async () => {
    let body: { input: string[] } | undefined;
    const fetchFn = (async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ data: [{ embedding: new Array(768).fill(0.1) }] }), { status: 200 });
    }) as typeof fetch;
    const e = new OpenAICompatibleEmbedder({ baseUrl: 'http://x/v1', model: 'nomic-embed-text', prefixes: true, fetchFn });
    await e.embed(['siapa septian?'], 'query');
    expect(body!.input).toEqual(['search_query: siapa septian?']);

    const wrong = (async () => new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 })) as typeof fetch;
    const bad = new OpenAICompatibleEmbedder({ baseUrl: 'http://x/v1', model: 'other', fetchFn: wrong });
    await expect(bad.embed(['x'], 'document')).rejects.toThrow(/768/);
  });
});

// Integration: real pgvector search, with the offline hash embedder.
const url = process.env.TEST_DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang_test';
const pool = new pg.Pool({ connectionString: url });

describe('PgRetriever (pgvector)', () => {
  beforeAll(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('finds the most similar chunk and never returns another tenant\'s private documents', async () => {
    const embedder = new HashEmbedder();
    const a = (await new PgKeyStore(pool).findActiveKey((await createTenantWithKey(pool, 'tenant-a')).hash))!;
    const b = (await new PgKeyStore(pool).findActiveKey((await createTenantWithKey(pool, 'tenant-b')).hash))!;

    await upsertSource(pool, embedder, { collection: 'kb', source: 'ursset.md', chunks: ['URSSET solidity foundry rental property onchain'] });
    await upsertSource(pool, embedder, { collection: 'kb', source: 'verihire.md', chunks: ['VeriHire express mongodb hiring platform team'] });
    await upsertSource(pool, embedder, { collection: 'kb', source: 'secret-b.md', chunks: ['tenant b private salary foundry notes'], tenantId: b.tenantId });

    const retriever = new PgRetriever(pool, embedder);
    const hits = await retriever.search({ tenantId: a.tenantId, collection: 'kb', query: 'foundry solidity', topK: 3 });

    expect(hits[0].source).toBe('ursset.md');
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(hits.map((h) => h.source)).not.toContain('secret-b.md'); // tenant isolation

    const forB = await retriever.search({ tenantId: b.tenantId, collection: 'kb', query: 'foundry', topK: 3 });
    expect(forB.map((h) => h.source)).toContain('secret-b.md');
  });

  it('re-ingesting a source replaces its chunks instead of duplicating them', async () => {
    const embedder = new HashEmbedder();
    await upsertSource(pool, embedder, { collection: 'kb2', source: 'x.md', chunks: ['satu', 'dua', 'tiga'] });
    await upsertSource(pool, embedder, { collection: 'kb2', source: 'x.md', chunks: ['satu saja'] });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM documents WHERE collection = 'kb2'");
    expect(rows[0].n).toBe(1);
  });
});

// Usage: npm run ingest -- <collection> <folder-of-markdown>
// e.g.   npm run ingest -- portfolio corpus/portfolio
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { chunkMarkdown } from './chunk.ts';
import { embedderFromEnv } from './embedder.ts';
import { upsertSource } from './retriever.ts';

const [collection, folder] = process.argv.slice(2);
if (!collection || !folder) {
  console.error('usage: npm run ingest -- <collection> <folder>');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang',
});
const embedder = embedderFromEnv();
const files = (await readdir(folder)).filter((f) => f.endsWith('.md')).sort();

let total = 0;
for (const file of files) {
  const chunks = chunkMarkdown(await readFile(join(folder, file), 'utf8'));
  total += await upsertSource(pool, embedder, { collection, source: file, chunks });
  console.log(`${file}: ${chunks.length} chunks`);
}
console.log(`ingested ${total} chunks from ${files.length} files into "${collection}" with ${embedder.name}`);
await pool.end();

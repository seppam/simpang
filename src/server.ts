import pg from 'pg';
import { buildApp } from './app.ts';
import { PgKeyStore } from './db/pgKeyStore.ts';
import { PgUsageSink } from './db/pgUsageSink.ts';
import { PgQuota } from './db/pgQuota.ts';
import { PgShadowSink } from './db/pgShadowSink.ts';
import { providersFromEnv } from './providers/registry.ts';
import { PgRetriever } from './rag/retriever.ts';
import { embedderFromEnv } from './rag/embedder.ts';

const port = Number(process.env.PORT ?? 3000);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang',
});
const providers = providersFromEnv();

const app = buildApp({
  keyStore: new PgKeyStore(pool),
  providers,
  usageSink: new PgUsageSink(pool),
  quota: new PgQuota(pool),
  retriever: new PgRetriever(pool, embedderFromEnv()),
  // Share of stable driver calls replayed on the canary version (0 = off).
  shadow: { sink: new PgShadowSink(pool), sampleRate: Number(process.env.SHADOW_SAMPLE_RATE ?? 0) },
  logger: true,
});

await app.listen({ port, host: '0.0.0.0' });
console.log(`simpang listening on http://localhost:${port} (providers: ${Object.keys(providers).join(', ')})`);

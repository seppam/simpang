import pg from 'pg';
import { buildApp } from './app.ts';
import { PgKeyStore } from './db/pgKeyStore.ts';

const port = Number(process.env.PORT ?? 3000);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang',
});
const app = buildApp({ keyStore: new PgKeyStore(pool) });

await app.listen({ port, host: '0.0.0.0' });
console.log(`simpang listening on http://localhost:${port}`);

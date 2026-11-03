import pg from 'pg';
import { createTenantWithKey } from './pgKeyStore.ts';

const tenant = process.argv[2];
if (!tenant) {
  console.error('usage: npm run create-key -- <tenant-name>');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang',
});
const { key } = await createTenantWithKey(pool, tenant);
await pool.end();

// Shown once only: the database keeps just the hash.
console.log(`tenant: ${tenant}\napi key (copy it now, it is not stored): ${key}`);

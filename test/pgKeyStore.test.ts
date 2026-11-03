import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { migrate } from '../src/db/migrate.ts';
import { PgKeyStore, createTenantWithKey } from '../src/db/pgKeyStore.ts';

// Integration test against simpang_test (npm run db:up). Wipes that database first.
const url = process.env.TEST_DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang_test';
const pool = new pg.Pool({ connectionString: url });

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('PgKeyStore', () => {
  it('finds an active key by hash and stores no raw key', async () => {
    const { key, hash } = await createTenantWithKey(pool, 'msp-ops');
    const store = new PgKeyStore(pool);

    const found = await store.findActiveKey(hash);
    expect(found?.tenantName).toBe('msp-ops');

    const { rows } = await pool.query('SELECT key_prefix, key_hash FROM api_keys');
    expect(JSON.stringify(rows)).not.toContain(key);
  });

  it('ignores a revoked key', async () => {
    const { hash } = await createTenantWithKey(pool, 'old-app');
    await pool.query('UPDATE api_keys SET revoked_at = now() WHERE key_hash = $1', [hash]);

    expect(await new PgKeyStore(pool).findActiveKey(hash)).toBeNull();
  });
});

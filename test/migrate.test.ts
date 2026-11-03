import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { migrate } from '../src/db/migrate.ts';

// Integration test: needs the Postgres from docker-compose.yml (npm run db:up).
// It wipes its database, so it uses simpang_test and never the dev database.
const url = process.env.TEST_DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang_test';
const pool = new pg.Pool({ connectionString: url });

beforeAll(async () => {
  // Start from an empty schema so the test proves migrate() builds everything itself.
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
});

afterAll(async () => {
  await pool.end();
});

describe('migrate()', () => {
  it('creates the core tables', async () => {
    await migrate(pool);

    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tables = rows.map((r) => r.table_name);

    expect(tables).toEqual(
      expect.arrayContaining(['tenants', 'api_keys', 'usage_events', 'schema_migrations']),
    );
  });

  it('is safe to run twice', async () => {
    await migrate(pool);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0].n).toBe(1);
  });

  it('keeps tenants isolated: an api key must belong to an existing tenant', async () => {
    await expect(
      pool.query(
        `INSERT INTO api_keys (tenant_id, key_prefix, key_hash)
         VALUES ('00000000-0000-0000-0000-000000000000', 'sk_test', 'x')`,
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

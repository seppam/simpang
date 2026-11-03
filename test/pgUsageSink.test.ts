import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { migrate } from '../src/db/migrate.ts';
import { createTenantWithKey, PgKeyStore } from '../src/db/pgKeyStore.ts';
import { PgUsageSink } from '../src/db/pgUsageSink.ts';

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

describe('PgUsageSink', () => {
  it('writes a usage event row that sums exactly', async () => {
    const { hash } = await createTenantWithKey(pool, 'msp-ops');
    const key = await new PgKeyStore(pool).findActiveKey(hash);
    const sink = new PgUsageSink(pool);
    const base = {
      tenantId: key!.tenantId,
      apiKeyId: key!.apiKeyId,
      provider: 'mock',
      model: 'echo',
      promptTokens: 2,
      completionTokens: 3,
      latencyMs: 12,
      status: 'ok' as const,
    };

    await sink.record({ ...base, costUsd: 0.1 });
    await sink.record({ ...base, costUsd: 0.2 });

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n, sum(cost_usd)::text AS total FROM usage_events WHERE tenant_id = $1',
      [key!.tenantId],
    );
    expect(rows[0]).toEqual({ n: 2, total: '0.300000' }); // numeric: exactly 0.3, not 0.30000000000000004
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { hashKey } from '../src/auth/keys.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { migrate } from '../src/db/migrate.ts';
import { createTenantWithKey, PgKeyStore } from '../src/db/pgKeyStore.ts';
import { PgUsageSink } from '../src/db/pgUsageSink.ts';
import { PgQuota } from '../src/db/pgQuota.ts';
import type { QuotaGuard } from '../src/metering/quota.ts';

describe('quota in the request path (unit)', () => {
  it('rejects an over-quota tenant with 429 before any provider is called', async () => {
    const provider = new MockProvider();
    const quota: QuotaGuard = { check: async () => ({ allowed: false, limit: 100, used: 120 }) };
    const app = buildApp({
      keyStore: { findActiveKey: async (h) => (h === hashKey('sk_q') ? { apiKeyId: 'k', tenantId: 't', tenantName: 'x' } : null) },
      providers: { mock: provider },
      quota,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk_q' },
      payload: { model: 'mock/echo', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('quota_exceeded');
    expect(provider.calls).toBe(0); // over-quota traffic costs us nothing
  });
});

// Integration: the real SQL that sums this month's tokens.
const url = process.env.TEST_DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang_test';
const pool = new pg.Pool({ connectionString: url });

describe('PgQuota (integration)', () => {
  beforeAll(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('allows unlimited tenants, then blocks once this month passes the limit', async () => {
    const { hash } = await createTenantWithKey(pool, 'quota-tenant');
    const key = (await new PgKeyStore(pool).findActiveKey(hash))!;
    const quota = new PgQuota(pool);
    const sink = new PgUsageSink(pool);
    const event = { tenantId: key.tenantId, apiKeyId: key.apiKeyId, provider: 'mock', model: 'echo', costUsd: 0, latencyMs: 1, status: 'ok' as const };

    expect(await quota.check(key.tenantId)).toEqual({ allowed: true }); // NULL limit = unlimited

    await pool.query('UPDATE tenants SET monthly_token_limit = 100 WHERE id = $1', [key.tenantId]);
    await sink.record({ ...event, promptTokens: 40, completionTokens: 20 });
    expect(await quota.check(key.tenantId)).toEqual({ allowed: true });

    await sink.record({ ...event, promptTokens: 30, completionTokens: 10 });
    expect(await quota.check(key.tenantId)).toEqual({ allowed: false, limit: 100, used: 100 });

    // Last month's usage does not count.
    await pool.query("UPDATE usage_events SET created_at = date_trunc('month', now()) - interval '1 day'");
    expect(await quota.check(key.tenantId)).toEqual({ allowed: true });
  });
});

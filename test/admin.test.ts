import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { signJwt, verifyJwt, type Claims } from '../src/auth/jwt.ts';
import { can } from '../src/auth/rbac.ts';
import { buildApp } from '../src/app.ts';
import type { AdminStore, Scope } from '../src/admin/store.ts';
import { PgAdminStore, createClient, hashSecret } from '../src/db/pgAdminStore.ts';
import { migrate } from '../src/db/migrate.ts';
import { PgUsageSink } from '../src/db/pgUsageSink.ts';

const SECRET = 'test-secret-of-at-least-32-characters!!';
const now = Math.floor(Date.now() / 1000);
const claims = (over: Partial<Claims> = {}): Claims => ({
  sub: 'cl_x', tid: 'tenant-a', role: 'viewer', iss: 'simpang', aud: 'simpang-admin', iat: now, exp: now + 60, ...over,
});

describe('JWT', () => {
  const expected = { iss: 'simpang', aud: 'simpang-admin' };

  it('round-trips a valid token', () => {
    expect(verifyJwt(signJwt(claims(), SECRET), SECRET, expected)?.sub).toBe('cl_x');
  });

  it('rejects a tampered payload (e.g. viewer -> admin)', () => {
    const [h, , s] = signJwt(claims(), SECRET).split('.');
    const forged = Buffer.from(JSON.stringify(claims({ role: 'admin' }))).toString('base64url');
    expect(verifyJwt(`${h}.${forged}.${s}`, SECRET, expected)).toBeNull();
  });

  it('rejects expired tokens, wrong audience, other secrets and alg=none', () => {
    expect(verifyJwt(signJwt(claims({ exp: now - 1 }), SECRET), SECRET, expected)).toBeNull();
    expect(verifyJwt(signJwt(claims({ aud: 'other' }), SECRET), SECRET, expected)).toBeNull();
    expect(verifyJwt(signJwt(claims(), 'another-secret'), SECRET, expected)).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims())).toString('base64url')}.`;
    expect(verifyJwt(none, SECRET, expected)).toBeNull();
  });
});

describe('RBAC', () => {
  it('grants least privilege per role', () => {
    expect(can('viewer', 'usage:read')).toBe(true);
    expect(can('viewer', 'keys:write')).toBe(false);
    expect(can('operator', 'keys:write')).toBe(true);
    expect(can('operator', 'platform:all-tenants')).toBe(false);
    expect(can('admin', 'tenants:write')).toBe(true);
  });
});

// In-memory AdminStore that records which scope each query used.
function fakeStore() {
  const scopes: Scope[] = [];
  const audits: string[] = [];
  const store: AdminStore = {
    findClient: async (id) =>
      id === 'cl_op' ? { id: '1', tenantId: 'tenant-a', clientId: 'cl_op', secretHash: hashSecret('cs_good'), role: 'operator', name: 'op', revoked: false } : null,
    usage: async (scope) => (scopes.push(scope), []),
    providerHealth: async () => [],
    tenants: async (scope) => (scopes.push(scope), []),
    setQuota: async () => true,
    keys: async (scope) => (scopes.push(scope), []),
    createKey: async (tenantId) => ({ id: `key-for-${tenantId}`, key: 'sk_new', prefix: 'sk_new' }),
    revokeKey: async (scope, id) => (scopes.push(scope), id === 'key-a' && (scope === null || scope === 'tenant-a')),
    shadow: async () => [],
    audit: async (e) => void audits.push(e.action),
  };
  return { store, scopes, audits };
}

function adminApp(store: AdminStore) {
  return buildApp({ keyStore: { findActiveKey: async () => null }, providers: {}, admin: { store, jwtSecret: SECRET } });
}
const bearer = (c: Partial<Claims>) => ({ authorization: `Bearer ${signJwt(claims(c), SECRET)}` });

describe('POST /oauth/token', () => {
  it('issues a short-lived token for valid client credentials (form-encoded, per RFC 6749)', async () => {
    const app = adminApp(fakeStore().store);
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=client_credentials&client_id=cl_op&client_secret=cs_good',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 900, role: 'operator' });
    expect(verifyJwt(body.access_token, SECRET, { iss: 'simpang', aud: 'simpang-admin' })).toMatchObject({ tid: 'tenant-a', role: 'operator' });
  });

  it('accepts HTTP Basic client authentication', async () => {
    const app = adminApp(fakeStore().store);
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { authorization: `Basic ${Buffer.from('cl_op:cs_good').toString('base64')}` },
      payload: { grant_type: 'client_credentials' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('answers invalid_client the same way for a wrong secret and an unknown client', async () => {
    const app = adminApp(fakeStore().store);
    for (const id of ['cl_op', 'cl_nobody']) {
      const res = await app.inject({ method: 'POST', url: '/oauth/token', payload: { grant_type: 'client_credentials', client_id: id, client_secret: 'wrong' } });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'invalid_client', error_description: 'Client authentication failed.' });
    }
  });

  it('rejects other grant types', async () => {
    const res = await adminApp(fakeStore().store).inject({ method: 'POST', url: '/oauth/token', payload: { grant_type: 'password' } });
    expect(res.json().error).toBe('unsupported_grant_type');
  });
});

describe('/admin API: authentication, RBAC and tenant isolation', () => {
  it('needs a valid bearer token', async () => {
    const res = await adminApp(fakeStore().store).inject({ method: 'GET', url: '/admin/me', headers: { authorization: 'Bearer sk_api_key_is_not_a_token' } });
    expect(res.statusCode).toBe(401);
  });

  it('lets a viewer read usage but not keys', async () => {
    const app = adminApp(fakeStore().store);
    expect((await app.inject({ method: 'GET', url: '/admin/usage', headers: bearer({ role: 'viewer' }) })).statusCode).toBe(200);
    const keys = await app.inject({ method: 'GET', url: '/admin/keys', headers: bearer({ role: 'viewer' }) });
    expect(keys.statusCode).toBe(403);
    expect(keys.json().error.message).toContain('keys:read');
  });

  it("pins an operator to their own tenant even when they ask for another one", async () => {
    const { store, scopes } = fakeStore();
    await adminApp(store).inject({ method: 'GET', url: '/admin/usage?tenant=tenant-b', headers: bearer({ role: 'operator', tid: 'tenant-a' }) });
    expect(scopes).toEqual(['tenant-a']);
  });

  it('lets an admin see all tenants or pick one', async () => {
    const { store, scopes } = fakeStore();
    const app = adminApp(store);
    await app.inject({ method: 'GET', url: '/admin/usage', headers: bearer({ role: 'admin' }) });
    await app.inject({ method: 'GET', url: '/admin/usage?tenant=tenant-b', headers: bearer({ role: 'admin' }) });
    expect(scopes).toEqual([null, 'tenant-b']);
  });

  it("returns 404 (not 403) for another tenant's key, and audits real changes", async () => {
    const { store, audits } = fakeStore();
    const app = adminApp(store);
    const other = await app.inject({ method: 'DELETE', url: '/admin/keys/key-a', headers: bearer({ role: 'operator', tid: 'tenant-b' }) });
    expect(other.statusCode).toBe(404);
    const own = await app.inject({ method: 'DELETE', url: '/admin/keys/key-a', headers: bearer({ role: 'operator', tid: 'tenant-a' }) });
    expect(own.statusCode).toBe(200);
    expect(audits).toEqual(['api_key.revoke']);
  });

  it('creates keys only in the caller tenant for non-admins', async () => {
    const res = await adminApp(fakeStore().store).inject({
      method: 'POST', url: '/admin/keys', headers: bearer({ role: 'operator', tid: 'tenant-a' }), payload: { tenantId: 'tenant-b' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe('key-for-tenant-a');
  });

  it('allows quota changes for admins only', async () => {
    const app = adminApp(fakeStore().store);
    const op = await app.inject({ method: 'PATCH', url: '/admin/tenants/t1/quota', headers: bearer({ role: 'operator' }), payload: { monthlyTokenLimit: 1000 } });
    expect(op.statusCode).toBe(403);
    const admin = await app.inject({ method: 'PATCH', url: '/admin/tenants/t1/quota', headers: bearer({ role: 'admin' }), payload: { monthlyTokenLimit: 1000 } });
    expect(admin.statusCode).toBe(200);
  });
});

// Integration: the real SQL, including scope enforcement in the UPDATE itself.
const url = process.env.TEST_DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang_test';
const pool = new pg.Pool({ connectionString: url });

describe('PgAdminStore (integration)', () => {
  beforeAll(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('creates clients with hashed secrets, aggregates usage per tenant, and scopes revocation', async () => {
    const store = new PgAdminStore(pool);
    const a = await createClient(pool, 'tenant-a', 'operator');
    const b = await createClient(pool, 'tenant-b', 'operator');

    const found = await store.findClient(a.clientId);
    expect(found).toMatchObject({ tenantId: a.tenantId, role: 'operator', revoked: false });
    expect(found!.secretHash).toBe(hashSecret(a.secret));
    expect(JSON.stringify(await pool.query('SELECT * FROM oauth_clients').then((r) => r.rows))).not.toContain(a.secret);

    const keyA = await store.createKey(a.tenantId);
    const sink = new PgUsageSink(pool);
    const ev = { apiKeyId: keyA.id, provider: 'groq', model: 'm', promptTokens: 10, completionTokens: 5, costUsd: 0.001, latencyMs: 100, status: 'ok' as const };
    await sink.record({ ...ev, tenantId: a.tenantId });
    await sink.record({ ...ev, tenantId: a.tenantId, status: 'error', promptTokens: 0, completionTokens: 0, costUsd: 0 });
    await sink.record({ ...ev, tenantId: b.tenantId });

    const usageA = await store.usage(a.tenantId, 7);
    expect(usageA).toEqual([{ day: expect.any(String), provider: 'groq', model: 'm', requests: 2, errors: 1, tokens: 15, costUsd: 0.001 }]);
    expect((await store.usage(null, 7))[0].requests).toBe(3);
    expect((await store.providerHealth(15))[0]).toMatchObject({ provider: 'groq', requests: 3, errors: 1, errorRate: 0.3333 });

    expect(await store.revokeKey(b.tenantId, keyA.id)).toBe(false); // other tenant: no effect
    expect(await store.revokeKey(a.tenantId, keyA.id)).toBe(true);
    expect(await store.revokeKey(a.tenantId, keyA.id)).toBe(false); // already revoked

    expect(await store.setQuota(a.tenantId, 500)).toBe(true);
    expect((await store.tenants(a.tenantId))[0]).toMatchObject({ name: 'tenant-a', monthlyTokenLimit: 500, usedThisMonth: 15 });
  });
});

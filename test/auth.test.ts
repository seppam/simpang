import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.ts';
import { generateApiKey, hashKey } from '../src/auth/keys.ts';
import type { KeyStore, ActiveKey } from '../src/auth/keyStore.ts';

// In-memory KeyStore: these tests check the auth logic only, so they need no database.
function memoryStore(entries: Record<string, ActiveKey>): KeyStore {
  return { findActiveKey: async (hash) => entries[hash] ?? null };
}

const { key: validKey } = generateApiKey();
const store = memoryStore({
  [hashKey(validKey)]: { apiKeyId: 'key-1', tenantId: 'tenant-1', tenantName: 'portfolio-chat' },
});

describe('generateApiKey()', () => {
  it('makes a random sk_ key whose hash is not the key itself', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(/^sk_[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.prefix).toBe(a.key.slice(0, 10));
    expect(a.hash).toBe(hashKey(a.key));
    expect(a.hash).not.toContain(a.key);
  });
});

describe('API key auth on /v1/*', () => {
  it('rejects a request without Authorization header', async () => {
    const app = buildApp({ keyStore: store });
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('missing_api_key');
  });

  it('rejects an unknown or revoked key', async () => {
    const app = buildApp({ keyStore: store });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer sk_not_a_real_key' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_api_key');
  });

  it('accepts a valid key and attaches the tenant to the request', async () => {
    const app = buildApp({ keyStore: store });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${validKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenant: 'portfolio-chat' });
  });

  it('keeps /health public', async () => {
    const app = buildApp({ keyStore: store });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

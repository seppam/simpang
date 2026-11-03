import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.ts';

const noKeys = { findActiveKey: async () => null };

describe('GET /health', () => {
  it('returns 200 and status ok', async () => {
    const app = buildApp({ keyStore: noKeys });

    // inject() sends a fake HTTP request straight into Fastify: no real port, no network.
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashKey } from '../src/auth/keys.ts';
import { MockProvider } from '../src/providers/mock.ts';
import type { KeyStore } from '../src/auth/keyStore.ts';
import type { UsageEvent, UsageSink } from '../src/metering/usageSink.ts';

const KEY = 'sk_test_metering';
const keyStore: KeyStore = {
  findActiveKey: async (hash) =>
    hash === hashKey(KEY) ? { apiKeyId: 'k1', tenantId: 't1', tenantName: 'msp-ops' } : null,
};

// Collects events in an array so the test can inspect exactly what would be billed.
function memorySink() {
  const events: UsageEvent[] = [];
  const sink: UsageSink = { record: async (e) => void events.push(e) };
  return { events, sink };
}

function call(app: ReturnType<typeof buildApp>, model: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${KEY}` },
    payload: { model, messages: [{ role: 'user', content: 'halo simpang' }] },
  });
}

describe('usage metering', () => {
  it('records one ok event per successful call, owned by the calling tenant', async () => {
    const { events, sink } = memorySink();
    const app = buildApp({ keyStore, providers: { mock: new MockProvider() }, usageSink: sink });

    await call(app, 'mock/echo');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId: 't1',
      apiKeyId: 'k1',
      provider: 'mock',
      model: 'echo',
      promptTokens: 2,
      completionTokens: 3,
      status: 'ok',
    });
    expect(events[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records failed provider calls too, with zero tokens', async () => {
    const { events, sink } = memorySink();
    const app = buildApp({ keyStore, providers: { mock: new MockProvider({ fail: true }) }, usageSink: sink });

    const res = await call(app, 'mock/echo');

    expect(res.statusCode).toBe(502);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'error', promptTokens: 0, completionTokens: 0 });
  });

  it('records nothing when no provider was called (unknown model)', async () => {
    const { events, sink } = memorySink();
    const app = buildApp({ keyStore, providers: { mock: new MockProvider() }, usageSink: sink });

    await call(app, 'nope/x');

    expect(events).toHaveLength(0);
  });

  it('still answers the user when the usage store is down', async () => {
    const brokenSink: UsageSink = { record: async () => { throw new Error('db down'); } };
    const app = buildApp({ keyStore, providers: { mock: new MockProvider() }, usageSink: brokenSink });

    const res = await call(app, 'mock/echo');

    expect(res.statusCode).toBe(200);
  });
});

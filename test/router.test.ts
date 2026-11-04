import { describe, it, expect } from 'vitest';
import { Router, GatewayError } from '../src/gateway/router.ts';
import { CircuitBreaker } from '../src/gateway/breaker.ts';
import { costUsd, type Catalog } from '../src/gateway/catalog.ts';
import { MockProvider } from '../src/providers/mock.ts';
import type { UsageEvent } from '../src/metering/usageSink.ts';
import type { Provider } from '../src/providers/types.ts';

const catalog: Catalog = {
  version: 'test-1',
  models: [
    { provider: 'a', model: 'm', inputUsdPerMTok: 1, outputUsdPerMTok: 2, contextWindow: 1000, priceSource: 'test' },
    { provider: 'b', model: 'm', inputUsdPerMTok: 0, outputUsdPerMTok: 0, contextWindow: 1000, priceSource: 'test' },
  ],
  routes: { fast: ['a/m', 'b/m', 'c/m'], missing: ['zzz/m'] },
};

const ctx = { tenantId: 't1', apiKeyId: 'k1' };
const input = (model: string) => ({ model, messages: [{ role: 'user' as const, content: 'halo simpang' }] });

function setup(providers: Record<string, Provider>, breaker?: CircuitBreaker) {
  const events: UsageEvent[] = [];
  const router = new Router({ providers, catalog, usageSink: { record: async (e) => void events.push(e) }, breaker });
  return { router, events };
}

describe('Router: resolve', () => {
  it('maps simpang/<route> to configured candidates only, in order', () => {
    const { router } = setup({ a: new MockProvider({ name: 'a' }), b: new MockProvider({ name: 'b' }) });
    expect(router.resolve('simpang/fast').candidates).toEqual([
      { provider: 'a', model: 'm' },
      { provider: 'b', model: 'm' },
    ]); // c is not configured, so it is left out
  });

  it('rejects unknown routes and unknown providers with 404', () => {
    const { router } = setup({ a: new MockProvider({ name: 'a' }) });
    expect(() => router.resolve('simpang/nope')).toThrowError(GatewayError);
    expect(() => router.resolve('x/m')).toThrowError(/Unknown model/);
  });

  it('says 503 when a route has no configured provider at all', () => {
    const { router } = setup({ a: new MockProvider({ name: 'a' }) });
    try {
      router.resolve('simpang/missing');
      expect.unreachable();
    } catch (err) {
      expect((err as GatewayError).status).toBe(503);
    }
  });
});

describe('Router: fallback', () => {
  it('falls back to the next candidate on a retryable error and meters both attempts', async () => {
    const a = new MockProvider({ name: 'a', fail: 'rate_limit' });
    const b = new MockProvider({ name: 'b' });
    const { router, events } = setup({ a, b });

    const { result, used, attempts } = await router.complete(ctx, input('simpang/fast'));

    expect(used.provider).toBe('b');
    expect(attempts).toBe(2);
    expect(result.content).toBe('echo: halo simpang');
    expect(events.map((e) => [e.provider, e.status, e.attempt, e.errorKind])).toEqual([
      ['a', 'error', 1, 'rate_limit'],
      ['b', 'ok', 2, undefined],
    ]);
    expect(events.every((e) => e.route === 'fast' && e.catalogVersion === 'test-1')).toBe(true);
  });

  it('also falls back when a route candidate is retired (404 at the vendor)', async () => {
    const { router } = setup({ a: new MockProvider({ name: 'a', fail: 'not_found' }), b: new MockProvider({ name: 'b' }) });
    const { used } = await router.complete(ctx, input('simpang/fast'));
    expect(used.provider).toBe('b');
  });

  it('does NOT fall back on a bad request: another provider would reject it too', async () => {
    const b = new MockProvider({ name: 'b' });
    const { router } = setup({ a: new MockProvider({ name: 'a', fail: 'bad_request' }), b });

    await expect(router.complete(ctx, input('simpang/fast'))).rejects.toMatchObject({ status: 400, code: 'upstream_rejected' });
    expect(b.calls).toBe(0);
  });

  it('turns a retired model asked for directly into 404 model_not_found (not 502)', async () => {
    const { router } = setup({ a: new MockProvider({ name: 'a', fail: 'not_found' }) });
    await expect(router.complete(ctx, input('a/m'))).rejects.toMatchObject({ status: 404, code: 'model_not_found' });
  });

  it('answers 429 when every candidate is rate limited, 502 for mixed failures', async () => {
    const limited = setup({ a: new MockProvider({ name: 'a', fail: 'rate_limit' }), b: new MockProvider({ name: 'b', fail: 'rate_limit' }) });
    await expect(limited.router.complete(ctx, input('simpang/fast'))).rejects.toMatchObject({ status: 429 });

    const mixed = setup({ a: new MockProvider({ name: 'a', fail: 'timeout' }), b: new MockProvider({ name: 'b', fail: 'server' }) });
    await expect(mixed.router.complete(ctx, input('simpang/fast'))).rejects.toMatchObject({ status: 502, code: 'upstream_failed' });
  });

  it('prices each attempt from the catalog', async () => {
    const { router, events } = setup({ a: new MockProvider({ name: 'a' }) });
    await router.complete(ctx, input('a/m'));
    // 2 prompt words * $1/M + 3 completion words * $2/M = $0.000008
    expect(events[0].costUsd).toBe(0.000008);
  });
});

describe('Router: circuit breaker', () => {
  it('skips a provider after 3 failures in a row, then retries it after the cool-down', async () => {
    let now = 0;
    const breaker = new CircuitBreaker({ threshold: 3, coolDownMs: 1000, now: () => now });
    const a = new MockProvider({ name: 'a', fail: 'server' });
    const b = new MockProvider({ name: 'b' });
    const { router } = setup({ a, b }, breaker);

    for (let i = 0; i < 3; i++) await router.complete(ctx, input('simpang/fast'));
    expect(a.calls).toBe(3);
    expect(breaker.isOpen('a')).toBe(true);

    await router.complete(ctx, input('simpang/fast'));
    expect(a.calls).toBe(3); // skipped: no time wasted on a provider we know is down

    now = 1500;
    await router.complete(ctx, input('simpang/fast'));
    expect(a.calls).toBe(4); // cool-down over: one probe request is let through
  });

  it('answers 503 when every candidate is circuit-open', async () => {
    const breaker = new CircuitBreaker({ threshold: 1 });
    const { router } = setup({ a: new MockProvider({ name: 'a', fail: 'server' }) }, breaker);
    await expect(router.complete(ctx, input('a/m'))).rejects.toMatchObject({ status: 502 });
    await expect(router.complete(ctx, input('a/m'))).rejects.toMatchObject({ status: 503, code: 'provider_unavailable' });
  });

  it('does not count bad requests against provider health', async () => {
    const breaker = new CircuitBreaker({ threshold: 1 });
    const { router } = setup({ a: new MockProvider({ name: 'a', fail: 'bad_request' }) }, breaker);
    await router.complete(ctx, input('a/m')).catch(() => {});
    expect(breaker.isOpen('a')).toBe(false);
  });
});

describe('Router: streaming fallback', () => {
  const collect = async (gen: AsyncIterable<unknown>) => {
    const out: unknown[] = [];
    for await (const e of gen) out.push(e);
    return out;
  };

  it('falls back before the first token', async () => {
    const { router } = setup({ a: new MockProvider({ name: 'a', fail: 'timeout' }), b: new MockProvider({ name: 'b' }) });
    const events = (await collect(router.stream(ctx, input('simpang/fast')))) as { type: string; used?: { provider: string } }[];
    expect(events[0]).toEqual({ type: 'start', used: { provider: 'b', model: 'm' } });
  });

  it('does not switch provider after tokens were already sent', async () => {
    const b = new MockProvider({ name: 'b' });
    const { router, events } = setup({ a: new MockProvider({ name: 'a', failAfterDeltas: 1 }), b });
    await expect(collect(router.stream(ctx, input('simpang/fast')))).rejects.toBeInstanceOf(GatewayError);
    expect(b.calls).toBe(0);
    // The words already streamed were generated: metered as estimated output.
    expect(events[0]).toMatchObject({ provider: 'a', status: 'error', estimated: true });
    expect(events[0].completionTokens).toBeGreaterThan(0);
  });
});

describe('costUsd', () => {
  it('is 0 for models missing from the catalog and rounds to 6 decimals', () => {
    expect(costUsd(undefined, 100, 100)).toBe(0);
    expect(costUsd(catalog.models[0], 1, 1)).toBe(0.000003);
  });
});

describe('Router: quota exhausted', () => {
  it('falls back past a provider whose daily quota is used up, and says so when all are', async () => {
    const ok = setup({ a: new MockProvider({ name: 'a', fail: 'quota_exhausted' }), b: new MockProvider({ name: 'b' }) });
    expect((await ok.router.complete(ctx, input('simpang/fast'))).used.provider).toBe('b');
    const none = setup({ a: new MockProvider({ name: 'a', fail: 'quota_exhausted' }) });
    await expect(none.router.complete(ctx, input('a/m'))).rejects.toMatchObject({ status: 429, code: 'upstream_quota_exhausted' });
  });
});

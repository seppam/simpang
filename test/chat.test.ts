import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashKey } from '../src/auth/keys.ts';
import { MockProvider } from '../src/providers/mock.ts';
import type { KeyStore } from '../src/auth/keyStore.ts';

const KEY = 'sk_test_chat';
const keyStore: KeyStore = {
  findActiveKey: async (hash) =>
    hash === hashKey(KEY) ? { apiKeyId: 'k1', tenantId: 't1', tenantName: 'portfolio-chat' } : null,
};

function appWith(providers = { mock: new MockProvider() }) {
  return buildApp({ keyStore, providers });
}

function chat(app: ReturnType<typeof appWith>, body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${KEY}` },
    payload: body as object,
  });
}

describe('POST /v1/chat/completions', () => {
  it('returns an OpenAI-shaped completion from the chosen provider', async () => {
    const res = await chat(appWith(), {
      model: 'mock/echo',
      messages: [{ role: 'user', content: 'halo simpang' }],
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.object).toBe('chat.completion');
    expect(body.model).toBe('mock/echo');
    expect(body.choices[0].message).toEqual({ role: 'assistant', content: 'echo: halo simpang' });
    expect(body.choices[0].finish_reason).toBe('stop');
    expect(body.usage).toEqual({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 });
  });

  it('rejects a body without messages (400)', async () => {
    const res = await chat(appWith(), { model: 'mock/echo' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.type).toBe('invalid_request_error');
  });

  it('rejects an unknown provider or model (404)', async () => {
    const res = await chat(appWith(), {
      model: 'nope/whatever',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('model_not_found');
  });

  it('streams OpenAI-style SSE chunks, then usage, then [DONE]', async () => {
    const res = await chat(appWith(), {
      model: 'mock/echo',
      messages: [{ role: 'user', content: 'halo simpang' }],
      stream: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const events = res.body.split('\n\n').filter(Boolean).map((e) => e.replace(/^data: /, ''));
    expect(events.at(-1)).toBe('[DONE]');
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
    const text = chunks.map((c) => c.choices[0]?.delta?.content ?? '').join('');
    expect(text).toBe('echo: halo simpang');
    expect(chunks.every((c) => c.object === 'chat.completion.chunk')).toBe(true);
    expect(chunks.at(-1).usage).toEqual({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 });
  });

  it('turns a provider failure into 502 without leaking provider internals', async () => {
    const res = await chat(appWith({ mock: new MockProvider({ fail: true }) }), {
      model: 'mock/echo',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toEqual({
      type: 'provider_error',
      code: 'upstream_failed',
      message: 'All 1 provider attempt(s) failed. Try again later.',
    });
  });
});

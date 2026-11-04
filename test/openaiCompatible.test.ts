import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.ts';

// A fake fetch: records what the provider sent and returns a canned vendor response.
// No network, no API key, no quota used.
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

const groqReply = {
  choices: [{ message: { role: 'assistant', content: 'Halo!' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
};

function groq(fetchFn: typeof fetch) {
  return new OpenAICompatibleProvider({
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: 'gsk_fake_for_tests',
    fetchFn,
  });
}

describe('OpenAICompatibleProvider', () => {
  it('sends an OpenAI-style request to the vendor with its own key', async () => {
    const { calls, fetchFn } = fakeFetch(200, groqReply);

    await groq(fetchFn).chat({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'halo' }],
      maxTokens: 50,
    });

    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer gsk_fake_for_tests');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'halo' }],
      max_tokens: 50,
    });
  });

  it('takes token counts from the vendor usage field, not from guessing', async () => {
    const { fetchFn } = fakeFetch(200, groqReply);

    const result = await groq(fetchFn).chat({ model: 'm', messages: [{ role: 'user', content: 'halo' }] });

    expect(result).toEqual({ content: 'Halo!', promptTokens: 11, completionTokens: 4 });
  });

  it('throws on a vendor error status, without putting the API key in the message', async () => {
    const { fetchFn } = fakeFetch(429, { error: { message: 'Rate limit reached' } });

    const err = await groq(fetchFn)
      .chat({ model: 'm', messages: [{ role: 'user', content: 'halo' }] })
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('429');
    expect((err as Error).message).not.toContain('gsk_fake_for_tests');
  });

  it('gives up after the timeout instead of hanging forever', async () => {
    const neverAnswers = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const provider = new OpenAICompatibleProvider({
      name: 'slow',
      baseUrl: 'http://example.test/v1',
      apiKey: 'x',
      fetchFn: neverAnswers,
      timeoutMs: 50,
    });

    await expect(provider.chat({ model: 'm', messages: [{ role: 'user', content: 'halo' }] })).rejects.toThrow(
      /timed out|timeout|aborted/i,
    );
  });
});

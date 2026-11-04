import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../src/providers/gemini.ts';
import { AnthropicProvider } from '../src/providers/anthropic.ts';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.ts';
import { ProviderError } from '../src/providers/errors.ts';
import { readSSE } from '../src/providers/sse.ts';
import type { StreamChunk } from '../src/providers/types.ts';

type Call = { url: string; init: RequestInit };

function fakeJson(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

// Serves an SSE body split into awkward network chunks, to prove the parser buffers lines.
function fakeSSE(text: string, chunkSize = 7) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

async function collect(gen: AsyncIterable<StreamChunk>) {
  let text = '';
  let usage;
  for await (const c of gen) {
    if (c.type === 'delta') text += c.text;
    else usage = c.usage;
  }
  return { text, usage };
}

const messages = [
  { role: 'system' as const, content: 'Jawab singkat.' },
  { role: 'user' as const, content: 'halo' },
  { role: 'assistant' as const, content: 'hai' },
  { role: 'user' as const, content: 'apa kabar?' },
];

describe('readSSE', () => {
  it('reassembles events split across chunks and keeps event names', async () => {
    const { fetchFn } = fakeSSE('event: a\ndata: {"x":1}\n\n: keep-alive\n\ndata: [DONE]\n\n', 3);
    const res = await fetchFn('http://x');
    const out = [];
    for await (const e of readSSE(res.body!)) out.push(e);
    expect(out).toEqual([{ event: 'a', data: '{"x":1}' }, { event: undefined, data: '[DONE]' }]);
  });
});

describe('OpenAICompatibleProvider streaming', () => {
  it('yields deltas and the vendor usage chunk', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Ha"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo!"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n';
    const { calls, fetchFn } = fakeSSE(sse);
    const p = new OpenAICompatibleProvider({ name: 'groq', baseUrl: 'https://x/v1', apiKey: 'k', fetchFn });

    const out = await collect(p.stream({ model: 'm', messages }));

    expect(out).toEqual({ text: 'Halo!', usage: { promptTokens: 9, completionTokens: 2 } });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('marks usage as estimated when the vendor sends none', async () => {
    const { fetchFn } = fakeSSE('data: {"choices":[{"delta":{"content":"abcdefgh"}}]}\n\ndata: [DONE]\n\n');
    const p = new OpenAICompatibleProvider({ name: 'ollama', baseUrl: 'http://x/v1', fetchFn });
    const out = await collect(p.stream({ model: 'm', messages }));
    expect(out.usage).toMatchObject({ completionTokens: 2, estimated: true });
  });

  it('classifies vendor errors', async () => {
    for (const [status, kind] of [[400, 'bad_request'], [401, 'auth'], [404, 'not_found'], [429, 'rate_limit'], [503, 'server']] as const) {
      const { fetchFn } = fakeJson(status, { error: { message: 'x' } });
      const p = new OpenAICompatibleProvider({ name: 'groq', baseUrl: 'https://x/v1', apiKey: 'secret', fetchFn });
      const err = await p.chat({ model: 'm', messages }).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe(kind);
      expect(err.message).not.toContain('secret');
    }
  });

  it('classifies a network failure and a caller abort', async () => {
    const broken = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const p = new OpenAICompatibleProvider({ name: 'groq', baseUrl: 'https://x/v1', fetchFn: broken });
    expect((await p.chat({ model: 'm', messages }).catch((e) => e)).kind).toBe('network');

    const caller = new AbortController();
    caller.abort();
    const err = await p.chat({ model: 'm', messages, signal: caller.signal }).catch((e) => e);
    expect(err.kind).toBe('aborted');
  });
});

describe('GeminiProvider', () => {
  it('translates roles, system prompt, key header and usage', async () => {
    const { calls, fetchFn } = fakeJson(200, {
      candidates: [{ content: { parts: [{ text: 'Baik, ' }, { text: 'terima kasih.' }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 },
    });
    const p = new GeminiProvider({ apiKey: 'g-key', fetchFn });

    const result = await p.chat({ model: 'gemini-2.5-flash', messages, temperature: 0, maxTokens: 64 });

    expect(result).toEqual({ content: 'Baik, terima kasih.', promptTokens: 12, completionTokens: 5 });
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(new Headers(calls[0].init.headers).get('x-goog-api-key')).toBe('g-key');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'halo' }] },
        { role: 'model', parts: [{ text: 'hai' }] },
        { role: 'user', parts: [{ text: 'apa kabar?' }] },
      ],
      systemInstruction: { parts: [{ text: 'Jawab singkat.' }] },
      generationConfig: { temperature: 0, maxOutputTokens: 64 },
    });
  });

  it('streams with alt=sse and takes the final usage totals', async () => {
    const sse =
      'data: {"candidates":[{"content":{"parts":[{"text":"Ba"}]}}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":1}}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"ik"}]}}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":2}}\n\n';
    const { calls, fetchFn } = fakeSSE(sse);
    const out = await collect(new GeminiProvider({ apiKey: 'g', fetchFn }).stream({ model: 'gemini-2.5-flash', messages }));
    expect(out).toEqual({ text: 'Baik', usage: { promptTokens: 12, completionTokens: 2 } });
    expect(calls[0].url).toContain(':streamGenerateContent?alt=sse');
  });
});

describe('AnthropicProvider', () => {
  it('sends system separately, requires max_tokens, and reads content blocks', async () => {
    const { calls, fetchFn } = fakeJson(200, {
      content: [{ type: 'text', text: 'Baik.' }],
      usage: { input_tokens: 20, output_tokens: 3 },
    });
    const p = new AnthropicProvider({ apiKey: 'a-key', fetchFn });

    const result = await p.chat({ model: 'claude-haiku-5-5', messages });

    expect(result).toEqual({ content: 'Baik.', promptTokens: 20, completionTokens: 3 });
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('x-api-key')).toBe('a-key');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('authorization')).toBeNull();
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.system).toBe('Jawab singkat.');
    expect(body.max_tokens).toBe(1024); // required by Anthropic, so we default it
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('streams named events and sums usage from message_start + message_delta', async () => {
    const sse =
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20}}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Ba"}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ik."}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    const { fetchFn } = fakeSSE(sse);
    const out = await collect(new AnthropicProvider({ apiKey: 'a', fetchFn }).stream({ model: 'claude-haiku-5-5', messages }));
    expect(out).toEqual({ text: 'Baik.', usage: { promptTokens: 20, completionTokens: 3 } });
  });
});

describe('OpenAICompatibleProvider native tool calling', () => {
  it('sends tools in OpenAI format and maps tool_calls and tool messages both ways', async () => {
    const { calls, fetchFn } = fakeJson(200, {
      choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_knowledge', arguments: '{"query":"URSSET"}' } }] } }],
      usage: { prompt_tokens: 30, completion_tokens: 8 },
    });
    const p = new OpenAICompatibleProvider({ name: 'groq', baseUrl: 'https://x/v1', apiKey: 'k', fetchFn });

    const result = await p.chat({
      model: 'm',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_0', name: 'current_date', arguments: {} }] },
        { role: 'tool', toolCallId: 'call_0', name: 'current_date', content: '2026-11-04' },
      ],
      tools: [{ name: 'search_knowledge', description: 'd', parameters: { type: 'object', properties: {} } }],
    });

    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'search_knowledge', arguments: { query: 'URSSET' } }]);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'search_knowledge', description: 'd', parameters: { type: 'object', properties: {} } } });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'current_date', arguments: '{}' } }] });
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_0', content: '2026-11-04' });
  });
});

describe('daily quota vs rate limit', () => {
  it('tells a per-day quota apart from a short rate limit by the 429 body', async () => {
    const day = fakeJson(429, { error: { message: 'Rate limit reached ... on tokens per day (TPD): Limit 200000, Used 199147' } });
    const minute = fakeJson(429, { error: { message: 'Rate limit reached ... on tokens per minute (TPM): Limit 8000' } });
    const p = (f: typeof fetch) => new OpenAICompatibleProvider({ name: 'groq', baseUrl: 'https://x/v1', fetchFn: f });
    expect((await p(day.fetchFn).chat({ model: 'm', messages }).catch((e) => e)).kind).toBe('quota_exhausted');
    expect((await p(minute.fetchFn).chat({ model: 'm', messages }).catch((e) => e)).kind).toBe('rate_limit');
  });
});

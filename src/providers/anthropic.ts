import { errorFromThrown } from './errors.ts';
import { postJson } from './http.ts';
import { readSSE } from './sse.ts';
import type { ChatRequest, ChatResult, Provider, StreamChunk } from './types.ts';

type Options = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

type AnthropicResponse = {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

type AnthropicEvent = {
  type: string;
  message?: { usage?: { input_tokens?: number } };
  delta?: { type?: string; text?: string };
  usage?: { output_tokens?: number };
};

// Native Anthropic Messages adapter. Differences from OpenAI that matter:
// - "system" is a top-level field, not a message
// - max_tokens is REQUIRED
// - the key goes in x-api-key, plus an anthropic-version header
// - the answer is a list of content blocks, and usage is input_tokens/output_tokens
// - streaming uses named events (message_start, content_block_delta, message_delta, ...)
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: Options) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private post(request: ChatRequest, stream: boolean, timeoutMs: number) {
    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    return postJson({
      provider: this.name,
      url: `${this.baseUrl}/messages`,
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model: request.model,
        max_tokens: request.maxTokens ?? 1024,
        ...(system ? { system } : {}),
        messages: request.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
        temperature: request.temperature,
        ...(stream ? { stream: true } : {}),
      },
      timeoutMs,
      signal: request.signal,
      fetchFn: this.fetchFn,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const res = await this.post(request, false, this.timeoutMs);
    const data = (await res.json()) as AnthropicResponse;
    return {
      content: (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    };
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const res = await this.post(request, true, this.timeoutMs * 4);
    let promptTokens = 0;
    let completionTokens = 0;
    try {
      for await (const { data } of readSSE(res.body!)) {
        const event = JSON.parse(data) as AnthropicEvent;
        if (event.type === 'message_start') promptTokens = event.message?.usage?.input_tokens ?? 0;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          yield { type: 'delta', text: event.delta.text };
        }
        if (event.type === 'message_delta') completionTokens = event.usage?.output_tokens ?? completionTokens;
      }
    } catch (err) {
      throw errorFromThrown(this.name, err, request.signal);
    }
    yield { type: 'usage', usage: { promptTokens, completionTokens } };
  }
}

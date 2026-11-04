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

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

// Native Gemini adapter. The contract differs from OpenAI in practice:
// - assistant role is called "model", and messages are "contents" made of "parts"
// - the system prompt is a separate "systemInstruction", not a message
// - the key goes in x-goog-api-key, and the model is part of the URL
// - token counts live in usageMetadata
export class GeminiProvider implements Provider {
  readonly name = 'gemini';
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: Options) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private post(request: ChatRequest, method: string, timeoutMs: number) {
    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    return postJson({
      provider: this.name,
      url: `${this.baseUrl}/models/${encodeURIComponent(request.model)}:${method}`,
      headers: { 'x-goog-api-key': this.apiKey },
      body: {
        contents: request.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxTokens },
      },
      timeoutMs,
      signal: request.signal,
      fetchFn: this.fetchFn,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const res = await this.post(request, 'generateContent', this.timeoutMs);
    const data = (await res.json()) as GeminiResponse;
    return {
      content: textOf(data),
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const res = await this.post(request, 'streamGenerateContent?alt=sse', this.timeoutMs * 4);
    let usage: GeminiResponse['usageMetadata'];
    try {
      for await (const { data } of readSSE(res.body!)) {
        const chunk = JSON.parse(data) as GeminiResponse;
        const piece = textOf(chunk);
        if (piece) yield { type: 'delta', text: piece };
        // Every chunk repeats the running totals; the last one is final.
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
      }
    } catch (err) {
      throw errorFromThrown(this.name, err, request.signal);
    }
    yield {
      type: 'usage',
      usage: { promptTokens: usage?.promptTokenCount ?? 0, completionTokens: usage?.candidatesTokenCount ?? 0 },
    };
  }
}

function textOf(data: GeminiResponse): string {
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

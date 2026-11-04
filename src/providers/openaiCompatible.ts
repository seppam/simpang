import { errorFromThrown } from './errors.ts';
import { postJson } from './http.ts';
import { readSSE } from './sse.ts';
import { estimateTokens, type ChatRequest, type ChatResult, type Provider, type StreamChunk } from './types.ts';

type Options = {
  name: string; // the prefix clients use in "model", e.g. "groq"
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  apiKey?: string; // optional: a local Ollama needs none
  timeoutMs?: number;
  fetchFn?: typeof fetch; // injectable so tests never touch the network
};

type VendorUsage = { prompt_tokens?: number; completion_tokens?: number };
type VendorResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: VendorUsage;
};
type VendorChunk = {
  choices?: { delta?: { content?: string | null } }[];
  usage?: VendorUsage | null;
};

// One adapter for every vendor that speaks the OpenAI chat API:
// Groq, OpenRouter, Hugging Face router, Ollama and vLLM differ only in baseUrl and key.
export class OpenAICompatibleProvider implements Provider {
  readonly name: string;
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: Options) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private post(request: ChatRequest, extra: Record<string, unknown>, timeoutMs: number) {
    return postJson({
      provider: this.name,
      url: `${this.baseUrl}/chat/completions`,
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      body: {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        ...extra,
      },
      timeoutMs,
      signal: request.signal,
      fetchFn: this.fetchFn,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const res = await this.post(request, {}, this.timeoutMs);
    const data = (await res.json()) as VendorResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    if (data.usage) {
      // The vendor's own counts are what the vendor bills us for.
      return { content, promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 };
    }
    return { content, ...estimate(request, content) };
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    // Streams get a longer budget: a long answer legitimately takes a while.
    const res = await this.post(request, { stream: true, stream_options: { include_usage: true } }, this.timeoutMs * 4);
    let text = '';
    let usageSent = false;
    try {
      for await (const { data } of readSSE(res.body!)) {
        if (data === '[DONE]') break;
        const chunk = JSON.parse(data) as VendorChunk;
        const piece = chunk.choices?.[0]?.delta?.content;
        if (piece) {
          text += piece;
          yield { type: 'delta', text: piece };
        }
        if (chunk.usage) {
          usageSent = true;
          yield {
            type: 'usage',
            usage: { promptTokens: chunk.usage.prompt_tokens ?? 0, completionTokens: chunk.usage.completion_tokens ?? 0 },
          };
        }
      }
    } catch (err) {
      throw errorFromThrown(this.name, err, request.signal);
    }
    // Some vendors ignore stream_options: fall back to an estimate, clearly marked.
    if (!usageSent) yield { type: 'usage', usage: estimate(request, text) };
  }
}

function estimate(request: ChatRequest, output: string) {
  return {
    promptTokens: estimateTokens(request.messages.map((m) => m.content).join('\n')),
    completionTokens: estimateTokens(output),
    estimated: true,
  };
}

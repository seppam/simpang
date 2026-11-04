import type { ChatRequest, ChatResult, Provider } from './types.ts';

type Options = {
  name: string; // the prefix clients use in "model", e.g. "groq"
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  apiKey: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch; // injectable so tests never touch the network
};

type VendorResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

// One adapter for every vendor that speaks the OpenAI chat API:
// Groq, OpenRouter, Ollama and vLLM differ only in baseUrl and key.
export class OpenAICompatibleProvider implements Provider {
  readonly name: string;
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: Options) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      }),
      // Without a timeout a stuck vendor would hold the connection (and the user) forever.
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      // Status and a short vendor message only: never echo our own headers or key.
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`${this.name} returned HTTP ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as VendorResponse;
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      // The vendor's own counts are what the vendor bills us for.
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}

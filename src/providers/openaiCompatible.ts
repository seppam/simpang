import { errorFromThrown } from './errors.ts';
import { postJson } from './http.ts';
import { readSSE } from './sse.ts';
import { estimateTokens, type ChatMessage, type ChatRequest, type ChatResult, type Provider, type StreamChunk, type ToolCall } from './types.ts';

type Options = {
  name: string; // the prefix clients use in "model", e.g. "groq"
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  apiKey?: string; // optional: a local Ollama needs none
  timeoutMs?: number;
  fetchFn?: typeof fetch; // injectable so tests never touch the network
};

type VendorUsage = { prompt_tokens?: number; completion_tokens?: number };
type VendorToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: string } };
type VendorResponse = {
  choices?: { message?: { content?: string | null; tool_calls?: VendorToolCall[] } }[];
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
  readonly supportsTools = true;
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
        messages: request.messages.map(toVendorMessage),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        ...(request.tools?.length
          ? { tools: request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
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
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? '';
    const toolCalls = message?.tool_calls?.length ? message.tool_calls.map(fromVendorToolCall) : undefined;
    const usage = data.usage
      ? // The vendor's own counts are what the vendor bills us for.
        { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 }
      : estimate(request, content);
    return { content, ...usage, ...(toolCalls ? { toolCalls } : {}) };
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

// Our message shape -> OpenAI wire format (tool calls carry their arguments as a JSON string).
function toVendorMessage(m: ChatMessage) {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })),
    };
  }
  return { role: m.role, content: m.content };
}

function fromVendorToolCall(c: VendorToolCall, i: number): ToolCall {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(c.function?.arguments || '{}');
  } catch {
    args = { _raw: c.function?.arguments }; // the tool will report bad arguments back to the model
  }
  return { id: c.id ?? `call_${i}`, name: c.function?.name ?? '', arguments: args };
}

function estimate(request: ChatRequest, output: string) {
  return {
    promptTokens: estimateTokens(request.messages.map((m) => m.content).join('\n')),
    completionTokens: estimateTokens(output),
    estimated: true,
  };
}

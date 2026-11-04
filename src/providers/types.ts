export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

// The gateway's own request/result shapes. Each provider adapter translates
// between these and its vendor's API, so the rest of Simpang never sees vendor differences.
export type ChatRequest = {
  model: string; // the provider's own model name, e.g. "openai/gpt-oss-20b"
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal; // aborted when the caller disconnects
};

export type Usage = {
  promptTokens: number;
  completionTokens: number;
  estimated?: boolean; // true when the vendor did not report usage and we counted ourselves
};

export type ChatResult = Usage & {
  content: string;
};

// A stream yields text pieces, then (at most) one usage report at the end.
export type StreamChunk = { type: 'delta'; text: string } | { type: 'usage'; usage: Usage };

export interface Provider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResult>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
}

// Rough fallback when a vendor sends no usage: ~4 characters per token. Marked as estimated.
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

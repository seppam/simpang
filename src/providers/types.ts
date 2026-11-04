export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

// A function the model may call (native function calling). parameters = JSON Schema.
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

// The gateway's own request/result shapes. Each provider adapter translates
// between these and its vendor's API, so the rest of Simpang never sees vendor differences.
export type ChatRequest = {
  model: string; // the provider's own model name, e.g. "openai/gpt-oss-20b"
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
  signal?: AbortSignal; // aborted when the caller disconnects
};

export type Usage = {
  promptTokens: number;
  completionTokens: number;
  estimated?: boolean; // true when the vendor did not report usage and we counted ourselves
};

export type ChatResult = Usage & {
  content: string;
  toolCalls?: ToolCall[]; // set when the model wants a tool run before it answers
};

// A stream yields text pieces, then (at most) one usage report at the end.
export type StreamChunk = { type: 'delta'; text: string } | { type: 'usage'; usage: Usage };

export interface Provider {
  readonly name: string;
  // Native function calling implemented in this adapter. The router skips providers
  // without it when a request carries tools.
  readonly supportsTools?: boolean;
  chat(request: ChatRequest): Promise<ChatResult>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
}

// Rough fallback when a vendor sends no usage: ~4 characters per token. Marked as estimated.
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

// The gateway's own request/result shapes. Each provider adapter translates
// between these and its vendor's API, so the rest of Simpang never sees vendor differences.
export type ChatRequest = {
  model: string; // the provider's own model name, e.g. "llama-3.1-8b-instant"
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type ChatResult = {
  content: string;
  promptTokens: number;
  completionTokens: number;
};

export interface Provider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResult>;
}

import type { ChatRequest, ChatResult, Provider } from './types.ts';

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

// A fake provider: free, offline and predictable. It echoes the last message back,
// and can be told to fail so tests can exercise error handling (and later, fallback).
export class MockProvider implements Provider {
  readonly name = 'mock';
  private fail: boolean;

  constructor(options: { fail?: boolean } = {}) {
    this.fail = options.fail ?? false;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    if (this.fail) throw new Error('mock provider was told to fail');

    const last = request.messages.at(-1)?.content ?? '';
    const content = `echo: ${last}`;
    // Word counts stand in for real token counts here.
    return {
      content,
      promptTokens: request.messages.reduce((n, m) => n + countWords(m.content), 0),
      completionTokens: countWords(content),
    };
  }
}

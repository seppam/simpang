import { ProviderError, type ProviderErrorKind } from './errors.ts';
import type { ChatRequest, ChatResult, Provider, StreamChunk } from './types.ts';

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

type Options = {
  name?: string;
  fail?: boolean | ProviderErrorKind; // true = 'server'
  failAfterDeltas?: number; // streaming: fail after this many pieces were sent
  reply?: string; // fixed answer instead of the echo
  delayMs?: number;
};

// A fake provider: free, offline and predictable. It echoes the last message back,
// and can be told to fail in a specific way so tests can exercise error handling and fallback.
export class MockProvider implements Provider {
  readonly name: string;
  calls = 0;
  private options: Options;

  constructor(options: Options = {}) {
    this.name = options.name ?? 'mock';
    this.options = options;
  }

  private answer(request: ChatRequest): ChatResult {
    this.calls++;
    const { fail } = this.options;
    if (fail) {
      const kind = fail === true ? 'server' : fail;
      throw new ProviderError(this.name, kind, `mock provider was told to fail (${kind})`);
    }
    const content = this.options.reply ?? `echo: ${request.messages.at(-1)?.content ?? ''}`;
    // Word counts stand in for real token counts here.
    return {
      content,
      promptTokens: request.messages.reduce((n, m) => n + countWords(m.content), 0),
      completionTokens: countWords(content),
    };
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    if (this.options.delayMs) await new Promise((r) => setTimeout(r, this.options.delayMs));
    return this.answer(request);
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const result = this.answer(request);
    const words = result.content.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (this.options.failAfterDeltas !== undefined && i === this.options.failAfterDeltas) {
        throw new ProviderError(this.name, 'server', 'mock stream broke mid-way');
      }
      yield { type: 'delta', text: i === 0 ? words[i] : ` ${words[i]}` };
    }
    yield { type: 'usage', usage: { promptTokens: result.promptTokens, completionTokens: result.completionTokens } };
  }
}

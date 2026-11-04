// Minimal Server-Sent Events reader for vendor streams (OpenAI, Gemini, Anthropic all use SSE).
// A stream is lines of "event: x" / "data: y", and a blank line ends one event.
export type SSEEvent = { event?: string; data: string };

export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  let data: string[] = [];

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    // Network chunks do not respect line boundaries: keep the unfinished last line for later.
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line === '') {
        if (data.length) yield { event, data: data.join('\n') };
        event = undefined;
        data = [];
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).trimStart());
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      }
      // Lines starting with ":" are comments/keep-alives and are ignored.
    }
  }
  if (data.length) yield { event, data: data.join('\n') };
}

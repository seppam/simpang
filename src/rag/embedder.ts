import { createHash } from 'node:crypto';
import { postJson } from '../providers/http.ts';

export const EMBEDDING_DIMENSIONS = 768;

export interface Embedder {
  readonly name: string; // stored with every vector, so vectors from different models never mix
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}

// Any OpenAI-compatible /embeddings endpoint: Ollama (nomic-embed-text), vLLM, OpenAI, ...
export class OpenAICompatibleEmbedder implements Embedder {
  readonly name: string;
  private options: { baseUrl: string; model: string; apiKey?: string; prefixes?: boolean; fetchFn?: typeof fetch };

  constructor(options: { baseUrl: string; model: string; apiKey?: string; prefixes?: boolean; fetchFn?: typeof fetch }) {
    this.options = options;
    this.name = options.model;
  }

  async embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
    // nomic-embed-text is trained with task prefixes; using them improves retrieval quality.
    const prefix = this.options.prefixes ? (kind === 'query' ? 'search_query: ' : 'search_document: ') : '';
    const res = await postJson({
      provider: 'embedder',
      url: `${this.options.baseUrl.replace(/\/$/, '')}/embeddings`,
      headers: this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {},
      body: { model: this.options.model, input: texts.map((t) => prefix + t) },
      timeoutMs: 120_000,
      fetchFn: this.options.fetchFn ?? fetch,
    });
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    const vectors = data.data.map((d) => d.embedding);
    if (vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error(`embedder ${this.name} returned ${vectors[0]?.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
    }
    return vectors;
  }
}

// Offline stand-in for tests and CI: hashes words into buckets ("feature hashing").
// Lexical, not semantic, but deterministic and free.
export class HashEmbedder implements Embedder {
  readonly name = 'hash-768';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        const h = createHash('md5').update(word).digest();
        v[h.readUInt16BE(0) % EMBEDDING_DIMENSIONS] += 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}

export function embedderFromEnv(env: NodeJS.ProcessEnv = process.env): Embedder {
  if (env.OLLAMA_BASE_URL) {
    return new OpenAICompatibleEmbedder({
      baseUrl: `${env.OLLAMA_BASE_URL.replace(/\/$/, '')}/v1`,
      model: env.EMBEDDING_MODEL ?? 'nomic-embed-text',
      prefixes: true,
    });
  }
  return new HashEmbedder();
}

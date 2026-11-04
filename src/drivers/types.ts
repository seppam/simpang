// An agent driver = model + instructions + retrieval + tools + validation, behind a versioned name.
// Definitions live in drivers/<name>/<version>.json and are reviewed like code.
export type DriverDefinition = {
  name: string;
  version: string; // "v1", "v2", ...
  description: string;
  model: string; // a concrete "provider/model" or a route "simpang/<route>"
  temperature?: number;
  maxTokens?: number;
  system: string;
  // Always retrieve before answering (classic RAG).
  retrieval?: { collection: string; topK: number };
  // Let the model decide when to call tools (agentic). Names from the tool registry.
  tools?: string[];
  toolCollection?: string; // knowledge base that the search_knowledge tool searches
  maxToolSteps?: number;
  output: { type: 'text'; citations?: boolean } | { type: 'json'; schema: Record<string, unknown> };
};

export type Channels = { stable: string; canary?: string };

export type DriverInput = string | Record<string, unknown>;

export type DriverRunResult = {
  driver: string; // "name@version"
  output: unknown; // string for text drivers, parsed object for json drivers
  citations: { n: number; source: string }[];
  steps: { type: 'retrieve' | 'tool' | 'model' | 'repair'; detail: string }[];
  usage: { promptTokens: number; completionTokens: number; costUsd: number };
  latencyMs: number;
  provider?: string;
  model?: string;
};

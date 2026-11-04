import type { Retriever } from '../rag/retriever.ts';

export type ToolContext = { tenantId: string; retriever?: Retriever; collection?: string };

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema of the arguments, sent to the model
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
};

// Tools a driver may expose to the model. Each is small, deterministic and safe:
// none of them can write data or reach arbitrary URLs (least privilege).
export const TOOLS: Record<string, Tool> = {
  search_knowledge: {
    name: 'search_knowledge',
    description: "Search the driver's knowledge base. Use it before answering factual questions.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look for, in the words of the question.' } },
      required: ['query'],
    },
    async run(args, ctx) {
      if (!ctx.retriever || !ctx.collection) return 'No knowledge base is configured.';
      const query = String(args.query ?? '').slice(0, 500);
      if (!query) return 'Error: "query" is required.';
      const passages = await ctx.retriever.search({ tenantId: ctx.tenantId, collection: ctx.collection, query, topK: 4 });
      if (!passages.length) return 'No results.';
      return passages.map((p) => `[source: ${p.source}]\n${p.content}`).join('\n\n---\n\n');
    },
  },
  current_date: {
    name: 'current_date',
    description: "Today's date (UTC), for questions like 'how long ago'.",
    parameters: { type: 'object', properties: {} },
    async run() {
      return new Date().toISOString().slice(0, 10);
    },
  },
};

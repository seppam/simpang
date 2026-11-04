import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Retriever } from '../rag/retriever.ts';

// Recent system changes (from the change-management log). A real deployment would read
// the tenant's change system; here it is a versioned file so evals stay reproducible.
type Change = { id: string; date: string; description: string; menus: string[] };
const CHANGE_LOG = join(import.meta.dirname, '../../corpus/changes/change-log.json');

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
  recent_changes: {
    name: 'recent_changes',
    description:
      'List recent system changes (deployments, configuration, data migrations) for an application, with dates and affected menus. Use it to check whether a problem started right after a change.',
    parameters: {
      type: 'object',
      properties: { app: { type: 'string', description: 'Application name, e.g. Accounting, Sales, Inventory.' } },
      required: ['app'],
    },
    async run(args) {
      const app = String(args.app ?? '').toLowerCase().trim();
      const changes = JSON.parse(readFileSync(CHANGE_LOG, 'utf8')) as Change[];
      const hits = changes.filter((c) => !app || c.menus.some((m) => m.toLowerCase().startsWith(app)));
      if (!hits.length) return `No recorded changes for "${args.app}".`;
      return hits.map((c) => `${c.id} on ${c.date}: ${c.description} (menus: ${c.menus.join('; ')})`).join('\n');
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

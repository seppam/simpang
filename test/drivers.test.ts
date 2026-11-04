import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/app.ts';
import { hashKey } from '../src/auth/keys.ts';
import { Router } from '../src/gateway/router.ts';
import type { Catalog } from '../src/gateway/catalog.ts';
import { DriverRegistry } from '../src/drivers/registry.ts';
import { DriverRuntime, parseJson } from '../src/drivers/runtime.ts';
import type { DriverDefinition } from '../src/drivers/types.ts';
import { ShadowRunner, compare, type ShadowRecord } from '../src/eval/shadow.ts';
import type { Retriever } from '../src/rag/retriever.ts';
import type { ChatRequest, ChatResult, Provider, StreamChunk } from '../src/providers/types.ts';
import type { UsageEvent } from '../src/metering/usageSink.ts';

// A scripted provider: returns the given answers in order and remembers what it was asked.
// An answer is either text, or { tool, args } to simulate a native tool call.
type Answer = string | { tool: string; args: Record<string, unknown> };
class Scripted implements Provider {
  readonly name = 'llm';
  readonly supportsTools = true;
  requests: ChatRequest[] = [];
  private answers: Answer[];
  constructor(answers: Answer[]) {
    this.answers = answers;
  }
  async chat(request: ChatRequest): Promise<ChatResult> {
    this.requests.push(structuredClone({ ...request, signal: undefined }));
    const a = this.answers.shift() ?? 'EMPTY';
    if (typeof a === 'string') return { content: a, promptTokens: 10, completionTokens: 5 };
    return { content: '', toolCalls: [{ id: `c${this.requests.length}`, name: a.tool, arguments: a.args }], promptTokens: 10, completionTokens: 5 };
  }
  async *stream(): AsyncGenerator<StreamChunk> {}
}

const catalog: Catalog = {
  version: 't',
  models: [{ provider: 'llm', model: 'm', inputUsdPerMTok: 1, outputUsdPerMTok: 1, contextWindow: 1000, priceSource: 't' }],
  routes: {},
};
const ctx = { tenantId: 't1', apiKeyId: 'k1' };

const retriever: Retriever = {
  search: async () => [
    { source: 'project-ursset.md', content: 'URSSET has 45 Foundry tests.', score: 0.9 },
    { source: 'timeline.md', content: 'Astra Graphia IT 2018-2021.', score: 0.8 },
  ],
};

function runtimeWith(provider: Provider, events: UsageEvent[] = []) {
  const router = new Router({ providers: { llm: provider }, catalog, usageSink: { record: async (e) => void events.push(e) } });
  return new DriverRuntime({ router, retriever });
}

const qa: DriverDefinition = {
  name: 'qa',
  version: 'v1',
  description: 'test',
  model: 'llm/m',
  system: 'Answer from context.',
  retrieval: { collection: 'portfolio', topK: 2 },
  output: { type: 'text', citations: true },
};

const triage: DriverDefinition = {
  name: 'triage',
  version: 'v1',
  description: 'test',
  model: 'llm/m',
  system: 'Classify.',
  output: {
    type: 'json',
    schema: {
      type: 'object',
      required: ['type', 'priority'],
      properties: { type: { enum: ['bug', 'data'] }, priority: { enum: ['P1', 'P2'] }, reason: { type: 'string' } },
    },
  },
};

describe('DriverRuntime', () => {
  it('retrieves first, numbers the passages, and maps [n] citations to sources', async () => {
    const llm = new Scripted(['URSSET has 45 tests [1].']);
    const events: UsageEvent[] = [];
    const result = await runtimeWith(llm, events).run(ctx, qa, 'berapa tes URSSET?');

    expect(llm.requests[0].messages[0].content).toContain('[1] (project-ursset.md)');
    expect(result.citations).toEqual([{ n: 1, source: 'project-ursset.md' }]);
    expect(result.driver).toBe('qa@v1');
    expect(result.steps.map((s) => s.type)).toEqual(['retrieve', 'model']);
    expect(events[0].driver).toBe('qa@v1'); // metered under the driver's name
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, costUsd: 0.000015 });
  });

  it('parses JSON (even inside a code fence) and validates it against the schema', async () => {
    const llm = new Scripted(['Berikut hasilnya:\n```json\n{"type":"bug","priority":"P1","reason":"x"}\n```']);
    const result = await runtimeWith(llm).run(ctx, triage, { subject: 'PPN salah', description: 'dobel' });
    expect(result.output).toEqual({ type: 'bug', priority: 'P1', reason: 'x' });
    expect(llm.requests[0].messages[1].content).toBe('subject: PPN salah\ndescription: dobel');
  });

  it('repairs an invalid answer once by showing the model what is wrong', async () => {
    const llm = new Scripted(['{"type":"crash","priority":"P1"}', '{"type":"bug","priority":"P1"}']);
    const result = await runtimeWith(llm).run(ctx, triage, 'x');
    expect(result.output).toEqual({ type: 'bug', priority: 'P1' });
    expect(result.steps.map((s) => s.type)).toEqual(['model', 'repair', 'model']);
    expect(llm.requests[1].messages.at(-1)!.content).toMatch(/invalid/);
    expect(result.usage.promptTokens).toBe(20); // both calls are paid for, and counted
  });

  it('fails with 422 when the repair is still invalid', async () => {
    const llm = new Scripted(['nope', 'still nope']);
    await expect(runtimeWith(llm).run(ctx, triage, 'x')).rejects.toMatchObject({ status: 422, code: 'invalid_output' });
  });

  it('runs a native tool loop: the model calls search, gets results, then answers', async () => {
    const agent: DriverDefinition = { ...qa, version: 'v2', retrieval: undefined, tools: ['search_knowledge'], toolCollection: 'portfolio', output: { type: 'text' } };
    const llm = new Scripted([{ tool: 'search_knowledge', args: { query: 'URSSET tests' } }, 'URSSET has 45 Foundry tests.']);
    const result = await runtimeWith(llm).run(ctx, agent, 'how many tests?');

    expect(result.output).toBe('URSSET has 45 Foundry tests.');
    expect(result.steps.map((s) => s.type)).toEqual(['model', 'tool', 'model']);
    expect(llm.requests[0].tools?.map((t) => t.name)).toEqual(['search_knowledge']); // specs sent natively
    const toolMsg = llm.requests[1].messages.at(-1)!;
    expect(toolMsg).toMatchObject({ role: 'tool', toolCallId: 'c1', name: 'search_knowledge' });
    expect(toolMsg.content).toContain('[source: project-ursset.md]');
  });

  it('refuses tools the driver did not declare', async () => {
    const agent: DriverDefinition = { ...qa, retrieval: undefined, tools: ['current_date'], output: { type: 'text' } };
    const llm = new Scripted([{ tool: 'search_knowledge', args: { query: 'x' } }, 'ok']);
    await runtimeWith(llm).run(ctx, agent, 'q');
    expect(llm.requests[1].messages.at(-1)!.content).toContain('unknown tool');
  });

  it('forces a final answer after the tool step budget', async () => {
    const agent: DriverDefinition = { ...qa, retrieval: undefined, tools: ['current_date'], maxToolSteps: 1, output: { type: 'text' } };
    const llm = new Scripted([{ tool: 'current_date', args: {} }, 'final']);
    const result = await runtimeWith(llm).run(ctx, agent, 'q');
    expect(result.output).toBe('final');
    expect(llm.requests[1].tools).toBeUndefined(); // last call has no tools: the model must answer
  });

  it('skips providers without tool support for tool-using drivers', async () => {
    const agent: DriverDefinition = { ...qa, retrieval: undefined, tools: ['current_date'], output: { type: 'text' } };
    const noTools: Provider = { name: 'llm', chat: async () => ({ content: 'x', promptTokens: 1, completionTokens: 1 }), stream: async function* () {} };
    await expect(runtimeWith(noTools).run(ctx, agent, 'q')).rejects.toMatchObject({ status: 400, code: 'tools_not_supported' });
  });
});

describe('parseJson', () => {
  it('finds the object inside surrounding prose', () => {
    expect(parseJson('ok {"a":1} done')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson('no json')).toEqual({ ok: false });
  });
});

function driversDir(defs: DriverDefinition[], channels: Record<string, object>) {
  const dir = mkdtempSync(join(tmpdir(), 'drivers-'));
  for (const d of defs) {
    mkdirSync(join(dir, d.name), { recursive: true });
    writeFileSync(join(dir, d.name, `${d.version}.json`), JSON.stringify(d));
  }
  for (const [name, c] of Object.entries(channels)) writeFileSync(join(dir, name, 'channels.json'), JSON.stringify(c));
  return dir;
}

describe('DriverRegistry', () => {
  it('resolves stable by default, canary and explicit versions on request', () => {
    const registry = new DriverRegistry(driversDir([triage, { ...triage, version: 'v2' }], { triage: { stable: 'v1', canary: 'v2' } }));
    expect(registry.get('triage')?.version).toBe('v1');
    expect(registry.get('triage', 'canary')?.version).toBe('v2');
    expect(registry.get('triage', 'v2')?.version).toBe('v2');
    expect(registry.get('triage', 'v9')).toBeUndefined();
  });

  it('loads the real driver files in this repo', () => {
    const registry = new DriverRegistry();
    expect(registry.list().map((d) => d.name).sort()).toEqual(['portfolio-qa', 'ticket-triage']);
  });
});

describe('shadow traffic', () => {
  it('compares categorical fields only, and leaves free text to humans', () => {
    expect(compare(triage, { type: 'bug', priority: 'P1', reason: 'a' }, { type: 'bug', priority: 'P1', reason: 'b' })).toBe(true);
    expect(compare(triage, { type: 'bug', priority: 'P1' }, { type: 'data', priority: 'P1' })).toBe(false);
    expect(compare(qa, 'a', 'b')).toBeNull();
  });

  it('replays a sampled stable call on the canary and records both, without touching the response', async () => {
    const registry = new DriverRegistry(driversDir([triage, { ...triage, version: 'v2' }], { triage: { stable: 'v1', canary: 'v2' } }));
    const records: ShadowRecord[] = [];
    const llm = new Scripted(['{"type":"bug","priority":"P1"}', '{"type":"data","priority":"P1"}']);
    const app = buildApp({
      keyStore: { findActiveKey: async (h) => (h === hashKey('sk_s') ? { apiKeyId: 'k', tenantId: 't', tenantName: 'x' } : null) },
      providers: { llm },
      catalog,
      drivers: registry,
      shadow: { sink: { record: async (r) => void records.push(r) }, sampleRate: 1 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/drivers/triage/invoke',
      headers: { authorization: 'Bearer sk_s' },
      payload: { input: 'PPN salah' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().output).toEqual({ type: 'bug', priority: 'P1' }); // the user gets stable only
    expect(res.headers['x-simpang-driver']).toBe('triage@v1');

    await Promise.all(app.shadow!.pending);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ stableVersion: 'v1', canaryVersion: 'v2', agree: false, canaryOutput: { type: 'data', priority: 'P1' } });
  });

  it('does not shadow when the caller pinned a version', async () => {
    const registry = new DriverRegistry(driversDir([triage, { ...triage, version: 'v2' }], { triage: { stable: 'v1', canary: 'v2' } }));
    const records: ShadowRecord[] = [];
    const llm = new Scripted(['{"type":"bug","priority":"P1"}']);
    const runtime = new DriverRuntime({ router: new Router({ providers: { llm }, catalog, usageSink: { record: async () => {} } }) });
    const shadow = new ShadowRunner({ registry, runtime, sink: { record: async (r) => void records.push(r) }, sampleRate: 0 });
    shadow.maybeRun(ctx, 'triage', 'x', { driver: 'triage@v1', output: {}, citations: [], steps: [], usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 }, latencyMs: 1 });
    expect(shadow.pending.size).toBe(0); // sampleRate 0 = off
  });
});

describe('driver routes', () => {
  it('lists drivers and 404s an unknown one', async () => {
    const app = buildApp({
      keyStore: { findActiveKey: async () => ({ apiKeyId: 'k', tenantId: 't', tenantName: 'x' }) },
      providers: {},
    });
    const list = await app.inject({ method: 'GET', url: '/v1/drivers', headers: { authorization: 'Bearer a' } });
    expect(list.json().data.find((d: { name: string }) => d.name === 'ticket-triage').channels).toEqual({ stable: 'v2' });
    const missing = await app.inject({ method: 'POST', url: '/v1/drivers/nope/invoke', headers: { authorization: 'Bearer a' }, payload: { input: 'x' } });
    expect(missing.statusCode).toBe(404);
  });
});

describe('recent_changes tool', () => {
  it('lists the changes that touched an app, with dates', async () => {
    const { TOOLS } = await import('../src/drivers/tools.ts');
    const out = await TOOLS.recent_changes.run({ app: 'Accounting' }, { tenantId: 't' });
    expect(out).toContain('CHG-01 on 2026-10-05');
    expect(out).toContain('CHG-04'); // touches Accounting > Customers too
    expect(out).not.toContain('CHG-02'); // Inventory only
    expect(await TOOLS.recent_changes.run({ app: 'Payroll' }, { tenantId: 't' })).toMatch(/No recorded changes/);
  });
});

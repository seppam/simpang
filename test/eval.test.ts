import { describe, it, expect } from 'vitest';
import { gradeQa, gradeTriage } from '../src/eval/graders.ts';
import { aggregate, runEval, type EvalReport, type RowResult } from '../src/eval/runner.ts';
import { checkGate } from '../src/eval/gate.ts';
import { DriverRuntime } from '../src/drivers/runtime.ts';
import { Router, GatewayError } from '../src/gateway/router.ts';
import type { DriverDefinition } from '../src/drivers/types.ts';
import type { ChatResult, Provider } from '../src/providers/types.ts';

describe('graders', () => {
  it('triage: success needs type AND priority; missing_info is scored as a set', () => {
    const g = gradeTriage({ type: 'bug', priority: 'P1', missing_info: ['contoh_record'] }, { type: 'bug', priority: 'P1', missing_info: ['contoh_record', 'pesan_error'] });
    expect(g.success).toBe(true);
    expect(g.counts).toEqual({ tp: 1, fp: 1, fn: 0 });
    expect(gradeTriage({ type: 'bug', priority: 'P1', missing_info: [] }, { type: 'data', priority: 'P1', missing_info: [] }).success).toBe(false);
  });

  it('qa: every fact group must appear (any synonym), and refusals must decline', () => {
    expect(gradeQa({ facts: [['express', 'node'], ['mongo']], refuse: false }, 'Node.js + Express on MongoDB [1]', 1).success).toBe(true);
    expect(gradeQa({ facts: [['express'], ['mongo']], refuse: false }, 'Express only', 1).success).toBe(false);
    expect(gradeQa({ facts: [], refuse: true }, "Maaf, saya tidak tahu gaji yang diminta.", 0).success).toBe(true);
    expect(gradeQa({ facts: [], refuse: true }, 'He asks for 10 million.', 0).success).toBe(false);
    expect(gradeQa({ facts: [], refuse: true, forbidden: ['10 years'] }, 'Sorry, but yes: 10 years of Kubernetes.', 0).success).toBe(false);
  });
});

const row = (over: Partial<RowResult>): RowResult => ({
  id: 'x', run: 1, output: null, error: null, grade: { success: true, checks: { type: true } }, latencyMs: 100, costUsd: 0.001, tokens: 10, ...over,
});

describe('aggregate', () => {
  it('computes rates, percentiles and cost per COMPLETED task', () => {
    const m = aggregate([
      row({ latencyMs: 100 }),
      row({ latencyMs: 300, grade: { success: false, checks: { type: false } } }),
      row({ error: 'invalid_output', grade: { success: false, checks: {} }, costUsd: 0.002 }),
    ]);
    expect(m.task_success_rate).toBe(0.3333);
    expect(m.invalid_output_rate).toBe(0.3333);
    expect(m.type_rate).toBe(0.3333);
    expect(m.latency_p50_ms).toBe(200); // errors excluded from latency
    expect(m.total_cost_usd).toBe(0.004);
    expect(m.cost_per_success_usd).toBe(0.004); // all spend divided by the ONE success
  });
});

describe('runEval', () => {
  const def: DriverDefinition = {
    name: 'ticket-triage', version: 'v1', description: '', model: 'llm/m', system: 's',
    output: { type: 'json', schema: { type: 'object', required: ['type'] } },
  };

  it('retries rate limits with backoff instead of scoring them as model failures', async () => {
    const flaky: Provider = {
      name: 'llm',
      async chat(): Promise<ChatResult> {
        return { content: '{"type":"bug","priority":"P1","missing_info":[]}', promptTokens: 1, completionTokens: 1 };
      },
      stream: async function* () {},
    };
    // A runtime whose first call fails with a 429 GatewayError, then succeeds.
    const runtime = new DriverRuntime({ router: new Router({ providers: { llm: flaky }, catalog: { version: 't', models: [], routes: {} }, usageSink: { record: async () => {} } }) });
    const original = runtime.run.bind(runtime);
    let first = true;
    runtime.run = async (...args) => {
      if (first) {
        first = false;
        throw new GatewayError(429, 'rate_limit_error', 'upstream_rate_limited', 'slow down');
      }
      return original(...args);
    };
    const waits: number[] = [];
    const { rows } = await runEval({
      runtime, def, concurrency: 1, sleep: async (ms) => void waits.push(ms),
      rows: [{ id: 'T1', input: 'x', expected: { type: 'bug', priority: 'P1', missing_info: [] } }],
    });
    expect(waits).toEqual([5000]);
    expect(rows[0]).toMatchObject({ error: null, grade: { success: true } });
  });
});

const report = (metrics: Record<string, number>): EvalReport => ({
  driver: 'd', version: 'v', driverHash: '', dataset: '', datasetHash: '', createdAt: '', repeat: 1, metrics, rows: [],
});

describe('regression gate', () => {
  const rules = { task_success_rate: { maxDrop: 0.05 }, invalid_output_rate: { max: 0.05 }, cost_per_success_usd: { maxRatio: 2 } };

  it('passes a candidate within tolerance', () => {
    const checks = checkGate(rules, report({ task_success_rate: 0.8, invalid_output_rate: 0, cost_per_success_usd: 0.001 }), report({ task_success_rate: 0.77, invalid_output_rate: 0.03, cost_per_success_usd: 0.0015 }));
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it('blocks a candidate that is less accurate, breaks the schema more often, or costs too much per task', () => {
    const checks = checkGate(rules, report({ task_success_rate: 0.8, invalid_output_rate: 0, cost_per_success_usd: 0.001 }), report({ task_success_rate: 0.7, invalid_output_rate: 0.1, cost_per_success_usd: 0.003 }));
    expect(checks.filter((c) => !c.pass).map((c) => c.metric)).toEqual(['task_success_rate', 'invalid_output_rate', 'cost_per_success_usd']);
  });

  it('fails when a gated metric is missing', () => {
    expect(checkGate({ x_rate: { min: 0.5 } }, report({}), report({}))[0].pass).toBe(false);
  });
});

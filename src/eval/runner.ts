import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DriverRuntime } from '../drivers/runtime.ts';
import type { DriverDefinition, DriverInput } from '../drivers/types.ts';
import { GatewayError } from '../gateway/router.ts';
import { gradeQa, gradeTriage, type Grade, type QaExpected, type TriageExpected } from './graders.ts';

export type Row = { id: string; input: DriverInput; expected: unknown; note?: string };

export type RowResult = {
  id: string;
  run: number; // 1..repeat
  output: unknown;
  error: string | null; // e.g. invalid_output (schema still wrong after repair), upstream_failed
  grade: Grade;
  latencyMs: number;
  costUsd: number;
  tokens: number;
  provider?: string;
};

export type EvalReport = {
  driver: string;
  version: string;
  driverHash: string; // sha256 of the driver definition file: a prompt change invalidates the result
  dataset: string;
  datasetHash: string;
  createdAt: string;
  gitSha?: string;
  repeat: number;
  metrics: Record<string, number>;
  rows: RowResult[];
};

export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(`Eval aborted, provider quota exhausted: ${message} Results were not written.`);
  }
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export function loadDataset(path: string): Row[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row);
}

export function grade(driver: string, expected: unknown, output: unknown, citations: number): Grade {
  if (driver === 'ticket-triage') return gradeTriage(expected as TriageExpected, output);
  if (driver === 'portfolio-qa') return gradeQa(expected as QaExpected, output, citations);
  throw new Error(`no grader for driver ${driver}`);
}

// Runs every row through the driver (via the real router, so the same code path as production),
// with limited concurrency and backoff on rate limits, and aggregates the metrics.
export async function runEval(opts: {
  runtime: DriverRuntime;
  def: DriverDefinition;
  rows: Row[];
  repeat?: number;
  concurrency?: number;
  paceMs?: number; // fixed pause after each row: keeps a free tier's tokens-per-minute limit from being hit at all
  sleep?: (ms: number) => Promise<void>;
  onRow?: (r: RowResult) => void;
}): Promise<{ metrics: Record<string, number>; rows: RowResult[] }> {
  const repeat = opts.repeat ?? 1;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const jobs = Array.from({ length: repeat }, (_, i) => opts.rows.map((row) => ({ row, run: i + 1 }))).flat();
  const results: RowResult[] = [];
  // Evals run as a fixed "nil" tenant: it sees shared knowledge only, never a customer's documents.
  const ctx = { tenantId: '00000000-0000-0000-0000-000000000000', apiKeyId: '00000000-0000-0000-0000-000000000000' };

  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const started = performance.now();
      let result: RowResult | undefined;
      for (let attempt = 0; attempt < 6 && !result; attempt++) {
        try {
          const r = await opts.runtime.run(ctx, opts.def, job.row.input);
          result = {
            id: job.row.id,
            run: job.run,
            output: r.output,
            error: null,
            grade: grade(opts.def.name, job.row.expected, r.output, r.citations.length),
            latencyMs: r.latencyMs,
            costUsd: r.usage.costUsd,
            tokens: r.usage.promptTokens + r.usage.completionTokens,
            provider: r.provider,
          };
        } catch (err) {
          const e = err as GatewayError;
          // A daily quota will not come back within this run: stop now instead of grinding through
          // retries and scoring every remaining row as a failure.
          if (e instanceof GatewayError && e.code === 'upstream_quota_exhausted') throw new QuotaExhaustedError(e.message);
          // Free tiers rate-limit (Groq: 8k tokens/minute): wait and retry instead of scoring
          // a rate limit (429) or a temporarily unavailable provider (503) as a model failure.
          if (e instanceof GatewayError && (e.status === 429 || e.status === 503) && attempt < 5) {
            await sleep(5000 * 2 ** attempt);
            continue;
          }
          result = {
            id: job.row.id,
            run: job.run,
            output: null,
            error: e instanceof GatewayError ? e.code : String(e),
            grade: { success: false, checks: {} },
            latencyMs: Math.round(performance.now() - started),
            costUsd: 0,
            tokens: 0,
          };
        }
      }
      results.push(result!);
      opts.onRow?.(result!);
      if (opts.paceMs && jobs.length) await sleep(opts.paceMs);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 2 }, worker));
  results.sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run);
  return { metrics: aggregate(results), rows: results };
}

export function aggregate(rows: RowResult[]): Record<string, number> {
  const n = rows.length || 1;
  const rate = (f: (r: RowResult) => boolean) => round(rows.filter(f).length / n);
  const checkNames = [...new Set(rows.flatMap((r) => Object.keys(r.grade.checks)))];
  const metrics: Record<string, number> = {
    n: rows.length,
    task_success_rate: rate((r) => r.grade.success),
    error_rate: rate((r) => r.error !== null),
    invalid_output_rate: rate((r) => r.error === 'invalid_output'),
  };
  for (const c of checkNames) metrics[`${c}_rate`] = rate((r) => r.grade.checks[c] === true);

  const counts = rows.map((r) => r.grade.counts).filter(Boolean) as { tp: number; fp: number; fn: number }[];
  if (counts.length) {
    const tp = counts.reduce((s, c) => s + c.tp, 0);
    const fp = counts.reduce((s, c) => s + c.fp, 0);
    const fn = counts.reduce((s, c) => s + c.fn, 0);
    const precision = tp + fp ? tp / (tp + fp) : 1;
    const recall = tp + fn ? tp / (tp + fn) : 1;
    metrics.missing_info_f1 = round(precision + recall ? (2 * precision * recall) / (precision + recall) : 0);
  }

  const ok = rows.filter((r) => r.error === null);
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  metrics.latency_p50_ms = percentile(latencies, 0.5);
  metrics.latency_p95_ms = percentile(latencies, 0.95);
  const cost = rows.reduce((s, r) => s + r.costUsd, 0);
  const successes = rows.filter((r) => r.grade.success).length;
  metrics.total_cost_usd = round(cost, 6);
  // The number the job ad asks for: cost per COMPLETED task, not per token.
  metrics.cost_per_success_usd = successes ? round(cost / successes, 6) : -1;
  metrics.mean_tokens = Math.round(rows.reduce((s, r) => s + r.tokens, 0) / n);
  return metrics;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

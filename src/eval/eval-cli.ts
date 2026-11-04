// Usage: npm run eval -- <driver> [--versions v1,v2] [--repeat 2] [--concurrency 2]
// Runs the driver's dataset through each version with the real providers from .env,
// writes eval/results/<driver>@<version>.json and a human-review file for the failures.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DriverRegistry } from '../drivers/registry.ts';
import { DriverRuntime } from '../drivers/runtime.ts';
import { Router } from '../gateway/router.ts';
import { CircuitBreaker } from '../gateway/breaker.ts';
import { loadCatalog } from '../gateway/catalog.ts';
import { providersFromEnv } from '../providers/registry.ts';
import { embedderFromEnv } from '../rag/embedder.ts';
import { PgRetriever } from '../rag/retriever.ts';
import pg from 'pg';
import { loadDataset, runEval, sha256, type EvalReport } from './runner.ts';

const ROOT = join(import.meta.dirname, '../..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { versions: { type: 'string' }, repeat: { type: 'string', default: '1' }, concurrency: { type: 'string', default: '2' } },
});
const name = positionals[0];
if (!name) {
  console.error('usage: npm run eval -- <driver> [--versions v1,v2] [--repeat N]');
  process.exit(1);
}

const registry = new DriverRegistry();
const channels = registry.channelsOf(name);
if (!channels) throw new Error(`unknown driver ${name}`);
const versions = values.versions?.split(',') ?? [channels.stable, channels.canary].filter((v): v is string => !!v);
const datasetPath = join(ROOT, 'eval/datasets', `${name}.jsonl`);
const rows = loadDataset(datasetPath);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang' });
// Evals measure the model, not routing: a breaker that never opens, so a rate-limit burst
// is retried by the runner instead of short-circuiting every following row.
const router = new Router({
  providers: providersFromEnv(),
  catalog: loadCatalog(),
  usageSink: { record: async () => {} },
  breaker: new CircuitBreaker({ threshold: Number.MAX_SAFE_INTEGER }),
});
const runtime = new DriverRuntime({ router, retriever: new PgRetriever(pool, embedderFromEnv()) });
const gitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    return undefined;
  }
})();

mkdirSync(join(ROOT, 'eval/results'), { recursive: true });
mkdirSync(join(ROOT, 'eval/review'), { recursive: true });
const reports: EvalReport[] = [];

for (const version of versions) {
  const def = registry.get(name, version);
  if (!def) throw new Error(`unknown version ${name}@${version}`);
  process.stderr.write(`${name}@${version}: `);
  const { metrics, rows: results } = await runEval({
    runtime,
    def,
    rows,
    repeat: Number(values.repeat),
    concurrency: Number(values.concurrency),
    onRow: (r) => process.stderr.write(r.error ? 'E' : r.grade.success ? '.' : 'x'),
  });
  process.stderr.write('\n');

  const report: EvalReport = {
    driver: name,
    version,
    driverHash: sha256(readFileSync(join(ROOT, 'drivers', name, `${version}.json`), 'utf8')),
    dataset: `eval/datasets/${name}.jsonl`,
    datasetHash: sha256(readFileSync(datasetPath, 'utf8')),
    createdAt: new Date().toISOString(),
    gitSha,
    repeat: Number(values.repeat),
    metrics,
    rows: results,
  };
  reports.push(report);
  writeFileSync(join(ROOT, 'eval/results', `${name}@${version}.json`), JSON.stringify(report, null, 2) + '\n');

  // Failures go to a Markdown file a person can read and label: error analysis and human review.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const failures = results.filter((r) => !r.grade.success);
  const review = [
    `# Review: ${name}@${version} (${failures.length} of ${results.length} not successful)`,
    '',
    'Mark each case: model wrong / label wrong / ambiguous. Label mistakes go back into the dataset.',
    '',
    ...failures.map((f) => {
      const row = byId.get(f.id)!;
      const failed = Object.entries(f.grade.checks).filter(([, ok]) => !ok).map(([k]) => k).join(', ');
      return [
        `## ${f.id}${f.run > 1 ? ` (run ${f.run})` : ''}: ${f.error ?? `failed ${failed}`}`,
        '',
        '**Input**', '```', typeof row.input === 'string' ? row.input : JSON.stringify(row.input, null, 2), '```',
        `**Expected**: \`${JSON.stringify(row.expected)}\``,
        '',
        `**Output**: ${typeof f.output === 'string' ? f.output : '`' + JSON.stringify(f.output) + '`'}`,
        row.note ? `\n**Labeler note**: ${row.note}` : '',
        '',
        '- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous',
        '',
      ].join('\n');
    }),
  ].join('\n');
  writeFileSync(join(ROOT, 'eval/review', `${name}@${version}.md`), review);
}
await pool.end();

// Side-by-side summary.
const keys = [...new Set(reports.flatMap((r) => Object.keys(r.metrics)))];
console.log(['metric', ...reports.map((r) => `${r.driver}@${r.version}`)].join('\t'));
for (const k of keys) console.log([k, ...reports.map((r) => String(r.metrics[k] ?? ''))].join('\t'));

// Usage: npm run eval:regrade -- <results.json>... [--dry-run]
// Re-scores stored eval outputs with the current graders, without calling any model. Use it after
// fixing a grader, so old and new runs are judged by the same rules. --dry-run prints the metrics only.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadDataset, regradeReport, type EvalReport } from './runner.ts';
import { reviewMarkdown } from './review.ts';

const ROOT = join(import.meta.dirname, '../..');
const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'dry-run': { type: 'boolean', default: false } } });
if (!positionals.length) {
  console.error('usage: npm run eval:regrade -- <results.json>... [--dry-run]');
  process.exit(1);
}

for (const path of positionals) {
  const before = JSON.parse(readFileSync(path, 'utf8')) as EvalReport;
  const dataset = loadDataset(join(ROOT, before.dataset));
  const after = regradeReport(before, dataset);
  console.log(`${before.driver}@${before.version} (${path})`);
  for (const k of Object.keys(after.metrics)) {
    const a = before.metrics[k];
    const b = after.metrics[k];
    console.log(`  ${k.padEnd(22)} ${String(a ?? '-').padStart(9)} -> ${b}${a !== b ? '   *' : ''}`);
  }
  if (values['dry-run']) continue;
  writeFileSync(path, JSON.stringify(after, null, 2) + '\n');
  // The review file sits next to results/ as review/<driver>@<version>.md.
  const reviewPath = join(dirname(dirname(path)), 'review', basename(path).replace(/\.json$/, '.md'));
  writeFileSync(reviewPath, reviewMarkdown(before.driver, before.version, dataset, after.rows));
}

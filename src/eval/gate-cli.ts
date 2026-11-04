// Regression gate, run in CI: npm run eval:gate
// For every driver in eval/gates.json:
//  1. the committed results must be FRESH: their driverHash and datasetHash match the files in this
//     commit (changing a prompt without re-running the eval fails the build);
//  2. the canary must not be worse than the stable baseline beyond the allowed tolerance.
// It reads committed results, so CI needs no provider keys and costs nothing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DriverRegistry } from '../drivers/registry.ts';
import { checkGate, type GateConfig } from './gate.ts';
import { sha256, type EvalReport } from './runner.ts';

const ROOT = join(import.meta.dirname, '../..');
const config = JSON.parse(readFileSync(join(ROOT, 'eval/gates.json'), 'utf8')) as GateConfig;
const registry = new DriverRegistry();
let failed = false;

function load(driver: string, version: string): EvalReport | null {
  const path = join(ROOT, 'eval/results', `${driver}@${version}.json`);
  if (!existsSync(path)) {
    console.log(`  FAIL  no eval result for ${driver}@${version}: run \`npm run eval -- ${driver} --versions ${version}\``);
    failed = true;
    return null;
  }
  const report = JSON.parse(readFileSync(path, 'utf8')) as EvalReport;
  const driverHash = sha256(readFileSync(join(ROOT, 'drivers', driver, `${version}.json`), 'utf8'));
  const datasetHash = sha256(readFileSync(join(ROOT, report.dataset), 'utf8'));
  if (report.driverHash !== driverHash || report.datasetHash !== datasetHash) {
    const what = report.driverHash !== driverHash ? 'driver definition' : 'dataset';
    console.log(`  FAIL  ${driver}@${version}: result is stale (${what} changed since the eval). Re-run the eval.`);
    failed = true;
    return null;
  }
  return report;
}

for (const [driver, rules] of Object.entries(config)) {
  const channels = registry.channelsOf(driver);
  if (!channels) throw new Error(`gate config names unknown driver ${driver}`);
  const candidateVersion = channels.canary ?? channels.stable;
  console.log(`${driver}: baseline ${channels.stable}, candidate ${candidateVersion}`);
  const baseline = load(driver, channels.stable);
  const candidate = candidateVersion === channels.stable ? baseline : load(driver, candidateVersion);
  if (!baseline || !candidate) continue;

  for (const c of checkGate(rules, baseline, candidate)) {
    if (!c.pass) failed = true;
    const base = c.baseline !== undefined ? ` (baseline ${c.baseline})` : '';
    console.log(`  ${c.pass ? 'ok  ' : 'FAIL'}  ${c.metric} = ${c.candidate} ${c.rule}${base}`);
  }
}

if (failed) {
  console.log('\nRegression gate FAILED');
  process.exit(1);
}
console.log('\nRegression gate passed');

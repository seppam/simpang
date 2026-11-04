import type { EvalReport } from './runner.ts';

// A threshold on one metric. "min"/"max" are absolute; "maxDrop" compares the candidate with the
// baseline (stable version): e.g. maxDrop 0.05 = candidate may be at most 5 points worse.
export type MetricRule = { min?: number; max?: number; maxDrop?: number; maxRatio?: number };
export type GateConfig = Record<string, Record<string, MetricRule>>; // driver -> metric -> rule

export type GateCheck = { metric: string; rule: string; baseline?: number; candidate: number; pass: boolean };

export function checkGate(rules: Record<string, MetricRule>, baseline: EvalReport, candidate: EvalReport): GateCheck[] {
  const checks: GateCheck[] = [];
  for (const [metric, rule] of Object.entries(rules)) {
    const b = baseline.metrics[metric];
    const c = candidate.metrics[metric];
    if (c === undefined) {
      checks.push({ metric, rule: 'present', candidate: NaN, pass: false });
      continue;
    }
    if (rule.min !== undefined) checks.push({ metric, rule: `>= ${rule.min}`, candidate: c, pass: c >= rule.min });
    if (rule.max !== undefined) checks.push({ metric, rule: `<= ${rule.max}`, candidate: c, pass: c <= rule.max });
    if (rule.maxDrop !== undefined && b !== undefined) {
      checks.push({ metric, rule: `drop <= ${rule.maxDrop}`, baseline: b, candidate: c, pass: c >= b - rule.maxDrop });
    }
    // For costs and latencies: candidate may be at most maxRatio times the baseline.
    if (rule.maxRatio !== undefined && b !== undefined && b > 0) {
      checks.push({ metric, rule: `<= ${rule.maxRatio}x baseline`, baseline: b, candidate: c, pass: c >= 0 && c <= b * rule.maxRatio });
    }
  }
  return checks;
}

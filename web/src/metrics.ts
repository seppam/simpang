// Which driver version is better on an offline metric. The direction comes from the metric
// name, following the eval conventions: rates and F1 scores are higher-is-better, while
// latency, cost, errors and invalid outputs are lower-is-better.

export type Direction = 'higher' | 'lower';

// Checked first, so "error_rate" is lower-is-better even though it ends in "_rate".
const LOWER_IS_BETTER = /latency|cost|error|invalid/i;
const HIGHER_IS_BETTER = /(^f1$|_f1$|_rate$)/i;

export function metricDirection(metric: string): Direction | null {
  if (LOWER_IS_BETTER.test(metric)) return 'lower';
  if (HIGHER_IS_BETTER.test(metric)) return 'higher';
  return null;
}

// The version holding the best value of `metric`, or null when no single version is better:
// the direction is unknown, fewer than two versions have a value, or the best value is tied.
export function bestVersion(metric: string, values: Record<string, number | null | undefined>): string | null {
  const direction = metricDirection(metric);
  if (!direction) return null;

  const scored = Object.entries(values).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]));
  if (scored.length < 2) return null;

  const sign = direction === 'higher' ? 1 : -1;
  scored.sort((a, b) => sign * (b[1] - a[1]));
  const [topVersion, topValue] = scored[0];
  const [, runnerUpValue] = scored[1];
  return topValue === runnerUpValue ? null : topVersion;
}

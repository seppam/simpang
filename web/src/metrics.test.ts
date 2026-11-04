import { describe, expect, it } from 'vitest';
import { bestVersion, metricDirection } from './metrics';

describe('metricDirection', () => {
  it('treats rates and F1 scores as higher-is-better', () => {
    expect(metricDirection('accuracy_rate')).toBe('higher');
    expect(metricDirection('answer_f1')).toBe('higher');
    expect(metricDirection('f1')).toBe('higher');
  });

  it('treats latency, cost, error and invalid metrics as lower-is-better', () => {
    expect(metricDirection('p95_latency_ms')).toBe('lower');
    expect(metricDirection('cost_usd')).toBe('lower');
    expect(metricDirection('error_rate')).toBe('lower');
    expect(metricDirection('invalid_rate')).toBe('lower');
  });

  it('returns null for metrics with no known direction', () => {
    expect(metricDirection('rougeL')).toBeNull();
  });
});

describe('bestVersion', () => {
  it('picks the higher value for a rate', () => {
    expect(bestVersion('agree_rate', { v1: 0.82, v2: 0.91 })).toBe('v2');
  });

  it('picks the lower value for latency', () => {
    expect(bestVersion('p95_latency_ms', { v1: 900, v2: 640 })).toBe('v2');
  });

  it('returns null when the direction is unknown', () => {
    expect(bestVersion('rougeL', { v1: 0.4, v2: 0.6 })).toBeNull();
  });

  it('returns null on a tie', () => {
    expect(bestVersion('accuracy_rate', { v1: 0.9, v2: 0.9 })).toBeNull();
  });

  it('ignores missing versions and needs two values to compare', () => {
    expect(bestVersion('accuracy_rate', { v1: 0.9, v2: null })).toBeNull();
    expect(bestVersion('accuracy_rate', { v1: 0.5, v2: undefined, v3: 0.7 })).toBe('v3');
  });
});

import { describe, expect, it } from 'vitest';
import { formatInt, formatMetric, formatMs, formatPercent, formatUsd, parseQuotaInput, ratio, shortSha } from './format';

describe('number formatting', () => {
  it('groups integers and renders missing values as a dash', () => {
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(0)).toBe('0');
    expect(formatInt(null)).toBe('—');
    expect(formatInt(Number.NaN)).toBe('—');
  });

  it('shows cost in USD with exactly six decimals', () => {
    expect(formatUsd(0.0000125)).toBe('$0.000013');
    expect(formatUsd(1234.5)).toBe('$1,234.500000');
    expect(formatUsd(0)).toBe('$0.000000');
    expect(formatUsd(undefined)).toBe('—');
  });

  it('formats a fraction as a percentage with one decimal', () => {
    expect(formatPercent(0.1234)).toBe('12.3%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(null)).toBe('—');
  });

  it('formats milliseconds and metrics', () => {
    expect(formatMs(1523.4)).toBe('1,523 ms');
    expect(formatMs(null)).toBe('—');
    expect(formatMetric(0.912345)).toBe('0.9123');
    expect(formatMetric(42)).toBe('42');
  });

  it('shortens a git sha to seven characters', () => {
    expect(shortSha('a5edfa6c0ffee')).toBe('a5edfa6');
    expect(shortSha(undefined)).toBe('—');
  });

  it('returns null for a ratio with no traffic instead of zero', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 12)).toBe(0.25);
  });
});

describe('parseQuotaInput', () => {
  it('reads whole numbers, empty as unlimited, and rejects everything else', () => {
    expect(parseQuotaInput('1000000')).toBe(1000000);
    expect(parseQuotaInput('  250 ')).toBe(250);
    expect(parseQuotaInput('')).toBeNull();
    expect(parseQuotaInput('   ')).toBeNull();
    expect(parseQuotaInput('1.5')).toBe('invalid');
    expect(parseQuotaInput('-3')).toBe('invalid');
    expect(parseQuotaInput('12k')).toBe('invalid');
  });
});

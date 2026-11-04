// Number and date formatting for the console. Missing values render as an em dash so that
// a gap in the data never looks like a zero.

const DASH = '—';

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const intFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usdFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const metricFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

export function formatInt(value: number | null | undefined): string {
  return finite(value) ? intFormat.format(Math.round(value)) : DASH;
}

// Cost is shown with six decimals: per-request costs are often far below a cent.
export function formatUsd(value: number | null | undefined): string {
  return finite(value) ? `$${usdFormat.format(value)}` : DASH;
}

// Input is a fraction (0..1), output is a percentage with one decimal.
export function formatPercent(fraction: number | null | undefined): string {
  return finite(fraction) ? `${(fraction * 100).toFixed(1)}%` : DASH;
}

export function formatMs(value: number | null | undefined): string {
  return finite(value) ? `${intFormat.format(Math.round(value))} ms` : DASH;
}

// Offline evaluation metrics: integers as-is, fractions to four decimals.
export function formatMetric(value: number | null | undefined): string {
  return finite(value) ? metricFormat.format(value) : DASH;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : DASH;
}

// Parses the quota editor input. Empty means unlimited (null). Anything that is not a
// non-negative whole number is 'invalid', so the UI can ask again instead of saving it.
export function parseQuotaInput(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : 'invalid';
}

// Share of `part` in `whole`, as a fraction. Zero traffic gives null, not 0.
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

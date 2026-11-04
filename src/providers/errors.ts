// Every provider failure is turned into one of these kinds, so the router can decide
// "try another provider" or "stop, the request itself is wrong" without vendor-specific code.
export type ProviderErrorKind =
  | 'bad_request' // 400/413/422: the request is wrong; another provider will fail the same way
  | 'not_found' // 404: model unknown or retired at this vendor
  | 'auth' // 401/403: OUR key for this vendor is wrong; the caller cannot fix it
  | 'rate_limit' // 429, short window (requests or tokens per minute): retry soon
  | 'quota_exhausted' // 429 on a daily/monthly quota: retrying this provider today is pointless
  | 'server' // 5xx
  | 'timeout'
  | 'network'
  | 'aborted'; // the caller went away

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly status?: number;

  constructor(provider: string, kind: ProviderErrorKind, message: string, status?: number) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }

  // Worth trying the next candidate? Only a bad request is pointless to retry elsewhere,
  // and an aborted request has nobody left to answer.
  get fallbackable(): boolean {
    return this.kind !== 'bad_request' && this.kind !== 'aborted';
  }
}

export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 404) return 'not_found';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'bad_request';
}

// Builds a ProviderError from a non-2xx response. Only status and a short vendor message:
// never our request headers, so our key cannot leak into logs.
export async function errorFromResponse(provider: string, res: Response): Promise<ProviderError> {
  const body = await res.text().catch(() => '');
  let kind = kindFromStatus(res.status);
  // Vendors use 429 for both "slow down" and "out of quota for the day"; only the body tells them apart
  // (Groq: "tokens per day (TPD)"). The response headers only show the per-minute limits.
  if (kind === 'rate_limit' && /per day|\bTPD\b|\bRPD\b|daily|quota/i.test(body)) kind = 'quota_exhausted';
  return new ProviderError(provider, kind, `HTTP ${res.status}: ${body.slice(0, 200)}`, res.status);
}

// Wraps anything thrown by fetch (timeouts, DNS, connection reset) into a ProviderError.
export function errorFromThrown(provider: string, err: unknown, callerSignal?: AbortSignal): ProviderError {
  if (err instanceof ProviderError) return err;
  if (callerSignal?.aborted) return new ProviderError(provider, 'aborted', 'caller disconnected');
  const name = (err as { name?: string })?.name;
  if (name === 'TimeoutError') return new ProviderError(provider, 'timeout', 'timed out');
  if (name === 'AbortError') return new ProviderError(provider, 'timeout', 'aborted (timeout)');
  return new ProviderError(provider, 'network', (err as Error)?.message ?? 'network error');
}

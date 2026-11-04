import { errorFromResponse, errorFromThrown } from './errors.ts';

// Shared POST for all HTTP adapters: JSON body, timeout, caller abort, and error classification.
export async function postJson(opts: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchFn: typeof fetch;
}): Promise<Response> {
  // Stop on whichever comes first: our timeout, or the caller disconnecting.
  const signals = [AbortSignal.timeout(opts.timeoutMs)];
  if (opts.signal) signals.push(opts.signal);

  let res: Response;
  try {
    res = await opts.fetchFn(opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify(opts.body),
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    throw errorFromThrown(opts.provider, err, opts.signal);
  }
  if (!res.ok) throw await errorFromResponse(opts.provider, res);
  return res;
}

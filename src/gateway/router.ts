import { ProviderError } from '../providers/errors.ts';
import type { ChatMessage, ChatResult, Provider, StreamChunk, Usage } from '../providers/types.ts';
import type { UsageSink } from '../metering/usageSink.ts';
import { CircuitBreaker } from './breaker.ts';
import { costUsd, findModel, type Catalog } from './catalog.ts';

export type Candidate = { provider: string; model: string };

export type CallContext = {
  tenantId: string;
  apiKeyId: string;
  signal?: AbortSignal;
  log?: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
};

export type CallInput = {
  model: string; // "provider/model" or "simpang/<route>"
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

// An error already translated to what the HTTP caller should see.
export class GatewayError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  constructor(status: number, type: string, code: string, message: string) {
    super(message);
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

export type RouterDeps = {
  providers: Record<string, Provider>;
  catalog: Catalog;
  usageSink: UsageSink;
  breaker?: CircuitBreaker;
};

// The router turns a model name into an ordered list of candidates, tries them in order
// (skipping providers whose circuit is open), meters every attempt, and falls back on
// errors where another provider could plausibly succeed.
export class Router {
  readonly breaker: CircuitBreaker;
  private deps: RouterDeps;

  constructor(deps: RouterDeps) {
    this.deps = deps;
    this.breaker = deps.breaker ?? new CircuitBreaker();
  }

  resolve(model: string): { route?: string; candidates: Candidate[] } {
    if (model.startsWith('simpang/')) {
      const route = model.slice('simpang/'.length);
      const refs = this.deps.catalog.routes[route];
      if (!refs) throw new GatewayError(404, 'invalid_request_error', 'model_not_found', `Unknown route "${model}".`);
      // Candidates whose provider is not configured here (no key) are simply left out.
      const candidates = refs.map(split).filter((c) => this.deps.providers[c.provider]);
      if (!candidates.length) {
        throw new GatewayError(503, 'provider_error', 'no_provider_configured', `No provider for route "${route}" is configured.`);
      }
      return { route, candidates };
    }
    const candidate = split(model);
    if (!candidate.model || !this.deps.providers[candidate.provider]) {
      throw new GatewayError(404, 'invalid_request_error', 'model_not_found', `Unknown model "${model}".`);
    }
    return { candidates: [candidate] };
  }

  async complete(ctx: CallContext, input: CallInput): Promise<{ result: ChatResult; used: Candidate; attempts: number }> {
    const { route, candidates } = this.resolve(input.model);
    const errors: ProviderError[] = [];
    let attempts = 0;

    for (const candidate of candidates) {
      if (this.breaker.isOpen(candidate.provider)) continue;
      attempts++;
      const started = performance.now();
      try {
        const result = await this.deps.providers[candidate.provider].chat({ ...input, model: candidate.model, signal: ctx.signal });
        this.breaker.success(candidate.provider);
        await this.meter(ctx, candidate, route, attempts, started, 'ok', result);
        return { result, used: candidate, attempts };
      } catch (thrown) {
        const err = asProviderError(candidate.provider, thrown);
        await this.meter(ctx, candidate, route, attempts, started, 'error', { promptTokens: 0, completionTokens: 0 }, err.kind);
        this.recordFailure(candidate.provider, err);
        ctx.log?.warn({ provider: candidate.provider, model: candidate.model, kind: err.kind, status: err.status }, 'provider attempt failed');
        errors.push(err);
        if (!err.fallbackable) break;
      }
    }
    throw toGatewayError(errors, candidates.length, attempts);
  }

  // Streaming: fallback is only possible before the first piece reaches the caller.
  // After that, a failure ends the stream with an error event.
  async *stream(ctx: CallContext, input: CallInput): AsyncGenerator<{ type: 'start'; used: Candidate } | StreamChunk> {
    const { route, candidates } = this.resolve(input.model);
    const errors: ProviderError[] = [];
    let attempts = 0;

    for (const candidate of candidates) {
      if (this.breaker.isOpen(candidate.provider)) continue;
      attempts++;
      const started = performance.now();
      let sentAnything = false;
      let usage: Usage | undefined;
      let output = '';
      try {
        const chunks = this.deps.providers[candidate.provider].stream({ ...input, model: candidate.model, signal: ctx.signal });
        for await (const chunk of chunks) {
          if (chunk.type === 'usage') {
            usage = chunk.usage;
            continue;
          }
          if (!sentAnything) yield { type: 'start', used: candidate };
          sentAnything = true;
          output += chunk.text;
          yield chunk;
        }
        if (!sentAnything) yield { type: 'start', used: candidate };
        const final = usage ?? { promptTokens: 0, completionTokens: Math.ceil(output.length / 4), estimated: true };
        this.breaker.success(candidate.provider);
        await this.meter(ctx, candidate, route, attempts, started, 'ok', final);
        yield { type: 'usage', usage: final };
        return;
      } catch (thrown) {
        const err = asProviderError(candidate.provider, thrown);
        // Tokens already streamed were generated (and billed by the vendor): meter what we know.
        const partial = sentAnything ? { promptTokens: 0, completionTokens: Math.ceil(output.length / 4), estimated: true } : { promptTokens: 0, completionTokens: 0 };
        await this.meter(ctx, candidate, route, attempts, started, 'error', partial, err.kind);
        this.recordFailure(candidate.provider, err);
        ctx.log?.warn({ provider: candidate.provider, model: candidate.model, kind: err.kind }, 'provider stream failed');
        errors.push(err);
        if (sentAnything || !err.fallbackable) break;
      }
    }
    throw toGatewayError(errors, candidates.length, attempts);
  }

  private recordFailure(provider: string, err: ProviderError) {
    // A bad request or an unknown model says nothing about the provider's health.
    if (err.kind !== 'bad_request' && err.kind !== 'not_found' && err.kind !== 'aborted') this.breaker.failure(provider);
  }

  private async meter(
    ctx: CallContext,
    candidate: Candidate,
    route: string | undefined,
    attempt: number,
    started: number,
    status: 'ok' | 'error',
    usage: Usage,
    errorKind?: string,
  ) {
    const entry = findModel(this.deps.catalog, candidate.provider, candidate.model);
    try {
      await this.deps.usageSink.record({
        tenantId: ctx.tenantId,
        apiKeyId: ctx.apiKeyId,
        provider: candidate.provider,
        model: candidate.model,
        route,
        attempt,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        estimated: usage.estimated ?? false,
        costUsd: costUsd(entry, usage.promptTokens, usage.completionTokens),
        catalogVersion: this.deps.catalog.version,
        latencyMs: Math.round(performance.now() - started),
        status,
        errorKind,
      });
    } catch (err) {
      // Trade-off: a metering outage must not take the whole gateway down,
      // so we log loudly and still answer. (A durable outbox would close this gap.)
      ctx.log?.error({ err }, 'usage metering failed');
    }
  }
}

function split(ref: string): Candidate {
  const slash = ref.indexOf('/');
  return slash > 0 ? { provider: ref.slice(0, slash), model: ref.slice(slash + 1) } : { provider: ref, model: '' };
}

function asProviderError(provider: string, thrown: unknown): ProviderError {
  if (thrown instanceof ProviderError) return thrown;
  return new ProviderError(provider, 'server', (thrown as Error)?.message ?? 'unknown error');
}

function toGatewayError(errors: ProviderError[], candidateCount: number, attempts: number): GatewayError {
  if (attempts === 0) {
    return new GatewayError(503, 'provider_error', 'provider_unavailable', 'All providers for this model are temporarily unavailable. Try again shortly.');
  }
  const last = errors.at(-1)!;
  if (last.kind === 'aborted') return new GatewayError(499, 'client_error', 'client_closed', 'Client closed the request.');
  if (last.kind === 'bad_request') {
    return new GatewayError(400, 'invalid_request_error', 'upstream_rejected', `The provider rejected the request (HTTP ${last.status ?? 400}). Check the parameters.`);
  }
  if (candidateCount === 1 && last.kind === 'not_found') {
    return new GatewayError(404, 'invalid_request_error', 'model_not_found', 'The provider does not offer this model (it may be retired).');
  }
  if (errors.every((e) => e.kind === 'rate_limit')) {
    return new GatewayError(429, 'rate_limit_error', 'upstream_rate_limited', 'Providers are rate limiting. Retry later.');
  }
  return new GatewayError(502, 'provider_error', 'upstream_failed', `All ${attempts} provider attempt(s) failed. Try again later.`);
}

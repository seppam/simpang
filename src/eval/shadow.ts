import type { CallContext } from '../gateway/router.ts';
import type { DriverRegistry } from '../drivers/registry.ts';
import type { DriverRuntime } from '../drivers/runtime.ts';
import type { DriverDefinition, DriverInput, DriverRunResult } from '../drivers/types.ts';

export type ShadowRecord = {
  tenantId: string;
  driver: string;
  stableVersion: string;
  canaryVersion: string;
  input: DriverInput;
  stableOutput: unknown;
  canaryOutput: unknown;
  agree: boolean | null; // null = cannot be decided automatically (free text): needs human review
  stableLatencyMs: number;
  canaryLatencyMs: number | null;
  stableCostUsd: number;
  canaryCostUsd: number | null;
  error: string | null;
};

export interface ShadowSink {
  record(r: ShadowRecord): Promise<void>;
}

// Shadow traffic: a sample of real stable-version calls is replayed on the canary version.
// The user only ever sees the stable answer; the canary's answer, latency and cost are stored
// so we can compare them on real traffic before promoting the canary.
export class ShadowRunner {
  private opts: { registry: DriverRegistry; runtime: DriverRuntime; sink: ShadowSink; sampleRate: number; random?: () => number };
  readonly pending = new Set<Promise<void>>();

  constructor(opts: { registry: DriverRegistry; runtime: DriverRuntime; sink: ShadowSink; sampleRate: number; random?: () => number }) {
    this.opts = opts;
  }

  maybeRun(ctx: Omit<CallContext, 'signal'>, name: string, input: DriverInput, stable: DriverRunResult): void {
    const channels = this.opts.registry.channelsOf(name);
    if (!channels?.canary || channels.canary === channels.stable) return;
    if ((this.opts.random ?? Math.random)() >= this.opts.sampleRate) return;
    const canary = this.opts.registry.get(name, channels.canary)!;

    // Fire and forget: never delays or fails the user's request. Not tied to the caller's
    // connection, so it finishes even after the user got their answer.
    const job = this.run(ctx, canary, input, stable)
      .catch((err) => ctx.log?.error({ err }, 'shadow run failed'))
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  private async run(ctx: Omit<CallContext, 'signal'>, canary: DriverDefinition, input: DriverInput, stable: DriverRunResult) {
    const base = {
      tenantId: ctx.tenantId,
      driver: canary.name,
      stableVersion: stable.driver.split('@')[1],
      canaryVersion: canary.version,
      input,
      stableOutput: stable.output,
      stableLatencyMs: stable.latencyMs,
      stableCostUsd: stable.usage.costUsd,
    };
    try {
      const result = await this.opts.runtime.run({ ...ctx, log: ctx.log }, canary, input);
      await this.opts.sink.record({
        ...base,
        canaryOutput: result.output,
        agree: compare(canary, stable.output, result.output),
        canaryLatencyMs: result.latencyMs,
        canaryCostUsd: result.usage.costUsd,
        error: null,
      });
    } catch (err) {
      await this.opts.sink.record({ ...base, canaryOutput: null, agree: false, canaryLatencyMs: null, canaryCostUsd: null, error: (err as Error).message });
    }
  }
}

// For structured outputs, compare the categorical fields (those with an enum in the schema, or
// arrays of enums). Free text cannot be judged by string equality: return null for human review.
export function compare(def: DriverDefinition, a: unknown, b: unknown): boolean | null {
  if (def.output.type !== 'json') return null;
  const props = (def.output.schema.properties ?? {}) as Record<string, { enum?: unknown[]; items?: { enum?: unknown[] } }>;
  const keys = Object.entries(props).filter(([, s]) => s.enum || s.items?.enum).map(([k]) => k);
  const norm = (v: unknown) => (Array.isArray(v) ? [...v].sort().join(',') : String(v));
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return keys.every((k) => norm(x?.[k]) === norm(y?.[k]));
}

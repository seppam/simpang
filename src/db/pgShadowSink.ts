import type pg from 'pg';
import type { ShadowRecord, ShadowSink } from '../eval/shadow.ts';

export class PgShadowSink implements ShadowSink {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async record(r: ShadowRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO shadow_runs (tenant_id, driver, stable_version, canary_version, input, stable_output, canary_output,
         agree, stable_latency_ms, canary_latency_ms, stable_cost_usd, canary_cost_usd, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        r.tenantId, r.driver, r.stableVersion, r.canaryVersion, JSON.stringify(r.input), JSON.stringify(r.stableOutput),
        JSON.stringify(r.canaryOutput), r.agree, r.stableLatencyMs, r.canaryLatencyMs, r.stableCostUsd, r.canaryCostUsd, r.error,
      ],
    );
  }
}

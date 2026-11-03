import type pg from 'pg';
import type { UsageEvent, UsageSink } from '../metering/usageSink.ts';

export class PgUsageSink implements UsageSink {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async record(e: UsageEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO usage_events
         (tenant_id, api_key_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [e.tenantId, e.apiKeyId, e.provider, e.model, e.promptTokens, e.completionTokens, e.costUsd, e.latencyMs, e.status],
    );
  }
}

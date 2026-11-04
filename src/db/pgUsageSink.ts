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
         (tenant_id, api_key_id, provider, model, route, attempt, prompt_tokens, completion_tokens,
          estimated, cost_usd, catalog_version, latency_ms, status, error_kind, driver)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        e.tenantId, e.apiKeyId, e.provider, e.model, e.route ?? null, e.attempt ?? 1, e.promptTokens, e.completionTokens,
        e.estimated ?? false, e.costUsd, e.catalogVersion ?? null, e.latencyMs, e.status, e.errorKind ?? null, e.driver ?? null,
      ],
    );
  }
}

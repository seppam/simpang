import type pg from 'pg';
import type { QuotaGuard, QuotaStatus } from '../metering/quota.ts';

// Monthly token budget from tenants.monthly_token_limit, compared with this month's usage.
// The (tenant_id, created_at) index from migration 001 makes the SUM cheap.
// Known limit: checked before the call, so concurrent requests can overshoot slightly
// (a soft quota). A hard quota would reserve tokens up front.
export class PgQuota implements QuotaGuard {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async check(tenantId: string): Promise<QuotaStatus> {
    const { rows } = await this.pool.query<{ limit: string | null; used: string }>(
      `SELECT t.monthly_token_limit AS limit,
              COALESCE((SELECT SUM(u.prompt_tokens + u.completion_tokens)
                        FROM usage_events u
                        WHERE u.tenant_id = t.id AND u.created_at >= date_trunc('month', now())), 0) AS used
       FROM tenants t WHERE t.id = $1`,
      [tenantId],
    );
    const row = rows[0];
    if (!row || row.limit === null) return { allowed: true };
    const limit = Number(row.limit);
    const used = Number(row.used);
    return used < limit ? { allowed: true } : { allowed: false, limit, used };
  }
}

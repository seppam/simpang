import type pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { generateApiKey } from '../auth/keys.ts';
import type { Role } from '../auth/rbac.ts';
import type { AdminStore, KeyRow, OAuthClient, ProviderHealth, Scope, ShadowSummary, TenantRow, UsageRow } from '../admin/store.ts';

// Every query takes a scope: a tenant id, or null for platform admins. Tenant isolation is
// enforced here in SQL ("$1::uuid IS NULL OR tenant_id = $1"), not only in the UI.
export class PgAdminStore implements AdminStore {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async findClient(clientId: string): Promise<OAuthClient | null> {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id AS "tenantId", client_id AS "clientId", secret_hash AS "secretHash", role, name,
              revoked_at IS NOT NULL AS revoked
       FROM oauth_clients WHERE client_id = $1`,
      [clientId],
    );
    return rows[0] ?? null;
  }

  async usage(scope: Scope, days: number): Promise<UsageRow[]> {
    const { rows } = await this.pool.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, provider, model,
              count(*)::int AS requests,
              count(*) FILTER (WHERE status = 'error')::int AS errors,
              COALESCE(sum(prompt_tokens + completion_tokens), 0)::int AS tokens,
              COALESCE(sum(cost_usd), 0)::float AS "costUsd"
       FROM usage_events
       WHERE created_at >= now() - make_interval(days => $2) AND ($1::uuid IS NULL OR tenant_id = $1)
       GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
      [scope, days],
    );
    return rows;
  }

  async providerHealth(minutes: number): Promise<ProviderHealth[]> {
    const { rows } = await this.pool.query(
      `SELECT provider, count(*)::int AS requests,
              count(*) FILTER (WHERE status = 'error')::int AS errors,
              round(count(*) FILTER (WHERE status = 'error')::numeric / count(*), 4)::float AS "errorRate",
              COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'ok'), 0)::int AS "p95LatencyMs"
       FROM usage_events
       WHERE created_at >= now() - make_interval(mins => $1)
       GROUP BY provider ORDER BY provider`,
      [minutes],
    );
    return rows;
  }

  async tenants(scope: Scope): Promise<TenantRow[]> {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.name, t.monthly_token_limit::float AS "monthlyTokenLimit",
              COALESCE((SELECT sum(u.prompt_tokens + u.completion_tokens) FROM usage_events u
                        WHERE u.tenant_id = t.id AND u.created_at >= date_trunc('month', now())), 0)::float AS "usedThisMonth"
       FROM tenants t WHERE ($1::uuid IS NULL OR t.id = $1) ORDER BY t.name`,
      [scope],
    );
    return rows;
  }

  async setQuota(tenantId: string, limit: number | null): Promise<boolean> {
    const res = await this.pool.query('UPDATE tenants SET monthly_token_limit = $2 WHERE id = $1', [tenantId, limit]);
    return res.rowCount === 1;
  }

  async keys(scope: Scope): Promise<KeyRow[]> {
    const { rows } = await this.pool.query(
      `SELECT k.id, k.tenant_id AS "tenantId", t.name AS "tenantName", k.key_prefix AS prefix,
              k.created_at AS "createdAt", k.revoked_at AS "revokedAt"
       FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
       WHERE ($1::uuid IS NULL OR k.tenant_id = $1) ORDER BY k.created_at DESC`,
      [scope],
    );
    return rows;
  }

  async createKey(tenantId: string) {
    const { key, prefix, hash } = generateApiKey();
    const { rows } = await this.pool.query<{ id: string }>(
      'INSERT INTO api_keys (tenant_id, key_prefix, key_hash) VALUES ($1, $2, $3) RETURNING id',
      [tenantId, prefix, hash],
    );
    return { id: rows[0].id, key, prefix };
  }

  async revokeKey(scope: Scope, keyId: string): Promise<boolean> {
    // The scope check is part of the UPDATE: an operator cannot revoke another tenant's key
    // even by guessing its id.
    const res = await this.pool.query(
      `UPDATE api_keys SET revoked_at = now()
       WHERE id = $2 AND revoked_at IS NULL AND ($1::uuid IS NULL OR tenant_id = $1)`,
      [scope, keyId],
    );
    return res.rowCount === 1;
  }

  async shadow(scope: Scope): Promise<ShadowSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT driver, stable_version AS "stableVersion", canary_version AS "canaryVersion", count(*)::int AS runs,
              round(avg(CASE WHEN agree THEN 1.0 WHEN agree = false THEN 0.0 END), 4)::float AS "agreeRate",
              count(*) FILTER (WHERE error IS NOT NULL)::int AS errors,
              round(avg(stable_latency_ms))::int AS "avgStableLatencyMs",
              round(avg(canary_latency_ms))::int AS "avgCanaryLatencyMs",
              sum(stable_cost_usd)::float AS "stableCostUsd", sum(canary_cost_usd)::float AS "canaryCostUsd"
       FROM shadow_runs WHERE ($1::uuid IS NULL OR tenant_id = $1)
       GROUP BY 1, 2, 3 ORDER BY 1, 3`,
      [scope],
    );
    return rows;
  }

  async audit(entry: { tenantId: string | null; actor: string; action: string; target?: string; detail?: unknown }) {
    await this.pool.query('INSERT INTO audit_log (tenant_id, actor, action, target, detail) VALUES ($1, $2, $3, $4, $5)', [
      entry.tenantId,
      entry.actor,
      entry.action,
      entry.target ?? null,
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
    ]);
  }
}

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

// Creates an OAuth client for a tenant (creating the tenant if needed). The secret is shown once.
export async function createClient(pool: pg.Pool, tenantName: string, role: Role, name = `${role} client`) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [tenantName],
  );
  const clientId = `cl_${randomBytes(9).toString('base64url')}`;
  const secret = `cs_${randomBytes(32).toString('base64url')}`;
  await pool.query('INSERT INTO oauth_clients (tenant_id, client_id, secret_hash, name, role) VALUES ($1, $2, $3, $4, $5)', [
    rows[0].id,
    clientId,
    hashSecret(secret),
    name,
    role,
  ]);
  return { clientId, secret, tenantId: rows[0].id };
}

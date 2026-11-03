import type pg from 'pg';
import { generateApiKey } from '../auth/keys.ts';
import type { ActiveKey, KeyStore } from '../auth/keyStore.ts';

export class PgKeyStore implements KeyStore {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async findActiveKey(hash: string): Promise<ActiveKey | null> {
    // key_hash is UNIQUE, so Postgres already has an index for this lookup.
    const { rows } = await this.pool.query<ActiveKey>(
      `SELECT k.id AS "apiKeyId", t.id AS "tenantId", t.name AS "tenantName"
       FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
       WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
      [hash],
    );
    return rows[0] ?? null;
  }
}

// Creates the tenant if needed and a fresh key for it. The raw key is returned once and never stored.
export async function createTenantWithKey(pool: pg.Pool, tenantName: string) {
  const { key, prefix, hash } = generateApiKey();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [tenantName],
  );
  await pool.query('INSERT INTO api_keys (tenant_id, key_prefix, key_hash) VALUES ($1, $2, $3)', [
    rows[0].id,
    prefix,
    hash,
  ]);
  return { key, prefix, hash };
}

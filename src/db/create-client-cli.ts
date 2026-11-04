import pg from 'pg';
import { createClient } from './pgAdminStore.ts';
import type { Role } from '../auth/rbac.ts';

const [tenant, role] = process.argv.slice(2);
if (!tenant || !['admin', 'operator', 'viewer'].includes(role)) {
  console.error('usage: npm run create-client -- <tenant-name> <admin|operator|viewer>');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang',
});
const { clientId, secret } = await createClient(pool, tenant, role as Role);
await pool.end();

// Shown once only: the database keeps just the hash of the secret.
console.log(`tenant: ${tenant}\nrole: ${role}\nclient_id: ${clientId}\nclient_secret (copy it now, it is not stored): ${secret}`);

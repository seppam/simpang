import pg from 'pg';
import { migrate } from './migrate.ts';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang',
});
const applied = await migrate(pool);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
await pool.end();

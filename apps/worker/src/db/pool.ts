import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('[worker] Unexpected PG pool error (a connection died in the pool):', err);
});

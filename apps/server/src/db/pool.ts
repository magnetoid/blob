/** Postgres access. One pool, thin helpers, explicit transactions. */

import pg from 'pg';
import { config } from '../config.ts';

const { Pool } = pg;

// Return bigint counts as numbers — every count in this app is small.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));
// Keep timestamptz as ISO strings; the app never does date math in the DB layer.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.isTest ? 4 : 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error({ err }, 'idle postgres client error');
});

export type Queryable = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  client: Queryable = pool,
): Promise<T[]> {
  const result = await client.query<T>(sql, params as never[]);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  client: Queryable = pool,
): Promise<T | null> {
  const rows = await query<T>(sql, params, client);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a transaction.
 *
 * Side effects that must not happen before COMMIT — broadcasting events, enqueuing
 * jobs — belong *after* this resolves, never inside `fn`. Emitting mid-transaction
 * is the classic bug where a client fetches a message the database hasn't committed.
 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

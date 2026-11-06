import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export class InputError extends Error {}

export function databaseOptions(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw new InputError('Set DATABASE_URL to a PostgreSQL connection URL.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !host || !url.username
    || !/^\/[a-z0-9_]+$/i.test(url.pathname) || url.search || url.hash || url.port === '0') {
    throw new InputError('DATABASE_URL needs a host, user, and database name without query options or fragments.');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  return {
    host, port: Number(url.port || 5432), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1),
    ssl: local ? false : { rejectUnauthorized: true },
    max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000,
    application_name: 'oso-claims-steward',
  };
}

export function createPool(connectionString = process.env.DATABASE_URL) {
  return new pg.Pool(databaseOptions(connectionString));
}

export async function transaction(pool, work) {
  const client = await pool.connect();
  let broken;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { broken = rollbackError; }
    throw error;
  } finally {
    client.release(broken);
  }
}

export async function migrate(pool) {
  const sql = await readFile(new URL('../schema/001_steward.sql', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(sql).digest('hex');
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(479621, 1)');
    await client.query('CREATE SCHEMA IF NOT EXISTS artist_claims');
    await client.query('CREATE TABLE IF NOT EXISTS artist_claims.schema_migrations (version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
    const existing = await client.query('SELECT sha256 FROM artist_claims.schema_migrations WHERE version = $1', ['001']);
    if (existing.rowCount) {
      if (existing.rows[0].sha256 !== hash) throw new InputError('Applied migration 001 differs from source; do not modify an applied migration.');
      return { applied: false, version: '001' };
    }
    await client.query(sql);
    await client.query('INSERT INTO artist_claims.schema_migrations(version, sha256) VALUES($1, $2)', ['001', hash]);
    return { applied: true, version: '001' };
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseOptions, InputError } from '../src/database.mjs';
import { issueInvite, freezeClaim } from '../src/steward.mjs';

test('local database options are explicit; remote databases require verified TLS', () => {
  const local = databaseOptions('postgresql://tester:local@127.0.0.1:5543/test_claims');
  assert.equal(local.ssl, false); assert.equal(local.port, 5543);
  assert.deepEqual(databaseOptions('postgresql://tester:password@db.example/claims').ssl, { rejectUnauthorized: true });
});

test('database configuration cannot override TLS, hosts, or query behavior through URL options', () => {
  for (const url of [undefined, 'https://tester@db.example/claims', 'postgresql://tester@db.example/claims?sslmode=disable', 'postgresql://tester@127.0.0.1/claims?host=remote.example', 'postgresql://tester@db.example/claims#secret']) {
    assert.throws(() => databaseOptions(url), InputError);
  }
});

test('invalid operator input is rejected before any database access', async () => {
  const pool = { connect() { throw new Error('Database must not be called'); } };
  await assert.rejects(issueInvite(pool, { artist: 'Artist', actor: 'Steward', ttlHours: 73 }), InputError);
  await assert.rejects(issueInvite(pool, { artist: 'Artist', actor: 'Steward', ttlHours: NaN }), InputError);
  await assert.rejects(issueInvite(pool, { artist: '', actor: 'Steward' }), InputError);
  await assert.rejects(freezeClaim(pool, { claimId: 'not-a-uuid', actor: 'Steward', reason: 'Dispute' }), InputError);
});

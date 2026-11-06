import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createPool, migrate } from '../src/database.mjs';
import { issueInvite, freezeClaim, revokeInvite } from '../src/steward.mjs';

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a dedicated empty test database, or run test:local.');
const pool = createPool(process.env.TEST_DATABASE_URL);
before(async () => {
  const found = await pool.query("SELECT 1 FROM pg_namespace WHERE nspname = 'artist_claims'");
  assert.equal(found.rowCount, 0, 'Use an empty test database; this suite never resets an existing schema.');
});
after(() => pool.end());

test('concurrent migrations apply once and validate the stored checksum on rerun', async () => {
  const results = await Promise.all([migrate(pool), migrate(pool), migrate(pool)]);
  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal((await migrate(pool)).applied, false);
  const original = (await pool.query("SELECT sha256 FROM artist_claims.schema_migrations WHERE version = '001'")).rows[0].sha256;
  try {
    await pool.query("UPDATE artist_claims.schema_migrations SET sha256 = 'mismatched' WHERE version = '001'");
    await assert.rejects(migrate(pool), /differs from source/);
  } finally {
    await pool.query("UPDATE artist_claims.schema_migrations SET sha256 = $1 WHERE version = '001'", [original]);
  }
});

test('invites contain random bearer tokens, store only hashes, and safely retain SQL-looking artist text', async () => {
  const artist = "Artist'); DROP TABLE artist_claims.invites; --";
  const first = await issueInvite(pool, { artist, actor: 'Test steward', ttlHours: 1 });
  const second = await issueInvite(pool, { artist: 'Other artist', actor: 'Test steward' });
  assert.match(first.token, /^[a-zA-Z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  const row = (await pool.query('SELECT * FROM artist_claims.invites WHERE id = $1', [first.inviteId])).rows[0];
  assert.equal(row.artist_name, artist);
  assert.equal(row.token_hash, createHash('sha256').update(first.token).digest('hex'));
  assert.ok(!JSON.stringify(row).includes(first.token));
  assert.ok(row.expires_at - row.created_at >= 3_599_000);
  const events = (await pool.query('SELECT * FROM artist_claims.audit_events WHERE invite_id = $1', [first.inviteId])).rows;
  assert.equal(events.length, 1);
  assert.ok(!JSON.stringify(events).includes(first.token));
});

async function fixtureClaim() {
  const invite = await issueInvite(pool, { artist: 'Test fixture only', actor: 'Test steward' });
  const id = randomUUID();
  // Test fixture only; no production/CLI path is allowed to bypass signature verification.
  await pool.query(`INSERT INTO artist_claims.claims(id, invite_id, ens_owner, hedera_account, hedera_network, verified_at, activation_state)
    VALUES($1, $2, $3, '0.0.123', 'testnet', clock_timestamp(), 'active')`, [id, invite.inviteId, '0x' + '12'.repeat(20)]);
  return { id, invite };
}

test('concurrent freezes commit one audit event and leave identity, payout and activation fields intact', async () => {
  const { id } = await fixtureClaim();
  const before = (await pool.query('SELECT * FROM artist_claims.claims WHERE id = $1', [id])).rows[0];
  const results = await Promise.all(Array.from({ length: 10 }, () => freezeClaim(pool, { claimId: id, actor: 'Test steward', reason: 'Test dispute' })));
  assert.equal(results.filter((result) => result.changed).length, 1);
  const row = (await pool.query('SELECT * FROM artist_claims.claims WHERE id = $1', [id])).rows[0];
  for (const key of ['ens_owner', 'hedera_account', 'hedera_network', 'activation_state', 'invite_id']) assert.equal(row[key], before[key]);
  assert.ok(row.frozen_at);
  assert.equal((await pool.query('SELECT 1 FROM artist_claims.audit_events WHERE claim_id = $1', [id])).rowCount, 1);
});

test('audit insertion failure rolls back the freeze, and the schema rejects incomplete freeze records', async (t) => {
  const { id } = await fixtureClaim();
  await assert.rejects(pool.query('UPDATE artist_claims.claims SET frozen_at = clock_timestamp() WHERE id = $1', [id]), { code: '23514' });
  await pool.query(`CREATE FUNCTION artist_claims.test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.reason = 'test audit failure' THEN RAISE EXCEPTION 'test only'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_reject_audit BEFORE INSERT ON artist_claims.audit_events FOR EACH ROW EXECUTE FUNCTION artist_claims.test_reject_audit()`);
  t.after(() => pool.query('DROP TRIGGER test_reject_audit ON artist_claims.audit_events; DROP FUNCTION artist_claims.test_reject_audit()'));
  await assert.rejects(freezeClaim(pool, { claimId: id, actor: 'Test steward', reason: 'test audit failure' }));
  assert.equal((await pool.query('SELECT frozen_at FROM artist_claims.claims WHERE id = $1', [id])).rows[0].frozen_at, null);
  assert.equal((await pool.query('SELECT 1 FROM artist_claims.audit_events WHERE claim_id = $1', [id])).rowCount, 0);
});

test('revocation is idempotent and cannot substitute for freezing a redeemed claim', async () => {
  const invite = await issueInvite(pool, { artist: 'Revocable invitation', actor: 'Test steward' });
  const input = { inviteId: invite.inviteId, actor: 'Test steward', reason: 'Withdrawn test invitation' };
  const results = await Promise.all([revokeInvite(pool, input), revokeInvite(pool, input)]);
  assert.equal(results.filter((result) => result.changed).length, 1);
  const claimed = await fixtureClaim();
  await assert.rejects(revokeInvite(pool, { ...input, inviteId: claimed.invite.inviteId }), /already claimed/);
  assert.equal((await pool.query('SELECT revoked_at FROM artist_claims.invites WHERE id = $1', [claimed.invite.inviteId])).rows[0].revoked_at, null);
});

test('CLI runs against the test database and never echoes connection details on failure', () => {
  const cli = new URL('../src/cli.mjs', import.meta.url);
  const result = JSON.parse(execFileSync(process.execPath, [cli.pathname, 'invite', '--artist', 'CLI fixture', '--actor', 'Test steward'], { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }, encoding: 'utf8' }));
  assert.match(result.token, /^[a-zA-Z0-9_-]{43}$/);
  try {
    execFileSync(process.execPath, [cli.pathname, 'migrate'], { env: { ...process.env, DATABASE_URL: 'invalid-private-value' }, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected configuration failure');
  } catch (error) {
    assert.equal(error.status, 1);
    assert.doesNotMatch(error.stderr, /invalid-private-value/);
  }
});

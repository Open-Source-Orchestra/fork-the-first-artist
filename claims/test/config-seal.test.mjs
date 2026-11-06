import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { configuration, InputError } from '../src/config.mjs';
import { seal, unseal } from '../src/seal.mjs';
import { issueInvite, freezeClaim } from '../src/steward.mjs';

const env = { ARKIV_NAMESPACE: 'test-only', ARKIV_ACCESS_KEY: 'test-only', ARKIV_PRIVATE_KEY: '0x' + '11'.repeat(32), ARKIV_ENCRYPTION_KEY: '22'.repeat(32) };
test('Arkiv configuration validates keys, namespace, retention and debug logging', () => {
  assert.equal(configuration(env).retentionDays, 30);
  for (const patch of [{ ARKIV_NAMESPACE: "x' OR true" }, { ARKIV_ACCESS_KEY: '' }, { ARKIV_PRIVATE_KEY: 'bad' }, { ARKIV_ENCRYPTION_KEY: '11'.repeat(32) }, { ARKIV_RETENTION_DAYS: '181' }, { ARKIV_RETENTION_DAYS: '3' }, { DEBUG: '*' }]) {
    assert.throws(() => configuration({ ...env, ...patch }), InputError);
  }
});
test('private payload uses random authenticated encryption bound to record identity and network context', () => {
  const key = randomBytes(32), context = { owner: '0x' + '12'.repeat(20), namespace: 'demo', kind: 'invite', id: 'fixture' };
  const value = { artist: 'Private artist', actor: 'Private steward', tokenHash: 'private hash' };
  const first = seal(value, key, context), second = seal(value, key, context);
  assert.notDeepEqual(first, second);
  assert.ok(!Buffer.from(first).includes(Buffer.from(value.artist)));
  assert.deepEqual(unseal(first, key, context), value);
  assert.throws(() => unseal(first, randomBytes(32), context), InputError);
  for (const patch of [{ namespace: 'other' }, { owner: '0x' + '34'.repeat(20) }, { kind: 'claim' }, { id: 'other' }]) assert.throws(() => unseal(first, key, { ...context, ...patch }), InputError);
  const modified = first.slice(); modified[modified.length - 1] ^= 1;
  assert.throws(() => unseal(modified, key, context), InputError);
  assert.throws(() => unseal(new Uint8Array(2), key, context), InputError);
  assert.throws(() => seal({ value: 'x'.repeat(17000) }, key, context), InputError);
});
test('invalid operator input is rejected before storage access', async () => {
  const store = { write() { throw Error('must not write'); }, read() { throw Error('must not read'); } };
  await assert.rejects(issueInvite(store, { artist: '', actor: 'Operator' }), InputError);
  await assert.rejects(issueInvite(store, { artist: 'Artist', actor: 'Operator', ttlHours: 73 }), InputError);
  await assert.rejects(freezeClaim(store, { claimId: 'bad', actor: 'Operator', reason: 'Dispute' }), InputError);
});

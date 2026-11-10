// Explicit live test: spends tGLM, stores encrypted synthetic invites, never creates claims.
import assert from 'node:assert/strict';
import { connect } from '../src/arkiv.mjs';
import { issueInvite, revokeInvite, inviteStatus } from '../src/steward.mjs';
import { InputError, StateConflictError, CHAIN_ID } from '../src/config.mjs';

try {
  const store = connect();
  store.retentionDays = 4;
  await store.check();
  const issued = await issueInvite(store, { artist: 'Synthetic Arkiv verification fixture', actor: 'Automated test', ttlHours: 1 });
  // Deliberately never print the invitation token or decrypted entity payload.
  const stale = await store.read('invite', issued.inviteId);
  assert.equal((await inviteStatus(store, issued.inviteId)).state, 'issued');
  const revoked = await revokeInvite(store, { inviteId: issued.inviteId, actor: 'Automated test', reason: 'Synthetic verification completed' });
  assert.equal((await inviteStatus(store, issued.inviteId)).state, 'revoked');
  assert.equal((await revokeInvite(store, { inviteId: issued.inviteId, actor: 'Automated test', reason: 'Idempotency check' })).changed, false);
  // If the old entity can be consumed twice, the live concurrency guarantee is false.
  await assert.rejects(store.write('invite', issued.inviteId, { ...stale.data, state: 'issued' },
    { action: 'test_stale_write_must_fail', actor: 'Automated test', at: Date.now() }, stale), StateConflictError);
  assert.equal((await inviteStatus(store, issued.inviteId)).state, 'revoked');
  assert.equal((await store.query('invite', issued.inviteId).fetch()).count, 1n);
  console.log(JSON.stringify({ chainId: CHAIN_ID, writer: store.owner, namespace: store.namespace,
    inviteId: issued.inviteId, issueTransaction: issued.txHash, revokeTransaction: revoked.txHash,
    entityKey: revoked.entityKey, checks: ['write', 'read', 'revoke', 'idempotency', 'stale batch rejection'],
    explorer: `https://rabdi.explorer.arkiv.network/tx/${revoked.txHash}` }, null, 2));
} catch (error) {
  console.error(error instanceof InputError ? error.message : 'Live Arkiv verification failed; no success evidence recorded. Check configuration, funding, RPC, and chain state privately.');
  process.exitCode = 1;
}

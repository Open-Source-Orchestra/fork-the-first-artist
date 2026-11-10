import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createPublicClient } from '@arkiv-network/sdk';
import { custom } from 'viem';
import { rabdi } from '@arkiv-network/sdk/chains';
import { ArkivStore } from '../src/arkiv.mjs';
import { CHAIN_ID, InputError } from '../src/config.mjs';
import { issueInvite, revokeInvite, freezeClaim, inviteStatus, claimStatus } from '../src/steward.mjs';

const owner = '0x' + '12'.repeat(20);
const keyOf = (n) => '0x' + n.toString(16).padStart(64, '0');
// This models documented batch semantics for regression tests; it is not a real Arkiv node.
function fixture() {
  const rows = new Map(); let number = 0, fail = false, block = 100n;
  const publicClient = {
    getChainId: async () => CHAIN_ID,
    getBlockTiming: async () => ({ currentBlock: block, currentBlockTime: Math.floor(Date.now() / 1000) }),
  };
  const walletClient = { executeBatch: async (batch) => {
    await new Promise((resolve) => setImmediate(resolve));
    if (fail || (batch.deletes ?? []).some(({ entityKey }) => !rows.has(entityKey))) throw Error('private RPC error details');
    const creates = batch.creates.map((c) => {
      const k = keyOf(++number);
      const attrs = Object.fromEntries(Object.entries(c.values).map(([name, value]) => [name, { value }]));
      return [k, { $key: k, $owner: owner, $creator: owner, $creationFlags: c.flags, $expiresAt: 100000n, ...attrs }];
    });
    for (const { entityKey } of batch.deletes ?? []) rows.delete(entityKey);
    for (const [k, row] of creates) rows.set(k, row);
    block++;
    return { txHash: keyOf(++number), createdEntities: creates.map(([k]) => k) };
  } };
  const store = new ArkivStore({ publicClient, walletClient, owner, namespace: 'test-only', encryptionKey: randomBytes(32) });
  store.query = (kind, id) => ({ fetch: async () => {
    const entities = [...rows.values()].filter((r) => r.kind.value === kind && r.id.value === id);
    return { entities, count: BigInt(entities.length), skipped: 0, blockNumber: block };
  } });
  return { store, rows, fail: () => { fail = true; }, publicClient };
}
async function claimFixture(store) {
  const id = randomUUID();
  const data = { version: 1, kind: 'claim', id, inviteId: randomUUID(), ensOwner: owner,
    hederaAccount: '0.0.123', hederaNetwork: 'testnet', verifiedAt: Date.now(), activationState: 'active', frozen: null };
  await store.write('claim', id, data, { action: 'test_fixture_only' });
  return { id, data };
}

test('invite writes encrypt private fields and token hash; status reads authoritative storage', async () => {
  const f = fixture();
  const issued = await issueInvite(f.store, { artist: 'Private artist', actor: 'Steward' });
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  const data = (await f.store.read('invite', issued.inviteId)).data;
  assert.equal(data.tokenHash, createHash('sha256').update(issued.token).digest('hex'));
  for (const row of f.rows.values()) {
    assert.ok(!Buffer.from(row.sealed.value).includes(Buffer.from(issued.token)));
    assert.ok(!Buffer.from(row.sealed.value).includes(Buffer.from('Private artist')));
    assert.deepEqual(Object.keys(row).filter((k) => !k.startsWith('$')).sort(), ['id', 'kind', 'namespace', 'sealed']);
  }
  assert.equal((await inviteStatus(f.store, issued.inviteId)).state, 'issued');
});

test('ten concurrent freezes consume one prior entity and preserve wallet/activation fields', async () => {
  const f = fixture(); const { id, data } = await claimFixture(f.store);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => freezeClaim(f.store, { claimId: id, actor: 'Steward', reason: 'Dispute' })));
  assert.equal(results.filter((r) => r.status === 'fulfilled' && r.value.changed).length, 1);
  const saved = (await f.store.read('claim', id)).data;
  for (const field of ['ensOwner', 'hederaAccount', 'hederaNetwork', 'activationState', 'inviteId']) assert.equal(saved[field], data[field]);
  assert.equal([...f.rows.values()].filter((r) => r.kind.value === 'audit').length, 2);
  assert.equal((await freezeClaim(f.store, { claimId: id, actor: 'Another', reason: 'Later' })).changed, false);
  assert.equal((await claimStatus(f.store, id)).frozenAt, saved.frozen.at);
});

test('batch failure cannot leave state without its audit and does not disclose raw RPC errors', async () => {
  const f = fixture(); const { id } = await claimFixture(f.store); const size = f.rows.size;
  f.fail();
  await assert.rejects(freezeClaim(f.store, { claimId: id, actor: 'Steward', reason: 'Dispute' }), (e) => e instanceof InputError && !e.message.includes('private RPC'));
  assert.equal(f.rows.size, size); assert.equal((await f.store.read('claim', id)).data.frozen, null);
});

test('revocation is idempotent, claimed invites are protected, and logical expiry is independent of storage expiry', async () => {
  const f = fixture(); const issued = await issueInvite(f.store, { artist: 'Fixture', actor: 'Steward' });
  const args = { inviteId: issued.inviteId, actor: 'Steward', reason: 'Withdrawn' };
  await revokeInvite(f.store, args);
  assert.equal((await revokeInvite(f.store, args)).changed, false);
  assert.equal((await inviteStatus(f.store, issued.inviteId)).state, 'revoked');
  const other = await issueInvite(f.store, { artist: 'Fixture', actor: 'Steward' });
  let old = await f.store.read('invite', other.inviteId);
  await f.store.write('invite', other.inviteId, { ...old.data, expiresAt: 1 }, { action: 'test' }, old);
  assert.equal((await inviteStatus(f.store, other.inviteId)).state, 'expired');
  old = await f.store.read('invite', other.inviteId);
  await f.store.write('invite', other.inviteId, { ...old.data, state: 'claimed' }, { action: 'test' }, old);
  await assert.rejects(revokeInvite(f.store, { ...args, inviteId: other.inviteId }), /already claimed/);
});

test('missing, expired, duplicate, wrong-owner and stale records fail closed', async () => {
  const f = fixture(); const { id } = await claimFixture(f.store);
  await assert.rejects(claimStatus(f.store, randomUUID()), /not found/);
  const original = [...f.rows.values()].find((r) => r.kind.value === 'claim');
  const cases = [ { $owner: '0x' + '34'.repeat(20) }, { $creator: '0x' + '34'.repeat(20) }, { $expiresAt: 1n }, { $creationFlags: { readonly: false } } ];
  for (const patch of cases) {
    f.rows.set(original.$key, { ...original, ...patch });
    await assert.rejects(claimStatus(f.store, id), InputError);
  }
  f.rows.set(original.$key, original);
  f.rows.set(keyOf(999), { ...original, $key: keyOf(999) });
  await assert.rejects(claimStatus(f.store, id), /ambiguous/);
  f.rows.delete(keyOf(999));
  f.publicClient.getBlockTiming = async () => ({ currentBlock: 9999n, currentBlockTime: Math.floor(Date.now() / 1000) });
  await assert.rejects(claimStatus(f.store, id), /stale/);
  f.publicClient.getChainId = async () => 1;
  await assert.rejects(claimStatus(f.store, id), /Rabdi/);
});

test('real SDK renders scoped queries and decodes RPC results without skipping invalid schema rows', async () => {
  const calls = [];
  const client = createPublicClient({ chain: rabdi({ accessKey: 'test-only' }), transport: custom({ request: async (args) => {
    calls.push(args);
    return { data: [], count: '0x0', blockNumber: '0x64' };
  } }) });
  const store = new ArkivStore({ publicClient: client, owner, namespace: 'test-only', encryptionKey: randomBytes(32) });
  const id = randomUUID();
  const page = await store.query('invite', id).fetch();
  assert.equal(page.count, 0n); assert.equal(page.blockNumber, 100n);
  assert.equal(calls[0].method, 'arkiv_query');
  const query = calls[0].params[0];
  for (const fragment of ['oso.claims.v1', '$owner', '$creator', owner, 'namespace', 'test-only', 'invite', id]) assert.ok(query.includes(fragment), fragment);
  assert.equal(calls[0].params[1].limit, '0x2');
});

test('real SDK decodes an encrypted RPC entity and rejects a missing required payload', async () => {
  const f = fixture();
  const issued = await issueInvite(f.store, { artist: 'Fixture', actor: 'Steward' });
  const model = [...f.rows.values()].find((r) => r.kind.value === 'invite');
  const rpcRow = {
    key: model.$key, owner, creator: owner, createdAt: '0x60', updatedAt: '0x60', expiresAt: '0xffff',
    creationFlags: { readonly: true, permissionlessExtension: false },
    attributes: [{ name: 'arkiv.schema', type: 'str', value: 'oso.claims.v1' },
      ...['namespace', 'kind', 'id'].map((name) => ({ name, type: 'str', value: model[name].value })),
      { name: 'sealed', type: 'bytes', value: '0x' + Buffer.from(model.sealed.value).toString('hex') }],
  };
  const client = createPublicClient({ chain: rabdi({ accessKey: 'test-only' }), transport: custom({ request: async ({ method }) => {
    if (method === 'eth_chainId') return '0x76edaf';
    if (method === 'arkiv_getBlockTiming') return { current_block: 100, current_block_time: Math.floor(Date.now() / 1000), duration: 2 };
    if (method === 'arkiv_query') return { data: [rpcRow], count: '0x1', blockNumber: '0x64' };
    throw Error('Unexpected method');
  } }) });
  const store = new ArkivStore({ publicClient: client, owner, namespace: 'test-only', encryptionKey: f.store.encryptionKey });
  assert.equal((await inviteStatus(store, issued.inviteId)).state, 'issued');
  rpcRow.attributes = rpcRow.attributes.filter((a) => a.name !== 'sealed');
  await assert.rejects(store.read('invite', issued.inviteId));
});

test('only a decoded missing-prior-entity revert is classified as a state conflict', async () => {
  const { ContractFunctionRevertedError, encodeErrorResult, parseAbi } = await import('viem');
  const { StateConflictError } = await import('../src/config.mjs');
  const abi = parseAbi(['error EntityNotFound(bytes32 entityKey)']);
  const priorKey = keyOf(123);
  const f = fixture();
  f.store.walletClient.executeBatch = async () => {
    throw new Error('SDK wrapper', { cause: new ContractFunctionRevertedError({
      abi, data: encodeErrorResult({ abi, errorName: 'EntityNotFound', args: [priorKey] }), functionName: 'execute',
    }) });
  };
  await assert.rejects(f.store.write('invite', randomUUID(), { test: true }, { action: 'test' }, { entityKey: priorKey }), StateConflictError);
  await assert.rejects(f.store.write('invite', randomUUID(), { test: true }, { action: 'test' }, { entityKey: keyOf(456) }), (error) => error instanceof InputError && !(error instanceof StateConflictError));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHederaConnection, sessionAccounts } from '../public/hedera-wallet.mjs';

const TOPIC = 'a'.repeat(64);
const ACCOUNT = 'hedera:testnet:0.0.123';
const session = () => ({ topic: TOPIC, expiry: 2_000_000_000, namespaces: { hedera: { methods: ['hedera_signMessage'], accounts: [ACCOUNT] } } });
class Client extends EventEmitter {
  requested; closed = [];
  pairingsClosed = [];
  core = { pairing: { disconnect: async ({ topic }) => { this.pairingsClosed.push(topic); } } };
  approval = async () => session();
  async connect(options) { this.requested = options; return { uri: `wc:${TOPIC}@2?symKey=test`, approval: this.approval }; }
  async disconnect({ topic }) { this.closed.push(topic); }
}
const makeConnection = (client) => createHederaConnection({ createClient: async () => client, onChange() {}, now: () => 1_000_000_000_000 });

test('accepts numeric native testnet IDs, rejects aliases, wrong networks, bad scopes and expiry', () => {
  assert.deepEqual(sessionAccounts(session(), 0), [ACCOUNT]);
  for (const account of ['hedera:mainnet:0.0.123', 'eip155:296:0x123', 'hedera:testnet:0.0.0', 'hedera:testnet:0.0.001', 'hedera:testnet:0.0.9999999999999999999']) {
    const invalid = session(); invalid.namespaces.hedera.accounts = [account];
    assert.throws(() => sessionAccounts(invalid, 0));
  }
  const invalid = session(); invalid.namespaces.hedera.methods = ['hedera_signTransaction'];
  assert.throws(() => sessionAccounts(invalid, 0));
  assert.throws(() => sessionAccounts(session(), 2_000_000_000_000));
});

test('pairing requests only message-signing capability and requires explicit account selection', async () => {
  const client = new Client(); const connection = makeConnection(client);
  await connection.connect();
  assert.deepEqual(client.requested.requiredNamespaces.hedera.methods, ['hedera_signMessage']);
  assert.deepEqual(client.requested.requiredNamespaces.hedera.chains, ['hedera:testnet']);
  assert.equal(connection.getState().status, 'select-account');
  assert.equal(connection.getState().account, null);
  connection.selectAccount(ACCOUNT);
  assert.equal(connection.getState().account, ACCOUNT);
  assert.match(connection.getState().message, /not yet verified/);
});

test('session updates clear the selected account and do not allow reuse of stale account lists', async () => {
  const client = new Client(); const connection = makeConnection(client);
  await connection.connect(); connection.selectAccount(ACCOUNT);
  client.emit('session_update', { topic: 'other' });
  assert.equal(connection.getState().account, ACCOUNT);
  client.emit('session_update', { topic: TOPIC });
  connection.selectAccount(ACCOUNT);
  assert.equal(connection.getState().status, 'changed');
  assert.equal(connection.getState().account, null);
});

test('canceling pending pairing discards and disconnects a late approval', async () => {
  const client = new Client(); let approve; let pairing;
  client.approval = () => new Promise((resolve) => { approve = resolve; });
  const announced = new Promise((resolve) => { pairing = resolve; });
  const connection = createHederaConnection({ createClient: async () => client, onChange(state) { if (state.status === 'pairing') pairing(); } });
  const pending = connection.connect();
  await announced;
  await connection.forget();
  approve(session()); await pending;
  assert.equal(connection.getState().account, null);
  assert.equal(connection.getState().uri, null);
  assert.deepEqual(client.closed, [TOPIC]);
  assert.deepEqual(client.pairingsClosed, [TOPIC]);
});

test('expired sessions, rejection, initialization failure and invalid accounts remain unverified', async () => {
  const client = new Client(); const connection = makeConnection(client);
  await connection.connect(); connection.selectAccount('hedera:testnet:0.0.456');
  assert.equal(connection.getState().status, 'changed');
  await connection.connect(); connection.selectAccount(ACCOUNT);
  client.emit('session_expire', { topic: TOPIC });
  assert.equal(connection.getState().account, null);
  client.approval = async () => { throw new Error('private transport info'); };
  await connection.connect();
  assert.equal(connection.getState().status, 'error');
  assert.doesNotMatch(connection.getState().message, /private transport/);
  const failed = createHederaConnection({ createClient: async () => { throw new Error('secret'); }, onChange() {} });
  await failed.connect();
  assert.equal(failed.getState().status, 'error');
});

test('cancel and retry during initialization share one client and install listeners once', async () => {
  const client = new Client(); let initialize; let calls = 0;
  const initialization = new Promise((resolve) => { initialize = resolve; });
  const connection = createHederaConnection({ createClient: () => { calls++; return initialization; }, onChange() {}, now: () => 0 });
  const first = connection.connect();
  await connection.forget();
  const second = connection.connect();
  initialize(client);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(client.listenerCount('session_update'), 1);
  assert.equal(connection.getState().status, 'select-account');
});

test('fan mode: chain + method are parameters (mainnet, hedera_signTransaction); request() only on the selected account', async () => {
  const MAIN = 'hedera:mainnet:0.0.456';
  const s = () => ({ topic: TOPIC, expiry: 2_000_000_000, namespaces: { hedera: { methods: ['hedera_signTransaction'], accounts: [MAIN] } } });
  assert.deepEqual(sessionAccounts(s(), 0, { chain: 'hedera:mainnet', method: 'hedera_signTransaction' }), [MAIN]);
  assert.throws(() => sessionAccounts(s(), 0), 'defaults stay testnet + signMessage');
  assert.throws(() => sessionAccounts(s(), 0, { chain: 'hedera:previewnet', method: 'hedera_signTransaction' }), /Unsupported/);
  const client = new Client();
  client.approval = async () => s();
  const requests = [];
  client.request = async (r) => { requests.push(r); return { signatureMap: 'c2ln' }; };
  const connection = createHederaConnection({ createClient: async () => client, onChange() {}, now: () => 1_000_000_000_000, chain: 'hedera:mainnet', methods: ['hedera_signTransaction'], messages: { connected: 'paying from this account' } });
  await assert.rejects(connection.request('hedera_signTransaction', {}), /Connect and select/);
  await connection.connect();
  assert.deepEqual(client.requested.requiredNamespaces.hedera, { chains: ['hedera:mainnet'], methods: ['hedera_signTransaction'], events: ['accountsChanged', 'chainChanged'] });
  connection.selectAccount(MAIN);
  assert.equal(connection.getState().message, 'paying from this account');
  await assert.rejects(connection.request('hedera_signAndExecuteTransaction', {}), /not requested/);
  assert.deepEqual(await connection.request('hedera_signTransaction', { transactionBody: 'AA==' }), { signatureMap: 'c2ln' });
  assert.deepEqual(requests, [{ topic: TOPIC, chainId: 'hedera:mainnet', request: { method: 'hedera_signTransaction', params: { transactionBody: 'AA==' } } }]);
});

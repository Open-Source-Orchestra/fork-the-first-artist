import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createEthereumConnection, discoverMetaMask } from '../public/ethereum-wallet.mjs';

const ADDRESS = '0x' + '1'.repeat(40);
class Wallet extends EventEmitter {
  chain = '0x1';
  accounts = [ADDRESS];
  calls = [];
  async request({ method }) {
    this.calls.push(method);
    if (method === 'eth_chainId') return this.chain;
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return this.accounts;
    throw new Error('Unexpected wallet capability');
  }
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('connect requests only account access and reads; mainnet remains unverified', async () => {
  const wallet = new Wallet();
  const connection = createEthereumConnection(() => {});
  await connection.connect(wallet);
  assert.equal(connection.getState().status, 'connected');
  assert.equal(connection.getState().account, ADDRESS);
  assert.match(connection.getState().message, /not yet verified/);
  assert.deepEqual(wallet.calls, ['eth_requestAccounts', 'eth_chainId', 'eth_accounts']);
  assert.ok(Object.isFrozen(connection.getState()));
});

test('wrong networks cannot appear ready and are never switched automatically', async () => {
  const wallet = new Wallet(); wallet.chain = '0xaa36a7';
  const connection = createEthereumConnection(() => {});
  await connection.connect(wallet);
  assert.equal(connection.getState().status, 'wrong-network');
  assert.ok(!wallet.calls.includes('wallet_switchEthereumChain'));
});

test('account/network changes and disconnect immediately clear the selected address', async () => {
  const wallet = new Wallet();
  const connection = createEthereumConnection(() => {});
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
    await connection.connect(wallet);
    wallet.emit(event, []);
    assert.equal(connection.getState().account, null);
    assert.notEqual(connection.getState().status, 'connected');
  }
  assert.equal(wallet.listenerCount('accountsChanged'), 0);
});

test('forgetting a pending connection discards its eventual result and prevents duplicate prompts', async () => {
  const wallet = new Wallet(); const pending = deferred();
  wallet.request = async ({ method }) => { wallet.calls.push(method); return pending.promise; };
  const connection = createEthereumConnection(() => {});
  const first = connection.connect(wallet);
  await connection.connect(wallet);
  connection.forget();
  pending.resolve([ADDRESS]);
  await first;
  assert.equal(connection.getState().status, 'disconnected');
  assert.equal(connection.getState().account, null);
  assert.deepEqual(wallet.calls, ['eth_requestAccounts']);
  assert.equal(wallet.listenerCount('chainChanged'), 0);
});

test('initial account event is allowed, but changes between reads invalidate the result', async () => {
  const wallet = new Wallet(); const original = wallet.request.bind(wallet);
  wallet.request = async (args) => {
    if (args.method === 'eth_requestAccounts') wallet.emit('accountsChanged', [ADDRESS]);
    return original(args);
  };
  const connection = createEthereumConnection(() => {});
  await connection.connect(wallet);
  assert.equal(connection.getState().status, 'connected');
  wallet.request = async (args) => {
    if (args.method === 'eth_chainId') wallet.emit('chainChanged', '0x2');
    return original(args);
  };
  await connection.connect(wallet);
  assert.equal(connection.getState().status, 'changed');
  assert.equal(connection.getState().account, null);
});

test('rejections, empty accounts, and malformed responses never retain a connected identity', async () => {
  const connection = createEthereumConnection(() => {});
  for (const code of [4001, -32002, 42]) {
    const wallet = new Wallet();
    wallet.request = async () => { throw { code, message: 'sensitive provider internals' }; };
    await connection.connect(wallet);
    assert.equal(connection.getState().status, 'error');
    assert.doesNotMatch(connection.getState().message, /sensitive/);
  }
  for (const accounts of [[], ['not an address'], null, '0x123']) {
    const wallet = new Wallet(); wallet.accounts = accounts;
    await connection.connect(wallet);
    assert.equal(connection.getState().account, null);
    assert.notEqual(connection.getState().status, 'connected');
  }
  for (const chain of [null, 1, 'invalid', '0x' + 'f'.repeat(65)]) {
    const wallet = new Wallet(); wallet.chain = chain;
    await connection.connect(wallet);
    assert.equal(connection.getState().status, 'error');
    assert.equal(connection.getState().account, null);
  }
});

test('discovery filters metadata, deduplicates providers and cleans up without requesting accounts', () => {
  const target = new EventTarget(); let found = []; let requests = 0;
  target.addEventListener('eip6963:requestProvider', () => { requests++; });
  const stop = discoverMetaMask(target, (entries) => { found = entries; });
  const wallet = new Wallet();
  const announce = (rdns, uuid, provider = wallet) => target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { rdns, uuid }, provider } }));
  announce('other.wallet', 'a');
  assert.equal(found.length, 0);
  announce('io.metamask', 'a'); announce('io.metamask', 'b');
  assert.equal(found.length, 1);
  assert.equal(requests, 1);
  assert.deepEqual(wallet.calls, []);
  stop(); announce('io.metamask', 'c', new Wallet());
  assert.equal(found.length, 1);
});

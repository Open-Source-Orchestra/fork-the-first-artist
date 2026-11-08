import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  ABIS, COIN, buildTx, checkSigner, decodeHbar, describePlan, dnsEncode, effectivePayout, encodeHbar, evmCoinFor,
  fullName, makeRpc, parseLabel, planPayout, revertReason,
} from '../public/payout-plan.mjs';
import { decodeFunctionData, encodeErrorResult, encodeFunctionData, toFunctionSelector } from '../../ens/node_modules/viem/_esm/index.js';
import { dnsEncode as ensDnsEncode, setAddressTx } from '../../ens/src/plan.mjs';
import { encodeHbar as ensEncodeHbar } from '../../ens/src/hbar.mjs';
import { COIN as ENS_COIN, TEXT as ENS_TEXT } from '../../ens/src/constants.mjs';

const require = createRequire(import.meta.url);
const RESOLVER_ABI = require('../../ens/abi/PermissionedResolverImpl.json');
const UR_ABI = require('../../ens/abi/UniversalResolverV2.json');
const REGISTRY_ABI = require('../../ens/abi/UserRegistryImpl.json');

const OWNER = '0x25965899f4600b3AA5362ee4f34be95E5E62c934';
const RESOLVER = '0xdDFf981748Ec5F6D6618D830E90ba964DaA60Fb1';
const rec = (over = {}) => ({ records: { eth: OWNER, hbarRaw: null, hbarAccount: null, evmTestnet: OWNER, evmMainnet: null, network: 'testnet', consent: 'active', stewardStatus: null, ...over } });

test('labels: lowercase single labels only, full names accepted', () => {
  assert.equal(parseLabel(' Shaka '), 'shaka');
  assert.equal(parseLabel('shaka.osoartist.eth'), 'shaka');
  assert.equal(fullName('dj-chalk'), 'dj-chalk.osoartist.eth');
  for (const bad of ['', '-a', 'a-', 'a.b', 'a b', 'ünï', 'x'.repeat(64), 'shaka.eth']) assert.throws(() => parseLabel(bad), /label/, bad);
});

test('constants and encodings are byte-identical to the ENS leg (ens/src)', () => {
  assert.equal(COIN.HBAR, ENS_COIN.HBAR);
  assert.equal(COIN.HEDERA_TESTNET_EVM, ENS_COIN.HEDERA_TESTNET_EVM);
  assert.equal(COIN.HEDERA_MAINNET_EVM, ENS_COIN.HEDERA_MAINNET_EVM);
  assert.equal(evmCoinFor('mainnet'), 0x80000127n);
  assert.equal(evmCoinFor('testnet'), 0x80000128n);
  assert.throws(() => evmCoinFor('previewnet'));
  for (const n of ['shaka.osoartist.eth', 'dj-chalk.osoartist.eth', '0xmentalist.osoartist.eth']) assert.equal(dnsEncode(n), ensDnsEncode(n), n);
  for (const id of ['0.0.1', '0.0.11345896', '0.0.11347291', '1.2.3', '4294967295.18446744073709551615.18446744073709551615']) {
    assert.equal(encodeHbar(id), ensEncodeHbar(id), id);
    assert.equal(decodeHbar(encodeHbar(id)), id);
  }
  assert.throws(() => encodeHbar('0.0.x'));
  assert.throws(() => encodeHbar('4294967296.0.1'), /range/);
  assert.equal(decodeHbar('0x1234'), null);
});

test('ABI fragments match the deployed contract ABIs (same selectors)', () => {
  const sel = (abi, name) => abi.filter((x) => x.type === 'function' && x.name === name).map((x) => toFunctionSelector(x));
  for (const fn of ['setAddress', 'setText', 'multicall']) assert.deepEqual(sel(ABIS.resolver, fn), sel(RESOLVER_ABI, fn), fn);
  for (const fn of ['resolve', 'findResolver']) assert.deepEqual(sel(ABIS.universalResolver, fn), sel(UR_ABI, fn), fn);
  assert.deepEqual(sel(ABIS.registry, 'findOwner'), sel(REGISTRY_ABI, 'findOwner'));
  assert.equal(ENS_TEXT.network, 'hedera.network');
});

test('Hedera account on mainnet: addr(3030) + hedera.network=mainnet, same calldata as ens/src/plan.mjs', () => {
  const plan = planPayout({ label: 'shaka', network: 'mainnet', mode: 'account', accountId: '0.0.4242', current: rec() });
  assert.equal(plan.name, 'shaka.osoartist.eth');
  assert.deepEqual(plan.writes.map((w) => [w.kind, String(w.coinType ?? w.key), w.value]), [
    ['addr', '3030', encodeHbar('0.0.4242')],
    ['text', 'hedera.network', 'mainnet'],
  ]);
  assert.equal(plan.calls[0], setAddressTx({ resolver: RESOLVER, name: plan.name, coinType: 3030n, value: encodeHbar('0.0.4242') }).data);
  assert.deepEqual(plan.expected, { path: 'hbar', payTo: '0.0.4242' });
  assert.ok(plan.warnings.some((w) => /tips on Hedera testnet are refused/.test(w)));
  assert.ok(plan.warnings.some((w) => /MAINNET account you control/.test(w)));
  const tx = buildTx(plan, RESOLVER.toLowerCase());
  assert.equal(tx.to, RESOLVER);
  assert.equal(tx.value, '0x0');
  const { functionName, args } = decodeFunctionData({ abi: RESOLVER_ABI, data: tx.data });
  assert.equal(functionName, 'multicall');
  assert.deepEqual(args[0], plan.calls);
  const text = decodeFunctionData({ abi: RESOLVER_ABI, data: plan.calls[1] });
  assert.deepEqual(text.args, [dnsEncode('shaka.osoartist.eth'), 'hedera.network', 'mainnet']);
  const lines = describePlan(plan, RESOLVER).join('\n');
  assert.match(lines, /addr 3030 · Hedera account ← 0\.0\.4242 \(Hedera mainnet account\)/);
  assert.match(lines, /text hedera\.network ← mainnet/);
  assert.match(lines, /tip on Hedera mainnet pays: 0\.0\.4242 \(hbar\)/);
});

test('"my wallet address" on mainnet: ENSIP-11 0x80000127 record, and an old addr(3030) is CLEARED so it cannot outrank it', () => {
  const withOld = planPayout({ label: 'shaka', network: 'mainnet', mode: 'wallet', walletAddress: OWNER.toLowerCase(), current: rec({ hbarRaw: encodeHbar('0.0.11345896'), hbarAccount: '0.0.11345896' }) });
  assert.deepEqual(withOld.writes.map((w) => [String(w.coinType ?? w.key), w.value]), [
    ['3030', '0x'],
    [String(0x80000127n), OWNER.toLowerCase()],
    ['hedera.network', 'mainnet'],
  ]);
  assert.match(withOld.writes[0].human, /cleared \(was 0\.0\.11345896\)/);
  assert.deepEqual(withOld.expected, { path: 'hedera-evm', payTo: OWNER });
  assert.ok(withOld.warnings.some((w) => /USDC cannot reach/.test(w)));
  const clean = planPayout({ label: 'shaka', network: 'mainnet', mode: 'wallet', walletAddress: OWNER, current: rec() });
  assert.equal(clean.writes.length, 2, 'no clear when there is no addr(3030)');
  const unknown = planPayout({ label: 'shaka', network: 'testnet', mode: 'wallet', walletAddress: OWNER, current: null });
  assert.equal(String(unknown.writes[0].coinType), '3030', 'records unknown → clear defensively');
  assert.equal(String(unknown.writes[1].coinType), String(0x80000128n));
  assert.equal(buildTx(clean, RESOLVER).data.slice(0, 10), toFunctionSelector('multicall(bytes[])'));
});

test('bad inputs never produce a transaction', () => {
  assert.throws(() => planPayout({ label: 'shaka', network: 'mainnet', mode: 'account', accountId: 'abc' }), /Hedera account/);
  assert.throws(() => planPayout({ label: 'shaka', network: 'mainnet', mode: 'wallet' }), /connect the wallet/);
  assert.throws(() => planPayout({ label: 'shaka', network: 'devnet', mode: 'account', accountId: '0.0.1' }), /network/);
  assert.throws(() => planPayout({ label: 'shaka', network: 'mainnet', mode: 'other' }), /choose/);
  const plan = planPayout({ label: 'shaka', network: 'testnet', mode: 'account', accountId: '0.0.1', current: rec() });
  assert.throws(() => buildTx(plan, null), /no resolver/);
  assert.throws(() => buildTx(plan, '0x0000000000000000000000000000000000000000'), /no resolver/);
  assert.ok(!plan.warnings.some((w) => /refused/.test(w)), 'no network flip warning when staying on testnet');
  const noConsent = planPayout({ label: 'shaka', network: 'testnet', mode: 'account', accountId: '0.0.1', current: rec({ consent: null }) });
  assert.ok(noConsent.warnings.some((w) => /oso\.consent is "unset"/.test(w)));
});

test('signer gate: only the name owner is ever asked to sign', () => {
  assert.equal(checkSigner({ owner: OWNER, account: OWNER.toLowerCase() }).ok, true);
  const other = checkSigner({ owner: OWNER, account: '0x000000000000000000000000000000000000dEaD' });
  assert.equal(other.ok, false);
  assert.match(other.reason, /is not the owner of this name \(0x2596/);
  assert.equal(checkSigner({ owner: null, account: OWNER }).ok, false);
  assert.equal(checkSigner({ owner: '0x0000000000000000000000000000000000000000', account: OWNER }).ok, false);
  assert.match(checkSigner({ owner: OWNER, account: null }).reason, /connect/);
});

test('payout priority mirrors resolvePayTo: 3030 > Hedera EVM for that network > addr(60)', () => {
  const r = rec({ hbarAccount: '0.0.9', evmMainnet: '0x000000000000000000000000000000000000bEEF' }).records;
  assert.deepEqual(effectivePayout(r, 'mainnet'), { path: 'hbar', payTo: '0.0.9' });
  assert.deepEqual(effectivePayout({ ...r, hbarAccount: null }, 'mainnet'), { path: 'hedera-evm', payTo: '0x000000000000000000000000000000000000bEEF' });
  assert.deepEqual(effectivePayout({ ...r, hbarAccount: null, evmMainnet: null }, 'mainnet'), { path: 'eth-alias', payTo: OWNER });
  assert.deepEqual(effectivePayout({}, 'testnet'), { path: null, payTo: null });
});

test('revert reasons decode the resolver role error', () => {
  const data = encodeErrorResult({ abi: RESOLVER_ABI, errorName: 'EACUnauthorizedAccountRoles', args: [1n, 1n, '0x000000000000000000000000000000000000dEaD'] });
  assert.match(revertReason(data), /0x000000000000000000000000000000000000dEaD does not hold the record roles/);
  assert.equal(revertReason('0x'), null);
  assert.equal(revertReason(42), null);
});

test('JSON-RPC: falls back past an outage, but a revert is an answer (no retry on the next RPC)', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    const { id } = JSON.parse(init.body);
    if (url === 'https://a.example') return new Response('busy', { status: 429 });
    if (url === 'https://b.example') {
      const { params } = JSON.parse(init.body);
      if (params[0].to === '0x00000000000000000000000000000000000000ff') return Response.json({ jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted', data: '0xdeadbeef' } });
      return Response.json({ jsonrpc: '2.0', id, result: '0x01' });
    }
    return Response.json({ jsonrpc: '2.0', id, result: '0x02' });
  };
  const rpc = makeRpc(['https://a.example', 'https://b.example', 'https://c.example'], fetchImpl);
  assert.equal(await rpc.call({ to: '0x0000000000000000000000000000000000000001', data: '0x' }), '0x01');
  assert.deepEqual(seen, ['https://a.example', 'https://b.example']);
  seen.length = 0;
  await assert.rejects(rpc.call({ to: '0x00000000000000000000000000000000000000ff', data: '0x' }), (e) => e.revert === '0xdeadbeef');
  assert.deepEqual(seen, ['https://a.example', 'https://b.example'], 'did not try c after a revert');
  assert.throws(() => makeRpc([]), /no RPC/);
  // sanity: the encoded findOwner call is what the registry expects
  assert.equal(encodeFunctionData({ abi: ABIS.registry, functionName: 'findOwner', args: ['shaka'] }).slice(0, 10), toFunctionSelector('findOwner(string)'));
});

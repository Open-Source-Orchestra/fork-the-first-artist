import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeFunctionData, parseAbi, toCoinType } from '../../ens/node_modules/viem/_esm/index.js';
import {
  toAtomic, fromAtomic, splitTip, parseAmount, encodeTransfer, encodeBalanceOf, decodeString, coinTypeFor, pickPayout, planTip,
  checkLegReceipt, nextLeg, legsEqual, validRecord, txFor, addChainParams, usdOf, freshPrice, walletErrorText, TRANSFER_TOPIC, isContractCode, explorerTx, newTipId,
} from '../public/tip-core.mjs';

const FAN = '0x1111111111111111111111111111111111111111';
const ART = '0x2222222222222222222222222222222222222222';
const STW = '0x3333333333333333333333333333333333333333';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const erc20 = { kind: 'erc20', address: USDC, decimals: 6, symbol: 'USDC' };

test('toAtomic / fromAtomic round-trip in integer base units (6 and 18 decimals)', () => {
  assert.equal(toAtomic('1', 6), 1_000_000n);
  assert.equal(toAtomic('0.01', 6), 10_000n);
  assert.equal(toAtomic('.5', 6), 500_000n);
  assert.equal(toAtomic('12.345678', 6), 12_345_678n);
  assert.equal(toAtomic('12.3456789', 6), null, 'too many decimals is refused, never rounded');
  assert.equal(toAtomic('1', 18), 10n ** 18n, 'Binance-Peg USDC has 18 decimals');
  assert.equal(toAtomic('0.01', 18), 10n ** 16n);
  for (const bad of ['', ' ', '-1', '1e3', '0x10', '1,5,0', 'abc', '1.2.3', 'Infinity', 'NaN']) assert.equal(toAtomic(bad, 6), null, bad);
  assert.equal(fromAtomic(12_345_678n, 6), '12.345678');
  assert.equal(fromAtomic(10n ** 16n, 18), '0.01');
  assert.equal(fromAtomic(1_000_000n, 6), '1');
});

test('split: steward = floor(3.69%), artist = the rest, always sums exactly (exhaustive + random)', () => {
  assert.deepEqual(splitTip(1_000_000n), { total: 1_000_000n, artist: 963_100n, steward: 36_900n });
  for (let t = 1n; t <= 30_000n; t++) {
    const s = splitTip(t);
    assert.equal(s.artist + s.steward, t);
    assert.ok(s.steward <= (t * 369n) / 10000n && s.artist >= (t * 9631n) / 10000n);
  }
  for (let i = 0; i < 3000; i++) {
    const t = BigInt(Math.floor(Math.random() * 1e15)) * 1000n + 1n;
    const s = splitTip(t);
    assert.equal(s.artist + s.steward, t);
  }
  assert.throws(() => splitTip(0n));
});

test('parseAmount enforces min/max and refuses dust that cannot be split', () => {
  assert.equal(parseAmount('5', 6, { min: '0.01', max: '250', symbol: 'USDC' }).artist, 4_815_500n);
  assert.equal(parseAmount('251', 6, { min: '0.01', max: '250', symbol: 'USDC' }).ok, false);
  assert.equal(parseAmount('0.001', 6, { min: '0.01', max: '250', symbol: 'USDC' }).ok, false);
  assert.equal(parseAmount('ten', 6, { min: '0.01', max: '250', symbol: 'USDC' }).ok, false);
  const bnb = parseAmount('2.5', 18, { min: '0.01', max: '250', symbol: 'USDC' });
  assert.equal(bnb.total, 25n * 10n ** 17n);
  assert.equal(bnb.artist + bnb.steward, bnb.total);
});

test('encodeTransfer matches viem encodeFunctionData exactly', () => {
  const abi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
  for (const amt of [1n, 963_100n, 10n ** 18n * 123n, 2n ** 255n]) {
    assert.equal(encodeTransfer(ART, amt), encodeFunctionData({ abi, functionName: 'transfer', args: [ART, amt] }));
  }
  assert.equal(encodeBalanceOf(FAN), encodeFunctionData({ abi, functionName: 'balanceOf', args: [FAN] }));
  assert.throws(() => encodeTransfer('0x12', 1n));
  assert.throws(() => encodeTransfer(ART, 0n));
});

test('decodeString reads ABI strings and bytes32 symbols', () => {
  const usdc = '0x' + (32).toString(16).padStart(64, '0') + (4).toString(16).padStart(64, '0') + Buffer.from('USDC').toString('hex').padEnd(64, '0');
  assert.equal(decodeString(usdc), 'USDC');
  assert.equal(decodeString('0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0')), 'MKR');
  assert.equal(decodeString('0x'), null);
});

test('coin types follow ENSIP-11 and agree with viem toCoinType', () => {
  assert.equal(coinTypeFor(1), 60n);
  for (const id of [8453, 10, 42161, 480, 130, 59144, 324, 42220, 57073, 137, 56, 534352, 7777777]) assert.equal(coinTypeFor(id), BigInt(toCoinType(id)));
});

test('pickPayout: chain record > default EVM > ETH record only for key-held wallets', () => {
  assert.equal(pickPayout({ chainId: 8453, specific: ART, defaultEvm: STW, eth: FAN }).address, ART);
  assert.equal(pickPayout({ chainId: 8453, specific: null, defaultEvm: STW, eth: FAN }).address, STW);
  const viaEth = pickPayout({ chainId: 8453, eth: ART, ethCodeOnMainnet: '0x', codeOnTarget: '0x' });
  assert.equal(viaEth.address, ART);
  assert.equal(pickPayout({ chainId: 8453, eth: ART, ethCodeOnMainnet: '0x', codeOnTarget: '0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b' }).ok, true, 'EIP-7702 delegated EOA is still key-held');
  assert.equal(pickPayout({ chainId: 8453, eth: ART, ethCodeOnMainnet: '0x6080604052', codeOnTarget: '0x' }).code, 'contract-wallet');
  assert.equal(pickPayout({ chainId: 8453, eth: ART, ethCodeOnMainnet: '0x', codeOnTarget: '0x6080' }).code, 'contract-wallet');
  assert.equal(pickPayout({ chainId: 8453, eth: ART, ethCodeOnMainnet: null, codeOnTarget: '0x' }).code, 'unchecked');
  assert.equal(pickPayout({ chainId: 8453, eth: '0x0000000000000000000000000000000000000000' }).code, 'no-address');
  assert.equal(pickPayout({ chainId: 1, eth: ART }).address, ART);
  assert.equal(isContractCode('0x'), false);
});

test('planTip builds exactly two plain transfers, merges a shared payee, refuses self-tips', () => {
  const p = planTip({ chainId: 8453, asset: erc20, fan: FAN, artist: { address: ART, label: 'shaka.osoartist.eth' }, steward: { address: STW, label: 'osoartist.eth' }, total: 1_000_000n });
  assert.equal(p.ok, true);
  assert.equal(p.legs.length, 2);
  assert.equal(p.legs[0].tx.to, USDC);
  assert.equal(p.legs[0].tx.value, '0x0');
  assert.equal(p.legs[0].tx.chainId, '0x2105', 'every tx carries its chainId');
  assert.equal(p.legs[0].tx.data, encodeTransfer(ART, 963_100n));
  assert.equal(p.legs[1].tx.data, encodeTransfer(STW, 36_900n));
  const same = planTip({ chainId: 8453, asset: erc20, fan: FAN, artist: { address: ART }, steward: { address: ART }, total: 1_000_000n });
  assert.equal(same.legs.length, 1);
  assert.equal(same.legs[0].amount, 1_000_000n);
  const native = planTip({ chainId: 10, asset: { kind: 'native', decimals: 18, symbol: 'ETH' }, fan: FAN, artist: { address: ART }, steward: { address: STW }, total: 10n ** 15n });
  assert.equal(native.legs[0].tx.to, ART);
  assert.equal(BigInt(native.legs[0].tx.value) + BigInt(native.legs[1].tx.value), 10n ** 15n);
  assert.equal(native.legs[0].tx.data, undefined);
  assert.equal(planTip({ chainId: 8453, asset: erc20, fan: ART, artist: { address: ART }, steward: { address: STW }, total: 1n }).ok, false);
  assert.equal(planTip({ chainId: 8453, asset: erc20, fan: FAN, artist: { address: USDC }, steward: { address: STW }, total: 100n }).ok, false);
  assert.equal(planTip({ chainId: 8453, asset: erc20, fan: FAN, artist: { address: null }, steward: { address: STW }, total: 100n }).ok, false);
});

const log = (from, to, value, address = USDC) => ({ address, topics: [TRANSFER_TOPIC, '0x' + from.slice(2).padStart(64, '0'), '0x' + to.slice(2).padStart(64, '0')], data: '0x' + value.toString(16).padStart(64, '0') });
test('checkLegReceipt accepts only the exact Transfer (or exact native send)', () => {
  const leg = { to: ART, amount: 963_100n };
  assert.equal(checkLegReceipt({ asset: erc20, fan: FAN, leg, receipt: null }).done, false);
  assert.equal(checkLegReceipt({ asset: erc20, fan: FAN, leg, receipt: { status: '0x1', logs: [log(FAN, ART, 963_100n)] } }).ok, true);
  assert.equal(checkLegReceipt({ asset: erc20, fan: FAN, leg, receipt: { status: '0x0', logs: [] } }).ok, false);
  assert.equal(checkLegReceipt({ asset: erc20, fan: FAN, leg, receipt: { status: '0x1', logs: [log(FAN, STW, 963_100n)] } }).ok, false);
  assert.equal(checkLegReceipt({ asset: erc20, fan: FAN, leg, receipt: { status: '0x1', logs: [log(FAN, ART, 1n)] } }).ok, false);
  assert.equal(checkLegReceipt({ asset: erc20, fan: FAN, leg, receipt: { status: '0x1', logs: [log(FAN, ART, 963_100n, STW)] } }).ok, false, 'Transfer from a different token contract does not count');
  const nat = { kind: 'native', decimals: 18 };
  assert.equal(checkLegReceipt({ asset: nat, fan: FAN, leg, receipt: { status: '0x1' }, tx: { from: FAN, to: ART, value: '0xeb21c' } }).ok, true);
  assert.equal(checkLegReceipt({ asset: nat, fan: FAN, leg, receipt: { status: '0x1' }, tx: { from: FAN, to: STW, value: '0xeb21c' } }).ok, false);
});

test('nextLeg: a sent leg is only waited on; unclear legs need a nonce check; mismatch stops', () => {
  assert.equal(nextLeg({ legs: [{ state: 'planned' }, { state: 'planned' }] }).action, 'send');
  assert.equal(nextLeg({ legs: [{ state: 'sent' }, { state: 'planned' }] }).action, 'wait');
  const r = nextLeg({ legs: [{ state: 'confirmed' }, { state: 'rejected', leg: 'steward' }] });
  assert.equal(r.action, 'check');
  assert.equal(r.leg.leg, 'steward');
  assert.equal(nextLeg({ legs: [{ state: 'unknown' }] }).action, 'check', 'a non-4001 wallet error is never auto-resent');
  assert.equal(nextLeg({ legs: [{ state: 'replaced' }] }).action, 'check');
  assert.equal(nextLeg({ legs: [{ state: 'failed' }] }).action, 'send', 'a reverted tx moved nothing');
  assert.equal(nextLeg({ legs: [{ state: 'confirmed' }, { state: 'confirmed' }] }).action, 'done');
  assert.equal(nextLeg({ legs: [{ state: 'mismatch' }] }).action, 'stop');
  assert.equal(nextLeg({ legs: [{ state: 'weird' }] }).action, 'stop');
});

test('legsEqual + validRecord: a stored tip can only continue if a fresh plan is identical; junk records are ignored', () => {
  const a = [{ to: ART, amount: 963_100n }, { to: STW, amount: 36_900n }];
  assert.equal(legsEqual(a, [{ to: ART.toLowerCase(), amount: '963100' }, { to: STW, amount: '36900' }]), true);
  assert.equal(legsEqual(a, [{ to: '0x000000000000000000000000000000000000dEaD', amount: '963100' }, { to: STW, amount: '36900' }]), false, 'redirected payee');
  assert.equal(legsEqual(a, [{ to: ART, amount: '99000000' }, { to: STW, amount: '36900' }]), false, 'inflated amount');
  assert.equal(legsEqual(a, a.slice(0, 1)), false);
  const rec = { id: 'tip_0123456789abcdef0123', chainId: 8453, kind: 'single', fan: FAN, asset: { kind: 'erc20' }, total: '1000000', legs: [{ to: ART, amount: '963100', state: 'planned', hash: null }, { to: STW, amount: '36900', state: 'sent', hash: '0x' + 'a'.repeat(64) }] };
  assert.equal(validRecord(rec), true);
  assert.equal(validRecord({ ...rec, total: '999' }), false, 'legs must add up to the total');
  assert.equal(validRecord({ ...rec, total: 'NaN' }), false);
  assert.equal(validRecord({ ...rec, legs: [{ ...rec.legs[0], state: 'hacked' }, rec.legs[1]] }), false);
  assert.equal(validRecord({ ...rec, legs: [{ ...rec.legs[0], hash: 'javascript:1' }, rec.legs[1]] }), false);
  assert.equal(validRecord({ ...rec, id: 'x' }), false);
  assert.equal(validRecord(null), false);
});

test('decimal comma (es/fr/de/pt keyboards) is a decimal point; ENSIP-19 default record refuses a contract wallet missing on the target chain', () => {
  assert.equal(toAtomic('5,5', 6), 5_500_000n);
  assert.equal(toAtomic('1,000.5', 6), null, 'thousands separators are refused, never guessed');
  assert.equal(toAtomic('1,000', 6), null, '"1,000" is ambiguous → refused');
  assert.equal(toAtomic('2,25', 6), 2_250_000n);
  assert.equal(pickPayout({ chainId: 8453, defaultEvm: ART, defaultCodeOnMainnet: '0x6080', defaultCodeOnTarget: '0x' }).code, 'contract-wallet');
  assert.equal(pickPayout({ chainId: 8453, defaultEvm: ART, defaultCodeOnMainnet: '0x6080', defaultCodeOnTarget: '0x6080' }).ok, true);
  assert.equal(pickPayout({ chainId: 8453, defaultEvm: ART, defaultCodeOnMainnet: '0x', defaultCodeOnTarget: null }).code, 'unchecked');
  assert.equal(pickPayout({ chainId: 8453, defaultEvm: ART, defaultCodeOnMainnet: '0x', defaultCodeOnTarget: '0x' }).ok, true);
  assert.throws(() => txFor({ kind: 'native' }, FAN, ART, 1n), /chain id/);
});

test('the shipped chain table is complete, verified and consistent', () => {
  const t = JSON.parse(readFileSync(new URL('../public/tip-chains.json', import.meta.url), 'utf8'));
  const ids = new Set();
  for (const c of t.chains) {
    assert.ok(!ids.has(c.chainId), `duplicate ${c.chainId}`);
    ids.add(c.chainId);
    assert.match(c.explorer, /^https:\/\//);
    assert.ok(c.rpcUrls.length && c.rpcUrls.every((u) => u.startsWith('https://')));
    const p = addChainParams(c);
    assert.equal(p.chainId, '0x' + c.chainId.toString(16));
    assert.equal(p.nativeCurrency.decimals, 18);
    if (c.usdc) {
      assert.match(c.usdc.address, /^0x[0-9a-fA-F]{40}$/);
      assert.ok(c.usdc.verifiedOnchain);
      assert.equal(c.usdc.decimals, c.chainId === 56 ? 18 : 6, `${c.name} decimals`);
    }
    assert.ok(c.usdc || c.nativeTip, `${c.name} has nothing to tip with`);
  }
  // the issuer-listed addresses we rely on (Circle list + ethskills/addresses, cross-checked)
  const by = Object.fromEntries(t.chains.map((c) => [c.chainId, c.usdc?.address]));
  assert.equal(by[1], '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  assert.equal(by[8453], '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.equal(by[10], '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85');
  assert.equal(by[42161], '0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
  assert.equal(by[137], '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
  assert.equal(by[324], '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4');
  assert.equal(by[56], '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d');
  assert.notEqual(by[8453], '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', 'never bridged USDbC on Base');
  for (const gone of [1101, 81457, 4663, 1135, 167000]) assert.ok(!ids.has(gone), `${gone} must not be offered (Polygon zkEVM off, Blast RPC dead, Robinhood USDG, Lisk closed 2 Nov 2026, Taiko bridge-verification breach Jun 2026)`);
});

test('usd, price freshness, wallet error words, explorer links, ids', () => {
  assert.equal(usdOf(963_100n, 6, 'usdc'), '0.96');
  assert.equal(usdOf(10n ** 18n, 18, 'usdc'), '1.00');
  assert.equal(usdOf(10n ** 15n, 18, 'eth', 210385119570n), '2.10');
  assert.equal(usdOf(10n ** 15n, 18, 'eth', null), null);
  assert.equal(freshPrice({ answer: 210385119570n, updatedAt: 1000 }, 1000 + 3600), 210385119570n);
  assert.equal(freshPrice({ answer: 210385119570n, updatedAt: 1000 }, 1000 + 99999), null);
  assert.equal(freshPrice({ answer: -1n, updatedAt: 1000 }, 1000), null);
  assert.match(walletErrorText({ code: 4001 }), /declined/);
  assert.match(walletErrorText(new Error('insufficient funds for gas * price + value')), /gas token/);
  assert.equal(explorerTx({ explorer: 'https://basescan.org' }, '0x' + 'a'.repeat(64)), 'https://basescan.org/tx/0x' + 'a'.repeat(64));
  assert.equal(explorerTx({ explorer: 'https://basescan.org' }, 'javascript:alert(1)'), null);
  assert.match(newTipId(), /^tip_[0-9a-f]{20}$/);
});

import { planOrchestra, batchCalls, atomicSupport, callsStatus, checkBatchReceipts, sendCallsError } from '../public/tip-core.mjs';
const X = '0x4444444444444444444444444444444444444444';
const Y = '0x5555555555555555555555555555555555555555';

test('🎻 planOrchestra: equal shares across DISTINCT wallets, dust → steward, exact sum (random sweep)', () => {
  const p = planOrchestra({ chainId: 8453, asset: erc20, fan: FAN, steward: { address: STW, label: 'osoartist.eth' }, total: 1_000_001n,
    recipients: [{ slug: 'shaka', label: 'shaka.osoartist.eth', address: ART }, { slug: 'open-source-orchestra', label: 'osoartist.eth', address: ART.toUpperCase().replace('0X', '0x') }, { slug: 'x', label: 'x.eth', address: X }] });
  assert.equal(p.ok, true);
  assert.equal(p.split.wallets, 2, 'shaka + the orchestra share one wallet → counted once');
  assert.deepEqual(p.legs.map((l) => [l.to, l.amount]), [[ART, 481_550n], [X, 481_550n], [STW, 36_901n]]);
  assert.equal(p.legs[0].label, 'shaka.osoartist.eth + osoartist.eth');
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(Math.random() * 9);
    const rs = Array.from({ length: n }, (_, k) => ({ slug: `a${k}`, label: `a${k}`, address: '0x' + (k + 16).toString(16).padStart(40, '0') }));
    const t = BigInt(Math.floor(Math.random() * 1e12)) + 10_000n;
    const q = planOrchestra({ chainId: 56, asset: erc20, fan: FAN, steward: { address: STW, label: 's' }, total: t, recipients: rs });
    assert.equal(q.ok, true);
    assert.equal(q.legs.reduce((s, l) => s + l.amount, 0n), t);
    const shares = q.legs.filter((l) => l.leg === 'artist').map((l) => l.amount);
    assert.ok(shares.every((s) => s === shares[0]), 'equal shares');
    assert.ok(q.split.dust < BigInt(n));
  }
});

test('🎻 planOrchestra merges a recipient whose wallet IS the steward into ONE transfer (today: everything → 0x2596…)', () => {
  const p = planOrchestra({ chainId: 8453, asset: erc20, fan: FAN, steward: { address: ART, label: 'osoartist.eth' }, total: 5_000_000n,
    recipients: [{ slug: 'shaka', label: 'shaka.osoartist.eth', address: ART }, { slug: 'open-source-orchestra', label: 'osoartist.eth', address: ART }] });
  assert.equal(p.ok, true);
  assert.equal(p.legs.length, 1);
  assert.equal(p.legs[0].amount, 5_000_000n);
  assert.equal(p.legs[0].leg, 'artist+steward');
  const mixed = planOrchestra({ chainId: 8453, asset: erc20, fan: FAN, steward: { address: ART, label: 'osoartist.eth' }, total: 1_000_000n,
    recipients: [{ slug: 'shaka', label: 'shaka', address: ART }, { slug: 'y', label: 'y.eth', address: Y }] });
  assert.deepEqual(mixed.legs.map((l) => [l.to, l.amount]), [[Y, 481_550n], [ART, 518_450n]]);
});

test('🎻 planOrchestra refuses: nobody tippable, fan is a payee, dust too small', () => {
  assert.equal(planOrchestra({ chainId: 8453, asset: erc20, fan: FAN, steward: { address: STW }, total: 100n, recipients: [] }).ok, false);
  assert.equal(planOrchestra({ chainId: 8453, asset: erc20, fan: X, steward: { address: STW }, total: 1_000_000n, recipients: [{ slug: 'x', label: 'x', address: X }] }).ok, false);
  assert.equal(planOrchestra({ chainId: 8453, asset: erc20, fan: FAN, steward: { address: STW }, total: 5n, recipients: [{ slug: 'x', label: 'x', address: X }, { slug: 'y', label: 'y', address: Y }] }).ok, false);
});

test('🎻 EIP-5792 helpers: capabilities (v1 + v2), status codes, batch receipts', () => {
  assert.equal(atomicSupport({ '0x2105': { atomic: { status: 'supported' } } }, 8453), true);
  assert.equal(atomicSupport({ '0x2105': { atomic: { status: 'ready' } } }, 8453), false, "'ready' would upgrade the fan's account — never just for a tip");
  assert.equal(atomicSupport({ '0x0': { atomic: { status: 'supported' } } }, 8453), true, 'all-chains key');
  assert.equal(atomicSupport({ '0x2105': { atomic: { status: 'unsupported' } } }, 8453), false);
  assert.equal(atomicSupport({ '0x2105': { atomicBatch: { supported: true } } }, 8453), true);
  assert.equal(atomicSupport({ '0xa': { atomic: { status: 'supported' } } }, 8453), false, 'other chain does not count');
  assert.equal(atomicSupport(null, 8453), false);
  assert.equal(callsStatus({ status: 100 }), 'pending');
  assert.equal(callsStatus({ status: 'CONFIRMED' }), 'confirmed');
  assert.equal(callsStatus({ status: 200 }), 'confirmed');
  assert.equal(callsStatus({ status: 400 }), 'failed');
  assert.equal(callsStatus({ status: 600 }), 'unknown');
  const p = planOrchestra({ chainId: 8453, asset: erc20, fan: FAN, steward: { address: STW, label: 's' }, total: 1_000_000n, recipients: [{ slug: 'a', label: 'a', address: ART }, { slug: 'x', label: 'x', address: X }] });
  const calls = batchCalls(p);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.to === USDC && c.value === '0x0' && c.data.startsWith('0xa9059cbb')));
  const good = { status: '0x1', logs: p.legs.map((l) => log(FAN, l.to, l.amount)) };
  assert.equal(checkBatchReceipts({ asset: erc20, fan: FAN, legs: p.legs, receipts: [good] }).ok, true);
  assert.equal(checkBatchReceipts({ asset: erc20, fan: FAN, legs: p.legs, receipts: [{ status: '0x1', logs: good.logs.slice(0, 2) }] }).ok, false);
  assert.equal(checkBatchReceipts({ asset: erc20, fan: FAN, legs: p.legs, receipts: [{ ...good, status: '0x0' }] }).ok, false);
  assert.equal(checkBatchReceipts({ asset: erc20, fan: FAN, legs: p.legs, receipts: [] }).ok, false);
});

test('EIP-5792 error mapping: duplicate never falls back, unsupported does, 5750 is a rejection', () => {
  assert.equal(sendCallsError({ code: 4001 }), 'rejected');
  assert.equal(sendCallsError({ code: 5750 }), 'rejected');
  assert.equal(sendCallsError({ code: 5720 }), 'duplicate');
  for (const c of [5700, 5710, 5740, 5760, -32601, 4200]) assert.equal(sendCallsError({ code: c }), 'unsupported', String(c));
  assert.equal(sendCallsError({ code: -32603 }), 'unknown');
  assert.equal(nextLeg({ legs: [{ state: 'prompting' }] }).action, 'check', 'a prompt that never answered is never blindly re-sent');
});

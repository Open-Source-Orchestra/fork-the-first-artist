import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTransferBody, decodeSignatureMap, decodeTransactionBody } from '../public/hedera-body.mjs';
import { checkPrepared, describeSettle, directSplit, newTipId, pendingKey, signLegs } from '../public/fan-pay.mjs';

// REAL @hiero-ledger/sdk bodies (cloudflare/scripts/gen-wallet-fixtures.mjs)
const F = JSON.parse(readFileSync(new URL('./fixtures/wallet-legs.json', import.meta.url), 'utf8'));
const { fan, artist, steward, feePayer, usdc } = F.accounts;
const plan = (over = {}) => ({ fan, payTo: artist, amount: '96310000', asset: '0.0.0', feePayer, ...over });

test('decoder reads SDK-built bodies exactly: payer, node, validity, transfers (HBAR + USDC)', () => {
  const b = decodeTransactionBody(F.good.hbarArtist);
  assert.equal(b.payer, feePayer);
  assert.equal(b.transactionId, `${feePayer}@1794160800.000000000`);
  assert.equal(b.node, '0.0.3');
  assert.equal(b.validSeconds, 120n);
  assert.deepEqual(b.hbar.map((a) => [a.account, a.amount]), [[fan, -96310000n], [artist, 96310000n]]);
  assert.deepEqual(b.other, []);
  const u = decodeTransactionBody(F.good.usdcArtist);
  assert.deepEqual(u.hbar, []);
  assert.deepEqual(u.tokens[usdc].map((a) => [a.account, a.amount]), [[fan, -963100n], [artist, 963100n]]);
});

test('checkTransferBody accepts exactly the planned transfer and refuses every tampering', () => {
  assert.deepEqual(checkTransferBody(F.good.hbarArtist, plan()), []);
  assert.deepEqual(checkTransferBody(F.good.hbarSteward, plan({ payTo: steward, amount: '3690000' })), []);
  assert.deepEqual(checkTransferBody(F.good.usdcArtist, plan({ amount: '963100', asset: usdc })), []);
  const refuse = (b64, re, over = {}) => assert.match(checkTransferBody(b64, plan(over)).join(' | '), re);
  refuse(F.bad.extraRecipient, /not exactly/);
  refuse(F.bad.otherPayee, /not exactly/);
  refuse(F.bad.fanPaysFees, /fee payer is 0\.0\.11345895/);
  refuse(F.bad.withMemo, /memo/);
  refuse(F.bad.wrongAmount, /not exactly/);
  refuse(F.bad.approval, /not exactly/);
  refuse(F.good.hbarArtist, /token is none/, { asset: usdc });
  refuse(F.good.usdcArtist, /token transfers in an HBAR payment|not exactly/);
  assert.throws(() => decodeTransactionBody('not base64!'), /base64/);
});

test('signature map decode (ed25519 + ECDSA pairs)', () => {
  const enc = (field, bytes) => [field << 3 | 2, bytes.length, ...bytes];
  const pair = (type, pub, sig) => enc(1, [...enc(1, pub), ...enc(type, sig)]);
  const buf = Uint8Array.from([...pair(3, [1, 2, 3], [9, 9]), ...pair(6, [4, 5], [8])]);
  const pairs = decodeSignatureMap(buf);
  assert.deepEqual(pairs.map((p) => [p.type, [...p.pubKey], [...p.signature]]), [['ed25519', [1, 2, 3], [9, 9]], ['ecdsa', [4, 5], [8]]]);
});

test('directSplit mirrors the Worker: legs sum exactly, steward = floor(3.69%)', () => {
  assert.deepEqual([directSplit('1', 'HBAR').artist, directSplit('1', 'HBAR').steward], [96310000n, 3690000n]);
  assert.deepEqual([directSplit('0.5', 'USDC').artist, directSplit('0.5', 'USDC').steward], [481550n, 18450n]);
  for (const t of ['0.01', '0.33', '7.77777777']) { const s = directSplit(t, 'HBAR'); assert.equal(s.artist + s.steward, s.total); }
  assert.equal(directSplit('11', 'HBAR').ok, false);
  assert.equal(directSplit('0.001', 'USDC').ok, false);
  assert.equal(directSplit('6', 'USDC', '5').ok, false);
  assert.match(newTipId(), /^tip_[0-9a-f]{24}$/);
  assert.equal(pendingKey('shaka', 'testnet'), 'oso-fan-tip:testnet:shaka');
});

const record = (over = {}) => ({
  id: 'tip_x', state: 'prepared', network: 'hedera:testnet', currency: 'HBAR', total: '100000000', fan,
  artist: { label: 'shaka', ens: 'shaka.osoartist.eth', payTo: artist },
  legs: [
    { leg: 'artist', payTo: artist, amount: '96310000', status: 'prepared', bodyBytes: F.good.hbarArtist, feePayer, amountDisplay: '0.9631 HBAR' },
    { leg: 'steward', payTo: steward, amount: '3690000', status: 'prepared', bodyBytes: F.good.hbarSteward, feePayer, amountDisplay: '0.0369 HBAR' },
  ],
  ...over,
});
const want = { fan, network: 'testnet', currency: 'HBAR', artist: 'shaka', total: 100000000n, steward };

test('checkPrepared: refuses before any wallet prompt when the Worker prepared something else', () => {
  assert.deepEqual(checkPrepared(record(), want), []);
  assert.match(checkPrepared(record({ fan: '0.0.1' }), want).join(), /not your account/);
  assert.match(checkPrepared(record({ total: '200000000' }), want).join(), /you asked for/);
  const r = record();
  r.legs[1] = { ...r.legs[1], payTo: '0.0.666', bodyBytes: F.bad.otherPayee };
  assert.match(checkPrepared(r, want).join(), /steward leg pays 0\.0\.666/);
  const r2 = record();
  r2.legs[0] = { ...r2.legs[0], bodyBytes: F.bad.extraRecipient };
  assert.match(checkPrepared(r2, want).join(), /artist leg: .*not exactly/);
  const r3 = record({ legs: [record().legs[0]] });
  assert.match(checkPrepared(r3, want).join(), /exactly two legs/);
  const settled = record();
  settled.legs[0] = { ...settled.legs[0], status: 'settled', bodyBytes: null };
  assert.deepEqual(checkPrepared(settled, want), [], 'a settled leg is not re-checked or re-signed');
});

test('signLegs: one hedera_signTransaction per unsigned leg, in order, for the selected account; skips settled legs', async () => {
  const calls = [];
  const request = async (method, params) => { calls.push([method, params]); return { signatureMap: `sig-${calls.length}` }; };
  const legs = record().legs;
  assert.deepEqual(await signLegs(request, 'hedera:testnet', fan, legs), { artist: 'sig-1', steward: 'sig-2' });
  assert.deepEqual(calls.map(([m, p]) => [m, p.signerAccountId, p.transactionBody]), [
    ['hedera_signTransaction', `hedera:testnet:${fan}`, F.good.hbarArtist],
    ['hedera_signTransaction', `hedera:testnet:${fan}`, F.good.hbarSteward],
  ]);
  calls.length = 0;
  assert.deepEqual(await signLegs(request, 'hedera:testnet', fan, [{ ...legs[0], status: 'settled' }, legs[1]]), { steward: 'sig-1' });
  await assert.rejects(signLegs(async () => ({}), 'hedera:testnet', fan, legs), /no signature/);
});

test('describeSettle: complete / partial wording and only HashScan links', () => {
  const res = { state: 'partial', record: { artist: { ens: 'shaka.osoartist.eth' }, legs: [
    { leg: 'artist', status: 'settled', amountDisplay: '0.9631 HBAR', payTo: artist, settledTx: '0.0.9185802@1.000000001', hashscan: 'https://hashscan.io/testnet/transaction/0.0.9185802-1-000000001' },
    { leg: 'steward', status: 'failed', amountDisplay: '0.0369 HBAR', payTo: steward, error: 'settle failed', hashscan: 'javascript:alert(1)' },
  ] } };
  const d = describeSettle(res);
  assert.match(d.summary, /artist is paid.*never be charged twice/);
  assert.equal(d.lines[0].link, 'https://hashscan.io/testnet/transaction/0.0.9185802-1-000000001');
  assert.equal(d.lines[1].link, null);
  assert.equal(d.lines[1].error, true);
  assert.match(describeSettle({ ...res, state: 'complete' }).summary, /OSO held nothing/);
});

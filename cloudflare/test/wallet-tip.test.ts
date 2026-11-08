import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sdk from '@hiero-ledger/sdk';
import { DirectTipError, EXPIRY_GRACE_MS, type MirrorResult, type Receivable } from '../src/direct-split.ts';
import { memoryStore, prepareTip, settleTip, type WalletDeps } from '../src/wallet-tip.ts';
import { attachSignature, buildLegTx, walletSignatureMap } from '../src/wallet-tx.ts';
import worker, { TipGate, walletPaymentHeader, type TipEnv } from '../src/tip-worker.ts';
import type { Gate } from '../../payments/src/gate/types.ts';
import type { ArtistTarget } from '../src/pay-target.ts';

const FAN = '0.0.11345895';
const ARTIST = '0.0.11347291';
const STEWARD = '0.0.11345897';
const FEE_PAYER = '0.0.9185802';
const ENV = { STEWARD_ACCOUNT_ID: STEWARD, HCS_TOPIC_ID: '0.0.11345907', FAN_ACCOUNT_ID: FAN, METER_ACCOUNT_ID: '0.0.11345898' };
const fanKey = sdk.PrivateKey.generateECDSA();
const strangerKey = sdk.PrivateKey.generateECDSA();

const target = (over: Partial<ArtistTarget> = {}): ArtistTarget => ({ label: 'shaka', ens: 'shaka.osoartist.eth', payTo: ARTIST, accountId: ARTIST, alias: null, path: 'hbar', resolver: null, source: 'their ENS record addr(3030)', lastLiveReadAt: null, ...over });

/**
 * Fake facilitator: decodes the REAL x402 header, re-parses the signed Hedera tx with the SDK and checks it
 * like @x402/hedera does (fee payer, exact transfers, `accepted` == requirements, fan signature).
 */
function fakeFacilitator(log: string[], opts: { settleFailFor?: Set<string>; throwFor?: Set<string> } = {}): Gate {
  return {
    kind: 'hedera',
    async challenge({ amountAtomic, payTo, resource }) {
      return { status: 402, body: { x402Version: 2, accepts: [{ scheme: 'exact', network: 'hedera:testnet', amount: amountAtomic.toString(), asset: '0.0.0', payTo, resource, maxTimeoutSeconds: 180, extra: { feePayer: FEE_PAYER } }] }, headers: {} };
    },
    async verify({ paymentHeader, requirements }) {
      const p = JSON.parse(Buffer.from(paymentHeader!, 'base64').toString('utf8'));
      assert.deepEqual(p.accepted, requirements, 'accepted must equal the requirements byte for byte');
      const tx = sdk.Transaction.fromBytes(Buffer.from(p.payload.transaction, 'base64')) as sdk.TransferTransaction;
      assert.equal(tx.transactionId!.accountId!.toString(), FEE_PAYER);
      const signed = fanKey.publicKey.verifyTransaction(tx);
      const transfers = requirements.asset === '0.0.0'
        ? [...tx.hbarTransfers].map(([a, h]) => `${a.toString()}:${h.toTinybars().toString()}`).sort()
        : [...(tx.tokenTransfers.get(requirements.asset) ?? new Map())].map(([a, v]) => `${a.toString()}:${v.toString()}`).sort();
      log.push(`verify:${requirements.payTo}:${requirements.amount}:${requirements.asset}:${signed ? 'fan-signed' : 'UNSIGNED'}:${transfers.join(',')}`);
      if (!signed) return { ok: false, reason: 'invalid_exact_hedera_payload_signature_invalid' };
      return { ok: true, payer: FAN, handle: { txId: tx.transactionId!.toString(), payTo: requirements.payTo } };
    },
    async settle({ handle }) {
      const h = handle as { txId: string; payTo: string };
      log.push(`settle:${h.payTo}`);
      if (opts.throwFor?.has(h.payTo)) throw new Error('facilitator /settle -> 502: timeout');
      if (opts.settleFailFor?.has(h.payTo)) return { success: false, errorReason: 'transaction_failed' };
      return { success: true, txId: h.txId, network: 'hedera:testnet', payer: FAN };
    },
  };
}

function makeDeps(log: string[], over: Partial<WalletDeps> = {}, gate: Gate = fakeFacilitator(log)) {
  const store = memoryStore();
  const mirrorState = new Map<string, MirrorResult>();
  let clock = Date.now();
  const deps: WalletDeps = {
    env: ENV,
    store,
    resolveArtist: async (label, network) => { log.push(`resolve:${label}:${network}`); return target(); },
    gateFor: () => gate,
    feePayer: async () => FEE_PAYER,
    receivable: async (_cfg, account, asset): Promise<Receivable> => { log.push(`receivable:${account}:${asset.id}`); return { ok: true, code: 'ok', via: 'hbar', message: '' }; },
    buildLeg: (o) => buildLegTx({ ...o, now: clock }),
    attach: async (_cfg, _fan, leg, sig) => attachSignature(leg, sig, { type: 'ECDSA_SECP256K1', key: fanKey.publicKey.toStringRaw() }),
    paymentHeader: walletPaymentHeader,
    mirrorTx: async (_cfg, txId) => { log.push(`mirror:${txId.split('@')[1]}`); return mirrorState.get(txId) ?? 'NOT_FOUND'; },
    hcs: async (_cfg, message) => { log.push(`hcs:${JSON.parse(message).state}`); return { txId: `${STEWARD}@1794000000.000000001`, sequence: '42' }; },
    reserved: () => [FAN, STEWARD, '0.0.11345898'],
    now: () => clock,
    ...over,
  };
  return { deps, store, mirrorState, tick: (ms: number) => { clock += ms; } };
}

const prepBody = (over: Record<string, unknown> = {}) => JSON.stringify({ id: 'tip_test_000000000001', network: 'testnet', currency: 'HBAR', amount: '1', artist: 'shaka', fan: FAN, ...over });
type Prepared = Awaited<ReturnType<typeof prepareTip>>;
/** What the browser does: ask the wallet (here: the fan key) to sign each unsettled leg's body. */
async function walletSign(p: Prepared, key = fanKey, only?: string) {
  const sigs: Record<string, string> = {};
  for (const l of p.record.legs) if (l.bodyBytes && (!only || l.leg === only)) sigs[l.leg] = await walletSignatureMap(key as never, l.bodyBytes, 'ecdsa');
  return sigs;
}
const settle = (deps: WalletDeps, signatures: Record<string, string>, id = 'tip_test_000000000001') => settleTip(deps, JSON.stringify({ id, signatures }));

test('happy path: TWO direct x402 payments signed by the fan wallet — 96.31% to the artist, 3.69% to the steward, nothing held', async () => {
  const log: string[] = [];
  const { deps, store } = makeDeps(log);
  const p = await prepareTip(deps, prepBody());
  assert.equal(p.reused, false);
  assert.deepEqual(p.record.legs.map((l) => [l.leg, l.payTo, l.amount]), [['artist', ARTIST, '96310000'], ['steward', STEWARD, '3690000']]);
  assert.equal(BigInt(p.record.legs[0]!.amount) + BigInt(p.record.legs[1]!.amount), 100_000_000n, 'sums to exactly 1 HBAR');
  assert.ok(p.record.legs.every((l) => l.bodyBytes && l.feePayer === FEE_PAYER));
  assert.ok(!JSON.stringify(p).includes('txBytes'), 'the browser gets bodies, not our stored tx');
  const r = await settle(deps, await walletSign(p));
  assert.equal(r.state, 'complete');
  assert.deepEqual(log.filter((l) => /^(verify|settle|hcs)/.test(l)), [
    `verify:${ARTIST}:96310000:0.0.0:fan-signed:${[`${ARTIST}:96310000`, `${FAN}:-96310000`].sort().join(',')}`,
    `settle:${ARTIST}`,
    `verify:${STEWARD}:3690000:0.0.0:fan-signed:${[`${FAN}:-3690000`, `${STEWARD}:3690000`].sort().join(',')}`,
    `settle:${STEWARD}`,
    'hcs:complete',
  ]);
  const ledger = await store.ledger('testnet', 'shaka');
  assert.equal(ledger.length, 1);
  assert.deepEqual([ledger[0]!.artist_amount, ledger[0]!.steward_amount, ledger[0]!.oso_amount, ledger[0]!.custody], ['96310000', '3690000', '0', 'none']);
  assert.deepEqual(r.record.hcs, { txId: `${STEWARD}@1794000000.000000001`, sequence: '42' });
  assert.ok(r.record.legs.every((l) => l.hashscan?.startsWith('https://hashscan.io/testnet/transaction/0.0.9185802-')));
});

test('USDC: token transfers of 0.0.429274 in micro-units; payees checked for association first', async () => {
  const log: string[] = [];
  const { deps } = makeDeps(log);
  const p = await prepareTip(deps, prepBody({ currency: 'USDC', amount: '0.5' }));
  assert.deepEqual(p.record.legs.map((l) => l.amount), ['481550', '18450']);
  assert.ok(log.includes(`receivable:${ARTIST}:0.0.429274`) && log.includes(`receivable:${STEWARD}:0.0.429274`));
  const r = await settle(deps, await walletSign(p));
  assert.equal(r.state, 'complete');
  assert.ok(log.some((l) => l.startsWith(`verify:${ARTIST}:481550:0.0.429274:fan-signed`)));

  const log2: string[] = [];
  const { deps: d2 } = makeDeps(log2, { receivable: async (_c, a) => (a === ARTIST ? { ok: false, code: 'not-associated', message: `${a} has not associated USDC (0.0.429274) — associate it in your wallet` } : { ok: true, code: 'ok', message: '' }) });
  await assert.rejects(prepareTip(d2, prepBody({ id: 'tip_test_usdc_noassoc1', currency: 'USDC' })), (e: DirectTipError) => e.code === 'ARTIST_CANNOT_RECEIVE' && /associate/.test(e.message));
  assert.equal(await d2.store.get('tip_test_usdc_noassoc1'), null, 'nothing stored');
});

test('idempotency: same id -> same prepared txs; same id + different tip -> 409; settling a complete tip moves nothing', async () => {
  const log: string[] = [];
  const { deps } = makeDeps(log);
  const a = await prepareTip(deps, prepBody());
  const b = await prepareTip(deps, prepBody());
  assert.equal(b.reused, true);
  assert.deepEqual(b.record.legs.map((l) => l.txId), a.record.legs.map((l) => l.txId));
  await assert.rejects(prepareTip(deps, prepBody({ amount: '2' })), (e: DirectTipError) => e.code === 'IDEMPOTENCY_CONFLICT' && e.status === 409);
  await settle(deps, await walletSign(a));
  const n = log.filter((l) => l.startsWith('settle:')).length;
  const again = await settle(deps, await walletSign(a));
  assert.equal(again.state, 'complete');
  assert.equal(log.filter((l) => l.startsWith('settle:')).length, n, 'no second settlement');
  assert.ok(again.results.every((x) => x.already === true));
  assert.equal(log.filter((l) => l.startsWith('hcs:')).length, 1, 'one HCS line per tip');
});

test('recovery: payment 1 settles, payment 2 fails -> recorded "partial", retry settles ONLY payment 2 (never double-charge)', async () => {
  const log: string[] = [];
  const failSteward = new Set([STEWARD]);
  const { deps, store } = makeDeps(log, {}, fakeFacilitator(log, { settleFailFor: failSteward }));
  const p = await prepareTip(deps, prepBody());
  const r1 = await settle(deps, await walletSign(p));
  assert.equal(r1.state, 'partial');
  assert.match(String(r1.recovery), /only the steward leg/);
  assert.deepEqual(r1.record.legs.map((l) => l.status), ['settled', 'failed']);
  assert.equal((await store.ledger('testnet', 'shaka'))[0]!.state, 'partial', 'partial is on the per-artist ledger');
  failSteward.clear(); // facilitator recovers
  log.length = 0;
  const p2 = await prepareTip(deps, prepBody()); // same id: artist leg comes back settled, no body to sign
  assert.equal(p2.record.legs[0]!.bodyBytes, null);
  assert.equal(p2.record.legs[1]!.txId, p.record.legs[1]!.txId, 'still valid -> same steward tx');
  const r2 = await settle(deps, await walletSign(p2));
  assert.equal(r2.state, 'complete');
  assert.deepEqual(log.filter((l) => l.startsWith('settle:')), [`settle:${STEWARD}`], 'the artist was not paid twice');
  assert.deepEqual((await store.ledger('testnet', 'shaka')).map((l) => l.state), ['complete', 'partial']);
});

test('recovery: an expired, never-landed leg is rebuilt alone (new txId, old one recorded); an ambiguous one is reconciled from the mirror', async () => {
  const log: string[] = [];
  const { deps, mirrorState, tick } = makeDeps(log, {}, fakeFacilitator(log, { settleFailFor: new Set([STEWARD]) }));
  const p = await prepareTip(deps, prepBody());
  await settle(deps, await walletSign(p));
  tick(200_000 + EXPIRY_GRACE_MS); // the old steward tx can no longer land
  const s = await settle(deps, await walletSign(p));
  assert.equal(s.results.find((x) => x.leg === 'steward')!.status, 'needs-new-signature');
  const p2 = await prepareTip(deps, prepBody());
  assert.notEqual(p2.record.legs[1]!.txId, p.record.legs[1]!.txId);
  assert.equal((await deps.store.get('tip_test_000000000001'))!.legs[1]!.abandoned![0], p.record.legs[1]!.txId);

  // ambiguous: the facilitator timed out but the tx DID land -> next settle reconciles, no new payment
  const log2: string[] = [];
  const m2 = makeDeps(log2, {}, fakeFacilitator(log2, { throwFor: new Set([STEWARD]) }));
  const q = await prepareTip(m2.deps, prepBody({ id: 'tip_test_ambiguous_0001' }));
  const first = await settle(m2.deps, await walletSign(q), 'tip_test_ambiguous_0001');
  assert.equal(first.state, 'partial');
  m2.mirrorState.set(q.record.legs[1]!.txId, 'SUCCESS');
  log2.length = 0;
  const second = await settle(m2.deps, {}, 'tip_test_ambiguous_0001');
  assert.equal(second.state, 'complete');
  assert.equal(second.results.find((x) => x.leg === 'steward')!.reconciled, true);
  assert.deepEqual(log2.filter((l) => l.startsWith('settle:') || l.startsWith('verify:')), [], 'reconciled without touching the facilitator');
  void mirrorState;
});

test('a leg being settled elsewhere is not raced; a signature by the wrong key never reaches the facilitator', async () => {
  const log: string[] = [];
  const { deps, store } = makeDeps(log);
  const p = await prepareTip(deps, prepBody());
  const claim = await store.claim('tip_test_000000000001', 'artist', Date.now(), 90_000);
  assert.equal(claim.ok, true);
  const r = await settle(deps, await walletSign(p));
  assert.equal(r.results[0]!.status, 'in-flight');
  assert.equal(log.filter((l) => l.startsWith('verify')).length, 0);

  const log2: string[] = [];
  const m = makeDeps(log2);
  const q = await prepareTip(m.deps, prepBody({ id: 'tip_test_wrong_key_001' }));
  const bad = await settle(m.deps, await walletSign(q, strangerKey), 'tip_test_wrong_key_001');
  assert.deepEqual([bad.results[0]!.status, bad.results[0]!.step], ['failed', 'signature']);
  assert.equal(log2.filter((l) => l.startsWith('verify') || l.startsWith('settle')).length, 0);
});

test('payee rules: alias-only artist refused (x402 pays 0.0.N only; USDC impossible); OSO accounts never a payee; fan ≠ payee', async () => {
  const log: string[] = [];
  const alias = makeDeps(log, { resolveArtist: async () => target({ accountId: null, alias: '0x25965899f4600b3aa5362ee4f34be95e5e62c934', payTo: '0x25965899f4600b3aa5362ee4f34be95e5e62c934', path: 'hedera-evm' }) });
  await assert.rejects(prepareTip(alias.deps, prepBody()), (e: DirectTipError) => e.code === 'PAYEE_ALIAS_ONLY' && /never receive USDC/.test(e.message));
  const osoAcct = makeDeps(log, { resolveArtist: async () => target({ accountId: STEWARD, payTo: STEWARD }) });
  await assert.rejects(prepareTip(osoAcct.deps, prepBody()), (e: DirectTipError) => e.code === 'ARTIST_NOT_PAYABLE');
  const self = makeDeps(log, { resolveArtist: async () => target({ accountId: '0.0.424242', payTo: '0.0.424242' }) });
  await assert.rejects(prepareTip(self.deps, prepBody({ fan: '0.0.424242' })), (e: DirectTipError) => e.code === 'BAD_FAN');
});

test('mainnet flag OFF: prepare is refused BEFORE any ENS read / mirror call / tx build; a stored mainnet tip cannot settle once the switch is off', async () => {
  const log: string[] = [];
  const { deps, store } = makeDeps(log);
  await assert.rejects(prepareTip(deps, prepBody({ network: 'mainnet', currency: 'USDC' })), (e: DirectTipError) => e.code === 'MAINNET_DISABLED' && e.status === 403);
  assert.deepEqual(log, [], 'nothing was touched');
  // switch ON (fully configured) -> prepares; then switched OFF -> settle refused
  const on = { ...ENV, MAINNET_ENABLED: 'true', MAINNET_FACILITATOR_URL: 'https://facilitator.example', MAINNET_STEWARD_ACCOUNT_ID: '0.0.777', MAINNET_HCS_TOPIC_ID: '0.0.778', MAINNET_DAILY_CAP: '2' };
  const m = makeDeps(log, { env: on, store });
  const p = await prepareTip(m.deps, prepBody({ id: 'tip_test_mainnet_00001', network: 'mainnet', currency: 'USDC', amount: '1' }));
  assert.deepEqual(p.record.legs.map((l) => [l.payTo, l.amount]), [[ARTIST, '963100'], ['0.0.777', '36900']]);
  await assert.rejects(prepareTip(m.deps, prepBody({ id: 'tip_test_mainnet_00002', network: 'mainnet', currency: 'USDC', amount: '6' })), (e: DirectTipError) => e.code === 'BAD_AMOUNT', 'mainnet per-tip cap');
  const off = makeDeps(log, { store });
  await assert.rejects(settle(off.deps, {}, 'tip_test_mainnet_00001'), (e: DirectTipError) => e.code === 'MAINNET_DISABLED');
});

// ── through the Worker's fetch (real routing, in-memory Durable Object) ──────────────

function memoryGateNs() {
  const objs = new Map<string, TipGate>();
  return {
    idFromName: (n: string) => n,
    get: (id: unknown) => {
      const k = String(id);
      if (!objs.has(k)) {
        const st = new Map<string, unknown>();
        objs.set(k, new TipGate({ storage: { get: async <T>(key: string) => structuredClone(st.get(key)) as T | undefined, put: async (e: Record<string, unknown>) => { for (const [kk, v] of Object.entries(e)) st.set(kk, structuredClone(v)); } } }));
      }
      const o = objs.get(k)!;
      return { fetch: (u: string, init?: RequestInit) => o.fetch(new Request(u, init)) };
    },
  };
}

test('Worker: /wallet/prepare on mainnet -> 403 MAINNET_DISABLED; POST /tip (demo fan) refuses any non-testnet network; /health reports both', async () => {
  const env = { ...ENV, ARTIST_ACCOUNT_ID: '0.0.11345896', FAN_PRIVATE_KEY: 'k', STEWARD_PRIVATE_KEY: 'k', UPSTREAM_API_KEY: 'k', UPSTREAM_MODEL: 'm', TIP_GATE: memoryGateNs() } as unknown as TipEnv;
  let r = await worker.fetch(new Request('https://w/wallet/prepare', { method: 'POST', body: prepBody({ network: 'mainnet' }) }), env);
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { error: string }).error, 'MAINNET_DISABLED');
  for (const network of ['mainnet', 'hedera:mainnet', 1]) {
    r = await worker.fetch(new Request('https://w/tip', { method: 'POST', body: JSON.stringify({ network, artist: 'shaka' }) }), env);
    assert.equal(r.status, 403);
    assert.equal(((await r.json()) as { error: string }).error, 'DEMO_FAN_TESTNET_ONLY');
  }
  r = await worker.fetch(new Request('https://w/health'), env);
  const h = (await r.json()) as { wallet: { mainnet: { enabled: boolean }; testnet: { enabled: boolean; steward: string } }; demoFan: { label: string } };
  assert.deepEqual([h.wallet.testnet.enabled, h.wallet.testnet.steward, h.wallet.mainnet.enabled], [true, STEWARD, false]);
  assert.match(h.demoFan.label, /DEMO.*never available on mainnet/);
  r = await worker.fetch(new Request('https://w/wallet/settle', { method: 'POST', body: JSON.stringify({ id: 'tip_unknown_000000001', signatures: {} }) }), env);
  assert.equal(r.status, 404);
});

test('Durable Object: leg claim is atomic (second claim while leased = in-flight), ledger + admit caps', async () => {
  const ns = memoryGateNs();
  const { gateTipStore } = await import('../src/tip-worker.ts');
  const store = gateTipStore(ns.get(ns.idFromName('wallet')) as never);
  const leg = await buildLegTx({ fan: FAN, payTo: ARTIST, amount: 9n, asset: '0.0.0', feePayer: FEE_PAYER });
  const rec = { v: 1 as const, id: 'tip_do_test_000000001', fingerprint: 'x', network: 'testnet' as const, currency: 'HBAR' as const, asset: '0.0.0', decimals: 8, artist: { label: 'shaka', ens: 'shaka.osoartist.eth', payTo: ARTIST, source: '' }, fan: FAN, total: '10', legs: [{ leg: 'artist' as const, payTo: ARTIST, amount: '9', status: 'prepared' as const, ...leg, attempts: 0 }, { leg: 'steward' as const, payTo: STEWARD, amount: '1', status: 'prepared' as const, ...leg, attempts: 0 }], createdAt: '', updatedAt: '' };
  await store.put(rec);
  const now = Date.now();
  assert.equal((await store.claim(rec.id, 'artist', now, 90_000)).ok, true);
  assert.deepEqual(await store.claim(rec.id, 'artist', now + 1, 90_000), { ok: false, reason: 'in-flight' });
  assert.equal((await store.claim(rec.id, 'artist', now + 90_001, 90_000)).ok, true, 'lease expired');
  assert.equal((await store.get(rec.id))!.legs[0]!.attempts, 2);
  await store.appendLedger('testnet', 'shaka', { tip: 'a' });
  await store.appendLedger('testnet', 'shaka', { tip: 'b' });
  assert.deepEqual((await store.ledger('testnet', 'shaka')).map((l) => l.tip), ['b', 'a']);
  assert.deepEqual(await store.ledger('testnet', '../x'), []);
  assert.equal((await store.admit('testnet', 'HBAR', 5n, 2, 100n)).ok, true);
  assert.equal((await store.admit('testnet', 'HBAR', 96n, 2, 100n)).reason, 'budget');
  assert.equal((await store.admit('testnet', 'HBAR', 5n, 2, 100n)).ok, true);
  assert.equal((await store.admit('testnet', 'HBAR', 5n, 2, 100n)).reason, 'cap');
});

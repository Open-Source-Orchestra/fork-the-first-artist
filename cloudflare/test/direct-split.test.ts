import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DirectTipError, EXPIRY_GRACE_MS, USDC_TOKEN, assetFor, checkReceivable, fromAtomic, legDecision, networkConfig, parseDirectTip, splitDirect, toAtomic, walletHealth,
  type LegRecord,
} from '../src/direct-split.ts';

const TESTNET = { STEWARD_ACCOUNT_ID: '0.0.11345897', HCS_TOPIC_ID: '0.0.11345907' };
const MAINNET_FULL = { ...TESTNET, MAINNET_ENABLED: 'true', MAINNET_FACILITATOR_URL: 'https://facilitator.example', MAINNET_STEWARD_ACCOUNT_ID: '0.0.777', MAINNET_HCS_TOPIC_ID: '0.0.778', MAINNET_DAILY_CAP: '3' };

test('split: legs always sum EXACTLY to the tip, rounding favours the artist (HBAR tinybar + USDC micro-units)', () => {
  assert.deepEqual(splitDirect(10_000_000n), { artist: 9_631_000n, steward: 369_000n }); // 0.1 HBAR
  assert.deepEqual(splitDirect(1_000_000n), { artist: 963_100n, steward: 36_900n }); // 1 USDC
  assert.deepEqual(splitDirect(10_001n), { artist: 9_632n, steward: 369n }); // remainder -> artist
  assert.deepEqual(splitDirect(28n), { artist: 27n, steward: 1n });
  assert.throws(() => splitDirect(27n), /too small/); // steward leg would be 0: two payments impossible
  assert.throws(() => splitDirect(0n), DirectTipError);
  // exhaustive small range + random large amounts
  for (let t = 28n; t < 30_000n; t++) {
    const s = splitDirect(t);
    assert.equal(s.artist + s.steward, t);
    assert.ok(s.steward * 10_000n <= t * 369n && (s.steward + 1n) * 10_000n > t * 369n, `floor at ${t}`);
  }
  let x = 0x9e3779b97f4a7c15n;
  for (let i = 0; i < 5000; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    const t = (x % 1_000_000_000_000n) + 28n;
    const s = splitDirect(t);
    assert.equal(s.artist + s.steward, t);
    assert.ok(s.artist > s.steward);
  }
});

test('amount parsing is exact decimal per asset; formatting round-trips', () => {
  assert.equal(toAtomic('0.1', 8), 10_000_000n);
  assert.equal(toAtomic('1', 6), 1_000_000n);
  assert.equal(toAtomic('2.50', 6), 2_500_000n);
  assert.equal(toAtomic(0.01, 6), 10_000n);
  for (const bad of ['1e3', '-1', '0.1234567', '', 'abc', '1.2.3']) assert.throws(() => toAtomic(bad, 6), /plain number/);
  assert.equal(fromAtomic(9_631_000n, 8), '0.09631');
  assert.equal(fromAtomic(963_100n, 6), '0.9631');
  assert.equal(fromAtomic(100_000_000n, 8), '1');
});

test('USDC token ids: mainnet 0.0.456858, testnet 0.0.429274 (Circle); HBAR = 0.0.0', () => {
  assert.equal(USDC_TOKEN.mainnet, '0.0.456858');
  assert.equal(USDC_TOKEN.testnet, '0.0.429274');
  assert.deepEqual(assetFor('mainnet', 'USDC'), { currency: 'USDC', id: '0.0.456858', decimals: 6 });
  assert.deepEqual(assetFor('testnet', 'HBAR'), { currency: 'HBAR', id: '0.0.0', decimals: 8 });
});

test('MAINNET SWITCH defaults OFF: absent / "false" / "TRUE" / "1" all refuse mainnet with MAINNET_DISABLED (403)', () => {
  for (const flag of [undefined, 'false', 'TRUE', '1', 'yes', ' true']) {
    const env = { ...MAINNET_FULL, MAINNET_ENABLED: flag };
    assert.throws(() => networkConfig(env, 'mainnet'), (e: DirectTipError) => e.code === 'MAINNET_DISABLED' && e.status === 403);
    const body = JSON.stringify({ id: 'a'.repeat(20), network: 'mainnet', currency: 'USDC', amount: '1', artist: 'shaka', fan: '0.0.5' });
    assert.throws(() => parseDirectTip(body, env), (e: DirectTipError) => e.code === 'MAINNET_DISABLED');
  }
  // switch on but anything missing -> still refused
  for (const drop of ['MAINNET_FACILITATOR_URL', 'MAINNET_STEWARD_ACCOUNT_ID', 'MAINNET_HCS_TOPIC_ID', 'MAINNET_DAILY_CAP'] as const) {
    const env: Record<string, string | undefined> = { ...MAINNET_FULL };
    delete env[drop];
    assert.throws(() => networkConfig(env, 'mainnet'), (e: DirectTipError) => e.code === 'MAINNET_NOT_CONFIGURED' && e.message.includes(drop));
  }
  assert.throws(() => networkConfig({ ...MAINNET_FULL, MAINNET_FACILITATOR_URL: 'http://insecure.example' }, 'mainnet'), /MAINNET_FACILITATOR_URL/);
  // fully configured: small, hard-clamped caps
  const c = networkConfig({ ...MAINNET_FULL, MAINNET_MAX_TIP_USDC: '500', MAINNET_DAILY_CAP: '999' }, 'mainnet');
  assert.equal(c.caip2, 'hedera:mainnet');
  assert.equal(c.maxTip.USDC, 5_000_000n, 'per-tip USDC clamped to 5');
  assert.equal(c.dailyCap, 20, 'daily cap clamped to 20');
  assert.equal(c.mirror, 'https://mainnet-public.mirrornode.hedera.com');
  assert.throws(() => networkConfig(TESTNET, 'devnet'), /BAD_NETWORK|testnet/);
  const h = walletHealth(TESTNET) as { testnet: { enabled: boolean }; mainnet: { enabled: boolean; error: string } };
  assert.equal(h.testnet.enabled, true);
  assert.deepEqual([h.mainnet.enabled, h.mainnet.error], [false, 'MAINNET_DISABLED']);
});

test('parseDirectTip: label only (never an account), idempotency key, fan account, per-asset bounds', () => {
  const ok = { id: 'tip_0123456789abcdef', network: 'testnet', currency: 'USDC', amount: '1', artist: 'shaka', fan: '0.0.11345895' };
  const { req, asset } = parseDirectTip(JSON.stringify(ok), TESTNET);
  assert.deepEqual([req.amount, asset.id, req.network], [1_000_000n, '0.0.429274', 'testnet']);
  const bad = (over: Record<string, unknown>, code: string) => assert.throws(() => parseDirectTip(JSON.stringify({ ...ok, ...over }), TESTNET), (e: DirectTipError) => e.code === code, code);
  bad({ id: 'short' }, 'BAD_ID');
  bad({ artist: '0.0.666' }, 'BAD_ARTIST');
  bad({ fan: '0x25965899f4600b3aa5362ee4f34be95e5e62c934' }, 'BAD_FAN');
  bad({ currency: 'ETH' }, 'BAD_CURRENCY');
  bad({ amount: '0.001' }, 'BAD_AMOUNT');
  bad({ amount: '11' }, 'BAD_AMOUNT');
  assert.equal(parseDirectTip(JSON.stringify({ ...ok, network: undefined, currency: undefined, amount: '0.5' }), TESTNET).req.amount, 50_000_000n, 'defaults: testnet HBAR');
});

/** Mocked mirror node: path -> JSON body (or status). */
function mirror(routes: Record<string, unknown>) {
  const seen: string[] = [];
  const f = async (url: string) => {
    const path = url.replace('https://m', '');
    seen.push(path);
    const v = routes[path];
    if (v === undefined) return new Response('{}', { status: 404 });
    if (typeof v === 'number') return new Response('{}', { status: v });
    return Response.json(v);
  };
  return { f: f as unknown as typeof fetch, seen };
}

test('USDC association check (mocked mirror): associated / auto -1 / auto 0 / slots full / free slot / alias / missing / mirror down', async () => {
  const usdc = assetFor('testnet', 'USDC');
  const tok = (id: string) => `/api/v1/accounts/${id}/tokens?token.id=0.0.429274`;
  const m = mirror({
    '/api/v1/accounts/0.0.1': { key: { _type: 'ED25519', key: 'aa' }, max_automatic_token_associations: 0 },
    [tok('0.0.1')]: { tokens: [{ token_id: '0.0.429274' }] },
    '/api/v1/accounts/0.0.2': { key: { _type: 'ED25519', key: 'aa' }, max_automatic_token_associations: -1 },
    [tok('0.0.2')]: { tokens: [] },
    '/api/v1/accounts/0.0.3': { key: { _type: 'ED25519', key: 'aa' }, max_automatic_token_associations: 0 },
    [tok('0.0.3')]: { tokens: [] },
    '/api/v1/accounts/0.0.4': { key: { _type: 'ED25519', key: 'aa' }, max_automatic_token_associations: 2 },
    [tok('0.0.4')]: { tokens: [] },
    '/api/v1/accounts/0.0.4/tokens?limit=100': { tokens: [{ automatic_association: true }, { automatic_association: true }], links: { next: null } },
    '/api/v1/accounts/0.0.5': { key: null, max_automatic_token_associations: 3 },
    [tok('0.0.5')]: { tokens: [] },
    '/api/v1/accounts/0.0.5/tokens?limit=100': { tokens: [{ automatic_association: true }], links: { next: null } },
    '/api/v1/accounts/0.0.7': 500,
  });
  const r = (id: string) => checkReceivable('https://m', id, usdc, m.f);
  assert.deepEqual([(await r('0.0.1')).ok, (await r('0.0.1')).via], [true, 'associated']);
  assert.deepEqual([(await r('0.0.2')).ok, (await r('0.0.2')).via], [true, 'auto-unlimited']);
  const no = await r('0.0.3');
  assert.deepEqual([no.ok, no.code], [false, 'not-associated']);
  assert.match(no.message, /associate it in your wallet/);
  assert.deepEqual([(await r('0.0.4')).ok, (await r('0.0.4')).code], [false, 'auto-slots-full']);
  const hollow = await r('0.0.5');
  assert.deepEqual([hollow.ok, hollow.via, hollow.hollow], [true, 'auto-slot', true]);
  const alias = await r('0x25965899f4600b3aa5362ee4f34be95e5e62c934');
  assert.deepEqual([alias.ok, alias.code], [false, 'no-account']);
  assert.match(alias.message, /wallet address with no Hedera account/);
  assert.deepEqual([(await r('0.0.6')).ok, (await r('0.0.6')).code], [false, 'no-account']);
  assert.deepEqual([(await r('0.0.7')).ok, (await r('0.0.7')).code], [false, 'mirror-error']);
  // HBAR never needs association
  const hb = await checkReceivable('https://m', '0.0.5', assetFor('testnet', 'HBAR'), m.f);
  assert.deepEqual([hb.ok, hb.via, hb.hollow], [true, 'hbar', true]);
  assert.ok(m.seen.includes(tok('0.0.3')), 'used /accounts/{id}/tokens?token.id=');
});

test('recovery decision table: never settle twice, never re-sign while the old tx could still land', () => {
  const now = 1_800_000_000_000;
  const leg = (over: Partial<LegRecord>): LegRecord => ({ leg: 'steward', payTo: '0.0.2', amount: '1', status: 'prepared', txId: '0.0.9@1.1', txBytes: '', bodyBytes: '', validUntilMs: now + 60_000, attempts: 0, ...over });
  assert.equal(legDecision(leg({ status: 'settled' }), now, 'NOT_FOUND'), 'settled');
  assert.equal(legDecision(leg({ status: 'settling', leaseUntilMs: now + 1 }), now, null), 'in-flight');
  assert.equal(legDecision(leg({ status: 'failed' }), now, 'SUCCESS'), 'reconcile', 'it did land: record, do not pay again');
  assert.equal(legDecision(leg({ status: 'failed' }), now, 'NOT_FOUND'), 'resubmit', 'still valid: same bytes, same txId');
  assert.equal(legDecision(leg({ status: 'failed' }), now, null), 'resubmit');
  assert.equal(legDecision(leg({ status: 'failed', validUntilMs: now - 1 }), now, 'NOT_FOUND'), 'resubmit', 'inside the grace window: wait/resubmit, do not rebuild');
  assert.equal(legDecision(leg({ status: 'failed', validUntilMs: now - EXPIRY_GRACE_MS - 1 }), now, 'NOT_FOUND'), 'rebuild');
  assert.equal(legDecision(leg({ status: 'failed', validUntilMs: now - EXPIRY_GRACE_MS - 1 }), now, null), 'in-flight', 'mirror unknown: never guess');
  assert.equal(legDecision(leg({ status: 'failed' }), now, { failed: 'INSUFFICIENT_ACCOUNT_BALANCE' }), 'rebuild', 'consensus failure: txId spent, no money moved');
  assert.equal(legDecision(leg({ status: 'settling', leaseUntilMs: now - 1, validUntilMs: now - EXPIRY_GRACE_MS - 1 }), now, 'SUCCESS'), 'reconcile');
});

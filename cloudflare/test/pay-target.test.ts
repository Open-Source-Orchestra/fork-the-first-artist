import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hbarToTinybar, meterFor, parseTipRequest, resolveArtistTarget, TipRequestError, type TargetDeps } from '../src/pay-target.ts';
import { runTipLoop, type TipEvent } from '../src/tip-loop.ts';
import { TipGate, stewardFor, tipConfig, targetDeps, type TipEnv } from '../src/tip-worker.ts';
import worker from '../src/tip-worker.ts';

const SHAKA_EVM = '0x25965899f4600b3AA5362ee4f34be95E5E62c934';
const resolved = (over = {}) => ({ name: 'shaka.osoartist.eth', path: 'hedera-evm', payTo: SHAKA_EVM, hederaAccountId: null, hederaAlias: SHAKA_EVM, resolver: '0xdD', ...over });
const tdeps = (over: Partial<TargetDeps> = {}): TargetDeps => ({ resolve: async () => resolved(), aliasAccount: async () => '0.0.11347291', ...over });

test('hbarToTinybar: exact decimal parsing, no floats, no exponents', () => {
  assert.equal(hbarToTinybar('0.1'), 10_000_000n);
  assert.equal(hbarToTinybar(1), 100_000_000n);
  assert.equal(hbarToTinybar(0.1), 10_000_000n);
  assert.equal(hbarToTinybar('2.5'), 250_000_000n);
  assert.equal(hbarToTinybar('10'), 1_000_000_000n);
  assert.equal(hbarToTinybar('0.00000001'), 1n);
  for (const bad of ['-1', '1e3', 'abc', '', '0.000000001', '1,5', '99999']) assert.throws(() => hbarToTinybar(bad), TipRequestError, bad);
});

test('meter = the 3.69% compute share of any tip; artist gets the rest', () => {
  assert.equal(meterFor(10_000_000n), 369_000n);
  assert.equal(meterFor(100_000_000n), 3_690_000n);
  assert.equal(meterFor(1_000_000n), 36_900n);
});

test('parseTipRequest: defaults, any amount in [0.01, max], slug-only artist', () => {
  assert.deepEqual(parseTipRequest(''), { question: null, artist: null, tipTinybar: 10_000_000n });
  const r = parseTipRequest(JSON.stringify({ artist: 'shaka', amountHbar: '5', question: '  hi  ' }));
  assert.deepEqual(r, { question: 'hi', artist: 'shaka', tipTinybar: 500_000_000n });
  assert.equal(parseTipRequest(JSON.stringify({ amountHbar: 0.01 })).tipTinybar, 1_000_000n);
  assert.throws(() => parseTipRequest(JSON.stringify({ amountHbar: '0.009' })), /between 0.01 and 10/);
  assert.throws(() => parseTipRequest(JSON.stringify({ amountHbar: '10.01' })), /between 0.01 and 10/);
  assert.throws(() => parseTipRequest(JSON.stringify({ amountHbar: '3' }), 200_000_000n), /between 0.01 and 2/);
  for (const artist of ['0.0.123', '0x' + 'a'.repeat(40) + '.eth', 'Shaka', 'shaka.osoartist.eth', '../x', 5]) assert.throws(() => parseTipRequest(JSON.stringify({ artist })), /garden slug/);
  assert.throws(() => parseTipRequest('[1]'), /object/);
  assert.throws(() => parseTipRequest('{'), /JSON/);
});

test('resolveArtistTarget: payout comes from the artist ENS name; alias mapped to its existing account', async () => {
  const seen: string[] = [];
  const t = await resolveArtistTarget('shaka', tdeps({ resolve: async (n) => { seen.push(n); return resolved(); } }));
  assert.deepEqual(seen, ['shaka.osoartist.eth']);
  assert.equal(t.payTo, '0.0.11347291');
  assert.equal(t.accountId, '0.0.11347291');
  assert.equal(t.alias, SHAKA_EVM);
  assert.match(t.source, /own wallet as a Hedera alias/);
  // alias not created yet -> pay the EVM alias itself (Hedera auto-creates a hollow account only that key can spend)
  const fresh = await resolveArtistTarget('shaka', tdeps({ aliasAccount: async () => null }));
  assert.equal(fresh.payTo, SHAKA_EVM);
  // direct 0.0.N record (addr 3030)
  const direct = await resolveArtistTarget('shaka', tdeps({ resolve: async () => resolved({ path: 'hbar', payTo: '0.0.777', hederaAccountId: '0.0.777', hederaAlias: null }) }));
  assert.equal(direct.payTo, '0.0.777');
});

test('resolveArtistTarget fails closed: no consent, paused, wrong name, OSO demo account, junk', async () => {
  const err = (code: string) => async () => { throw Object.assign(new Error(code), { code }); };
  await assert.rejects(resolveArtistTarget('lexi', tdeps({ resolve: err('no-consent') })), /lexi.osoartist.eth has not consented.*nothing was paid/);
  await assert.rejects(resolveArtistTarget('shaka', tdeps({ resolve: err('steward-paused') })), /paused/);
  await assert.rejects(resolveArtistTarget('shaka', tdeps({ resolve: err('boom') })), /could not be resolved/);
  await assert.rejects(resolveArtistTarget('shaka', tdeps({ resolve: async () => resolved({ name: 'evil.eth' }) })), /different name/);
  await assert.rejects(resolveArtistTarget('shaka', tdeps({ resolve: async () => resolved({ payTo: 'nope' }) })), /malformed/);
  await assert.rejects(resolveArtistTarget('shaka', tdeps({ aliasAccount: async () => '0.0.12' }), ['0.0.11', '0.0.12']), /OSO demo account/);
  await assert.rejects(resolveArtistTarget('Bad!', tdeps()), /garden slug/);
});

test('stewardFor: example run = demo artist; Shaka = his public profile; others = minimal consented profile', () => {
  assert.equal(stewardFor(null), undefined);
  const base = { ens: 'x.osoartist.eth', payTo: '0.0.1', accountId: '0.0.1', alias: null, path: 'hbar', resolver: null, source: '' };
  assert.equal(stewardFor({ ...base, label: 'shaka', ens: 'shaka.osoartist.eth' })!.label, 'Shaka');
  const other = stewardFor({ ...base, label: 'lexi', ens: 'lexi.osoartist.eth' })!;
  assert.equal(other.fictional, false);
  assert.equal(other.label, 'lexi.osoartist.eth');
  assert.equal(stewardFor({ ...base, label: 'mira-modal' })!.fictional, false, 'a real label never borrows the fictional profile');
});

test('targetDeps.aliasAccount reads the mirror node and only trusts a matching evm_address', async () => {
  const f = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const cfg = { ensRpcUrl: 'x', mirror: 'https://m' };
  assert.equal(await targetDeps(cfg, f({ account: '0.0.11347291', evm_address: SHAKA_EVM.toLowerCase() })).aliasAccount(SHAKA_EVM), '0.0.11347291');
  assert.equal(await targetDeps(cfg, f({ account: '0.0.5', evm_address: '0x' + '1'.repeat(40) })).aliasAccount(SHAKA_EVM), null);
  assert.equal(await targetDeps(cfg, f({}, 404)).aliasAccount(SHAKA_EVM), null);
});

test('loop with a real-artist target: forward goes to the resolved payTo; HCS + start carry the ENS source', async () => {
  const events: TipEvent[] = [];
  const log: string[] = [];
  const gate = {
    kind: 'hedera',
    async challenge({ resource, amountAtomic, payTo }: { resource: string; amountAtomic: bigint; payTo: string }) {
      return { status: 402, body: { x402Version: 2, accepts: [{ scheme: 'exact', network: 'hedera:testnet', amount: amountAtomic.toString(), asset: '0.0.0', payTo, resource, maxTimeoutSeconds: 180 }] }, headers: {} };
    },
    async verify({ paymentHeader, requirements }: { paymentHeader: string; requirements: { payTo: string; amount: string } }) { log.push(`verify:${requirements.payTo}:${requirements.amount}`); return { ok: true, payer: paymentHeader, handle: { paymentHeader, requirements } }; },
    async settle({ requirements }: { requirements: { payTo: string } }) { return { success: true, txId: `0.0.9@1794000001.00000000${requirements.payTo === '0.0.14' ? 1 : 2}`, network: 'hedera:testnet', payer: 'x' }; },
  };
  let hcsMsg: Record<string, unknown> = {};
  const r = await runTipLoop({
    gate: gate as never,
    accounts: { fan: '0.0.11', steward: '0.0.12', artist: '0.0.11347291', meter: '0.0.14', topic: '0.0.15', artistLabel: 'shaka.osoartist.eth' },
    amounts: { tipTinybar: 500_000_000n, meterTinybar: meterFor(500_000_000n) },
    target: { ens: 'shaka.osoartist.eth', payTo: '0.0.11347291', accountId: '0.0.11347291', alias: SHAKA_EVM, source: 'ens' },
    fanSign: async () => 'fan', stewardSign: async () => 'stew',
    zeroG: async () => ({ answer: 'a', requestId: 'r', model: 'm', teeVerified: null }),
    forward: async (to, amt) => { log.push(`forward:${to}:${amt}`); return { txId: '0.0.12@1794000003.000000005', status: 'SUCCESS' }; },
    hcs: async (_t, m) => { hcsMsg = JSON.parse(m); assert.ok(m.length < 1024, 'HCS message fits one chunk'); return { txId: '0.0.12@1794000004.000000006', status: 'SUCCESS', sequence: '9' }; },
    mirrorSuccess: async () => true,
  }, 'q', 'https://w', (e) => { events.push(e); });
  assert.equal(r.ok, true);
  assert.ok(log.includes('verify:0.0.14:18450000'), 'meter = 3.69% of 5 HBAR');
  assert.ok(log.includes('verify:0.0.12:500000000'));
  assert.ok(log.includes('forward:0.0.11347291:481550000'), '96.31% of 5 HBAR to the artist');
  assert.equal((events[0] as unknown as { target: { ens: string } }).target.ens, 'shaka.osoartist.eth');
  assert.equal(hcsMsg.artist_pay_to, '0.0.11347291');
  assert.equal(hcsMsg.payout_from, 'ENS shaka.osoartist.eth');
});

test('TipGate: daily HBAR budget on top of the run cap', async () => {
  const store = new Map<string, unknown>();
  const gate = new TipGate({ storage: { get: async <T>(k: string) => store.get(k) as T | undefined, put: async (e: Record<string, unknown>) => { for (const [k, v] of Object.entries(e)) store.set(k, v); } } });
  const call = async (path: string, tinybar: bigint) => (await gate.fetch(new Request(`https://gate${path}`, { method: 'POST', body: JSON.stringify({ cap: 50, gapMs: 0, hbarCap: '1000000000', tinybar: tinybar.toString() }) }))).json() as Promise<Record<string, unknown>>;
  assert.equal((await call('/acquire', 600_000_000n)).ok, true);
  const no = await call('/acquire', 500_000_000n);
  assert.equal(no.ok, false);
  assert.equal(no.reason, 'hbar-cap');
  assert.equal(no.remainingHbarToday, 4);
  assert.equal((await call('/acquire', 400_000_000n)).ok, true);
  const s = await call('/state', 0n);
  assert.equal(s.hbarSpentToday, 10);
  assert.equal(s.remainingHbarToday, 0);
});

test('tipConfig: per-run ceiling clamps to 10 HBAR, daily HBAR budget to 500', () => {
  const env = { TIP_GATE: {} as never, FAN_ACCOUNT_ID: '0.0.1', STEWARD_ACCOUNT_ID: '0.0.2', ARTIST_ACCOUNT_ID: '0.0.3', METER_ACCOUNT_ID: '0.0.4', HCS_TOPIC_ID: '0.0.5', FAN_PRIVATE_KEY: 'k', STEWARD_PRIVATE_KEY: 'k', UPSTREAM_API_KEY: 'k', UPSTREAM_MODEL: 'm' } as TipEnv;
  assert.equal(tipConfig(env).maxTipTinybar, 1_000_000_000n);
  assert.equal(tipConfig(env).dailyHbarCapTinybar, 10_000_000_000n);
  assert.equal(tipConfig({ ...env, MAX_TIP_HBAR: '50', DAILY_HBAR_CAP: '9999' }).maxTipTinybar, 1_000_000_000n);
  assert.equal(tipConfig({ ...env, MAX_TIP_HBAR: '50', DAILY_HBAR_CAP: '9999' }).dailyHbarCapTinybar, 50_000_000_000n);
  assert.equal(tipConfig({ ...env, MAX_TIP_HBAR: '2' }).maxTipTinybar, 200_000_000n);
});

test('worker: bad amount / bad artist are refused before any permit or payment', async () => {
  const touched: string[] = [];
  const env = { FAN_ACCOUNT_ID: '0.0.1', STEWARD_ACCOUNT_ID: '0.0.2', ARTIST_ACCOUNT_ID: '0.0.3', METER_ACCOUNT_ID: '0.0.4', HCS_TOPIC_ID: '0.0.5', FAN_PRIVATE_KEY: 'k', STEWARD_PRIVATE_KEY: 'k', UPSTREAM_API_KEY: 'k', UPSTREAM_MODEL: 'm',
    TIP_GATE: { idFromName: () => 'id', get: () => ({ fetch: async (u: string) => { touched.push(u); return Response.json({ ok: true }); } }) } } as unknown as TipEnv;
  const post = (body: unknown) => worker.fetch(new Request('https://w/tip', { method: 'POST', body: JSON.stringify(body) }), env);
  let r = await post({ amountHbar: '11' });
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as { error: string }).error, 'BAD_AMOUNT');
  r = await post({ artist: '0.0.666' });
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as { error: string }).error, 'BAD_ARTIST');
  r = await worker.fetch(new Request('https://w/artist?name=..%2Fx'), env);
  assert.equal(r.status, 400);
  assert.deepEqual(touched, [], 'no permit was taken');
});

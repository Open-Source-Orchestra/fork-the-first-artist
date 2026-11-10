import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTipLoop, splitTip, hbar, hashscanTx, type TipDeps, type TipEvent } from '../src/tip-loop.ts';
import { TipGate, tipConfig, type TipEnv } from '../src/tip-worker.ts';
import type { Gate } from '../../payments/src/gate/types.ts';

const ACCOUNTS = { fan: '0.0.11', steward: '0.0.12', artist: '0.0.13', meter: '0.0.14', topic: '0.0.15', artistLabel: 'demo-artist.oso.eth' };

/** Fake facilitator gate: the header names who paid; records verify/settle order. */
function fakeGate(log: string[], opts: { refuse?: string; settleFail?: string } = {}): Gate {
  return {
    kind: 'hedera',
    async challenge({ resource, amountAtomic, payTo }) {
      const req = { scheme: 'exact' as const, network: 'hedera:testnet', amount: amountAtomic.toString(), asset: '0.0.0', payTo, resource, maxTimeoutSeconds: 180, extra: { feePayer: '0.0.9' } };
      return { status: 402, body: { x402Version: 2, accepts: [req] }, headers: {} };
    },
    async verify({ paymentHeader, requirements }) {
      log.push(`verify:${paymentHeader}->${requirements.payTo}:${requirements.amount}`);
      if (opts.refuse && paymentHeader === opts.refuse) return { ok: false, reason: 'invalid_signature' };
      return { ok: true, payer: paymentHeader, handle: { paymentHeader, requirements } };
    },
    async settle({ requirements }) {
      log.push(`settle:${requirements.payTo}`);
      if (opts.settleFail === requirements.payTo) return { success: false, errorReason: 'insufficient_balance' };
      return { success: true, txId: `0.0.9@17940000${requirements.payTo === ACCOUNTS.meter ? '01' : '02'}.000000001`, network: 'hedera:testnet', payer: 'x' };
    },
  };
}

function deps(log: string[], over: Partial<TipDeps> = {}, gateOpts = {}): TipDeps {
  return {
    gate: fakeGate(log, gateOpts),
    accounts: ACCOUNTS,
    amounts: { tipTinybar: 10_000_000n, meterTinybar: 369_000n },
    fanSign: async () => 'fan-sig',
    stewardSign: async () => 'steward-sig',
    zeroG: async () => { log.push('0g'); return { answer: 'hello from Mira', requestId: 'rid-1', model: '0gm', teeVerified: null }; },
    forward: async (to, amount) => { log.push(`forward:${to}:${amount}`); return { txId: '0.0.12@1794000003.5', status: 'SUCCESS' }; },
    hcs: async (topic, message) => { log.push(`hcs:${topic}:${JSON.parse(message).artist_tinybar}`); return { txId: '0.0.12@1794000004.000000006', status: 'SUCCESS', sequence: '7' }; },
    mirrorSuccess: async () => true,
    ...over,
  };
}

const collect = () => {
  const events: TipEvent[] = [];
  return { events, emit: (e: TipEvent) => { events.push(e); } };
};

test('split is exactly 96.31% / 3.69% and hbar formatting is exact', () => {
  assert.deepEqual(splitTip(10_000_000n), { artist: 9_631_000n, compute: 369_000n });
  assert.deepEqual(splitTip(100_000_000n), { artist: 96_310_000n, compute: 3_690_000n });
  assert.equal(hbar(9_631_000n), '0.09631');
  assert.equal(hbar(100_000_000n), '1');
  assert.equal(hashscanTx('0.0.12@1794000003.5'), 'https://hashscan.io/testnet/transaction/0.0.12-1794000003-000000005');
});

test('full loop: 402 → fan pays steward → steward pays meter → 0G → settle → forward 96.31% → HCS → mirror', async () => {
  const log: string[] = [];
  const { events, emit } = collect();
  const out = await runTipLoop(deps(log), 'who are you?', 'https://w.test', emit);
  assert.equal(out.ok, true);
  assert.deepEqual(events.map((e) => e.step), ['start', 'ask-402', 'ask-signed', 'meter-402', 'meter-paid', 'ask-settled', 'forwarded', 'hcs-logged', 'mirror', 'done']);
  // compute only after both payments verified; fan settles only after the steward answered
  assert.deepEqual(log, [
    'verify:fan-sig->0.0.12:10000000',
    'verify:steward-sig->0.0.14:369000',
    '0g',
    'settle:0.0.14',
    'settle:0.0.12',
    'forward:0.0.13:9631000',
    'hcs:0.0.15:9631000',
  ]);
  const hcs = events.find((e) => e.step === 'hcs-logged')!;
  assert.equal((hcs.record as Record<string, unknown>).oso_tinybar, '0');
  assert.equal((hcs.record as Record<string, unknown>).zg_request_id, 'rid-1');
});

test('a refused fan payment stops before any compute or money moves', async () => {
  const log: string[] = [];
  const { events, emit } = collect();
  const out = await runTipLoop(deps(log, {}, { refuse: 'fan-sig' }), 'q', 'https://w.test', emit);
  assert.equal(out.ok, false);
  const err = events.at(-1)!;
  assert.equal(err.step, 'error');
  assert.equal(err.failedStep, 'ask-verify');
  assert.equal(err.moneyMoved, 'nothing has moved yet');
  assert.ok(!log.includes('0g'));
  assert.ok(!events.some((e) => e.step === 'done' || e.step === 'ask-settled'));
});

test('0G failure: meter not settled, fan not settled, honest error', async () => {
  const log: string[] = [];
  const { events, emit } = collect();
  await runTipLoop(deps(log, { zeroG: async () => { throw new Error('0G returned HTTP 503'); } }), 'q', 'https://w.test', emit);
  assert.ok(!log.some((l) => l.startsWith('settle:')));
  const err = events.at(-1)!;
  assert.equal(err.failedStep, 'meter-pay');
  assert.match(String(err.message), /0G returned HTTP 503/);
});

test('forward failure after settlement reports exactly what moved and never emits done', async () => {
  const log: string[] = [];
  const { events, emit } = collect();
  await runTipLoop(deps(log, { forward: async () => { throw new Error('INSUFFICIENT_PAYER_BALANCE'); } }), 'q', 'https://w.test', emit);
  const err = events.at(-1)!;
  assert.equal(err.failedStep, 'forward');
  assert.match(String(err.moneyMoved), /fan -> steward settled .* and steward -> meter/);
  assert.ok(!events.some((e) => e.step === 'done' || e.step === 'hcs-logged'));
});

test('secret-looking hex never leaks into error messages', async () => {
  const { events, emit } = collect();
  await runTipLoop(deps([], { fanSign: async () => { throw new Error(`bad key ${'ab'.repeat(32)}`); } }), 'q', 'https://w.test', emit);
  assert.doesNotMatch(String(events.at(-1)!.message), /abababab/);
});

test('tipConfig enforces distinct accounts, secrets and hard amount ceilings', () => {
  const env = {
    TIP_GATE: {} as never, FAN_ACCOUNT_ID: '0.0.1', STEWARD_ACCOUNT_ID: '0.0.2', ARTIST_ACCOUNT_ID: '0.0.3', METER_ACCOUNT_ID: '0.0.4', HCS_TOPIC_ID: '0.0.5',
    FAN_PRIVATE_KEY: 'k', STEWARD_PRIVATE_KEY: 'k', UPSTREAM_API_KEY: 'k', UPSTREAM_MODEL: 'm',
  } satisfies TipEnv;
  const cfg = tipConfig(env);
  assert.equal(cfg.amounts.tipTinybar, 10_000_000n);
  assert.equal(cfg.amounts.meterTinybar, 369_000n);
  assert.equal(cfg.dailyCap, 20);
  assert.equal(cfg.minGapMs, 60_000);
  assert.throws(() => tipConfig({ ...env, TIP_TINYBAR: '100000000' }));
  assert.throws(() => tipConfig({ ...env, ARTIST_ACCOUNT_ID: '0.0.1' }));
  assert.throws(() => tipConfig({ ...env, STEWARD_PRIVATE_KEY: undefined }));
  assert.equal(tipConfig({ ...env, MIN_GAP_SECONDS: '1' }).minGapMs, 30_000);
});

test('TipGate: one run per gap globally and a daily cap', async () => {
  const store = new Map<string, unknown>();
  const gate = new TipGate({ storage: { get: async <T>(k: string) => store.get(k) as T | undefined, put: async (e: Record<string, unknown>) => { for (const [k, v] of Object.entries(e)) store.set(k, v); } } });
  const call = async (path: string, cap = 2) => (await gate.fetch(new Request(`https://gate${path}`, { method: 'POST', body: JSON.stringify({ cap, gapMs: 60_000 }) }))).json() as Promise<Record<string, unknown>>;
  assert.equal((await call('/acquire')).ok, true);
  const busy = await call('/acquire');
  assert.equal(busy.ok, false);
  assert.equal(busy.reason, 'cooldown');
  store.set('last', Date.now() - 61_000);
  assert.equal((await call('/acquire')).ok, true);
  store.set('last', Date.now() - 61_000);
  const capped = await call('/acquire');
  assert.equal(capped.reason, 'daily-cap');
  assert.equal((await call('/state')).remainingToday, 0);
});

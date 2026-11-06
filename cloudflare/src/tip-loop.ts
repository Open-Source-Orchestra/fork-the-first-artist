/**
 * "⚡ tip the artist" — the whole Fork-the-First-Artist money loop, run for real on
 * Hedera testnet by one public HTTP call (POST /tip), streamed as NDJSON steps.
 *
 *   1. fan agent    POST /ask (no payment)            -> HTTP 402 challenge (x402 `exact`, HBAR, payTo = steward)
 *   2. fan agent    signs the HBAR TransferTransaction -> retries with X-PAYMENT; facilitator /verify
 *   3. steward      POST /meter                        -> 402 -> pays the 0G meter its 3.69% share via x402
 *                   meter verifies, runs REAL 0G inference, settles                     (meter tx + 0G request id)
 *   4. rail         settles the fan payment (facilitator /settle)                       (fan -> steward tx)
 *   5. steward      forwards 96.31% of the tip to the artist (own-key TransferTransaction)
 *   6. steward      logs the split to HCS topic                                          (HCS tx + sequence)
 *   7. mirror node  re-reads the fan payment and the forward                             (verified true/false)
 *
 * Pure orchestration: every chain/0G side effect is injected (`TipDeps`) so tests can
 * prove ordering, amounts and the fail-closed behaviour. On any failure the stream
 * emits an honest `error` step and stops — nothing is ever simulated.
 */
import type { Gate, PaymentRequirementsView } from '../../payments/src/gate/types.ts';
import { settleConfirmed } from '../../payments/src/settlement.ts';

export const SPLIT_ARTIST_BPS = 9631n; // 96.31%
export const SPLIT_TOTAL_BPS = 10_000n;

export interface TipAmounts {
  tipTinybar: bigint;
  meterTinybar: bigint;
}

export interface TipAccounts {
  fan: string;
  steward: string;
  artist: string;
  meter: string;
  topic: string;
  artistLabel: string;
}

export interface ZeroGResult {
  answer: string;
  requestId: string;
  model: string | null;
  teeVerified: boolean | null;
}

export interface TipDeps {
  gate: Gate;
  accounts: TipAccounts;
  amounts: TipAmounts;
  /** fan agent's x402 client: sign exactly the 402 `accepts` it was given */
  fanSign: (challenge: { x402Version?: number; accepts: unknown[] }) => Promise<string>;
  /** steward agent's x402 client */
  stewardSign: (challenge: { x402Version?: number; accepts: unknown[] }) => Promise<string>;
  zeroG: (question: string) => Promise<ZeroGResult>;
  /** steward -> artist HBAR transfer signed by the steward key; resolves after a SUCCESS receipt */
  forward: (to: string, tinybar: bigint, memo: string) => Promise<{ txId: string; status: string }>;
  /** HCS submit signed by the steward; resolves after a SUCCESS receipt */
  hcs: (topic: string, message: string) => Promise<{ txId: string; status: string; sequence: string | null }>;
  /** mirror node lookup: true once the tx is visible with result SUCCESS */
  mirrorSuccess: (txId: string) => Promise<boolean>;
  now?: () => Date;
}

export type TipEvent = Record<string, unknown> & { step: string };

export const hashscanTx = (id: string): string => {
  // 0.0.123@1700000000.123456789 -> 0.0.123-1700000000-123456789
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(id);
  return `https://hashscan.io/testnet/transaction/${m ? `${m[1]}-${m[2]}-${m[3].padStart(9, '0')}` : encodeURIComponent(id)}`;
};

export const hbar = (tinybar: bigint): string => {
  const s = tinybar.toString().padStart(9, '0');
  const whole = s.slice(0, -8);
  const frac = s.slice(-8).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
};

export function splitTip(tip: bigint): { artist: bigint; compute: bigint } {
  const artist = (tip * SPLIT_ARTIST_BPS) / SPLIT_TOTAL_BPS;
  return { artist, compute: tip - artist };
}

class StepFailure extends Error {
  readonly failedStep: string;
  readonly moneyMoved: string;
  constructor(failedStep: string, message: string, moneyMoved: string) {
    super(message);
    this.failedStep = failedStep;
    this.moneyMoved = moneyMoved;
  }
}

/**
 * One x402 paid resource, in-process: no X-PAYMENT -> 402 challenge; with
 * X-PAYMENT -> facilitator verify, run `work`, then settle. Same order as
 * payments/src/server.ts: compute only after a valid payment, settle after.
 */
async function paidResource<T>(
  gate: Gate,
  opts: { resource: string; payTo: string; amount: bigint; description: string },
  paymentHeader: string | undefined,
  work: () => Promise<T>,
): Promise<
  | { status: 402; challenge: { x402Version: number; accepts: PaymentRequirementsView[] }; reason?: string }
  | { status: 200; result: T; txId: string; payer: string | null }
> {
  const challenge = await gate.challenge({
    resource: opts.resource,
    amountAtomic: opts.amount,
    payTo: opts.payTo,
    description: opts.description,
  });
  const requirements = challenge.body.accepts[0];
  if (!requirements) throw new Error('empty x402 challenge');
  if (!paymentHeader) return { status: 402, challenge: challenge.body as never };
  const verified = await gate.verify({ paymentHeader, requirements });
  if (!verified.ok) return { status: 402, challenge: challenge.body as never, reason: verified.reason ?? 'invalid payment' };
  const result = await work();
  const settled = await settleConfirmed(gate, { handle: verified.handle, requirements });
  if (!settled.ok) throw new Error(`${settled.body.error}: ${settled.body.message}`);
  return { status: 200, result, txId: settled.txId, payer: settled.settlement.payer ?? verified.payer ?? null };
}

export async function runTipLoop(
  deps: TipDeps,
  question: string,
  origin: string,
  emit: (e: TipEvent) => void | Promise<void>,
): Promise<{ ok: boolean }> {
  const { gate, accounts: a, amounts } = deps;
  const tip = amounts.tipTinybar;
  const split = splitTip(tip);
  const now = deps.now ?? (() => new Date());
  let moneyMoved = 'nothing has moved yet';
  const started = now().toISOString();

  await emit({
    step: 'start',
    at: started,
    network: 'hedera:testnet',
    asset: 'HBAR (0.0.0)',
    tipHbar: hbar(tip),
    meterHbar: hbar(amounts.meterTinybar),
    split: { artistHbar: hbar(split.artist), computeHbar: hbar(split.compute), artistPct: '96.31', computePct: '3.69', osoPct: '0' },
    accounts: { fan: a.fan, steward: a.steward, artist: a.artist, meter: a.meter, hcsTopic: a.topic },
    artistLabel: a.artistLabel,
  });

  try {
    // ── 1. fan asks without paying -> 402 ────────────────────────────────
    const askOpts = { resource: `${origin}/ask`, payTo: a.steward, amount: tip, description: `tip ${a.artistLabel}: one steward answer` };
    let zg: ZeroGResult | null = null;
    let meterTx = '';
    const askWork = async () => {
      // ── 3. the steward pays the 0G meter (x402) for its own inference ──
      const meterOpts = { resource: `${origin}/meter/v1/chat/completions`, payTo: a.meter, amount: amounts.meterTinybar, description: '0G inference via the x402 meter' };
      const m1 = await paidResource(gate, meterOpts, undefined, async () => null);
      if (m1.status !== 402) throw new StepFailure('meter-402', 'meter did not challenge', moneyMoved);
      await emit({ step: 'meter-402', status: 402, payTo: a.meter, amountHbar: hbar(amounts.meterTinybar), scheme: m1.challenge.accepts[0]?.scheme });
      let stewardHeader: string;
      try {
        stewardHeader = await deps.stewardSign(m1.challenge);
      } catch (e) {
        throw new StepFailure('meter-sign', `steward could not sign the meter payment: ${msg(e)}`, moneyMoved);
      }
      let m2;
      try {
        m2 = await paidResource(gate, meterOpts, stewardHeader, async () => deps.zeroG(question));
      } catch (e) {
        throw new StepFailure('meter-pay', `0G meter call failed: ${msg(e)}`, moneyMoved);
      }
      if (m2.status !== 200) throw new StepFailure('meter-pay', `meter refused the steward payment: ${m2.reason}`, moneyMoved);
      zg = m2.result;
      meterTx = m2.txId;
      moneyMoved = `steward paid the 0G meter (${meterTx}); the fan payment is verified but not yet settled`;
      await emit({
        step: 'meter-paid',
        txId: meterTx,
        hashscan: hashscanTx(meterTx),
        amountHbar: hbar(amounts.meterTinybar),
        zeroG: { requestId: zg.requestId, model: zg.model, teeVerified: zg.teeVerified },
        answer: zg.answer,
      });
      return zg;
    };

    const r1 = await paidResource(gate, askOpts, undefined, askWork);
    if (r1.status !== 402) throw new StepFailure('ask-402', 'the ask endpoint did not challenge', moneyMoved);
    const req = r1.challenge.accepts[0]!;
    await emit({ step: 'ask-402', status: 402, scheme: req.scheme, network: req.network, asset: req.asset, amountTinybar: req.amount, amountHbar: hbar(tip), payTo: req.payTo, feePayer: (req.extra as { feePayer?: string } | undefined)?.feePayer ?? null });

    // ── 2. fan signs and retries ─────────────────────────────────────────
    let fanHeader: string;
    try {
      fanHeader = await deps.fanSign(r1.challenge);
    } catch (e) {
      throw new StepFailure('ask-sign', `fan agent could not sign: ${msg(e)}`, moneyMoved);
    }
    await emit({ step: 'ask-signed', payer: a.fan, note: 'fan agent signed an HBAR TransferTransaction for exactly the 402 requirements; retrying with X-PAYMENT' });

    let r2;
    try {
      r2 = await paidResource(gate, askOpts, fanHeader, askWork);
    } catch (e) {
      if (e instanceof StepFailure) throw e;
      throw new StepFailure('ask-settle', `fan payment did not settle: ${msg(e)}`, moneyMoved);
    }
    if (r2.status !== 200) throw new StepFailure('ask-verify', `facilitator refused the fan payment: ${r2.reason}`, moneyMoved);
    const askTx = r2.txId;
    moneyMoved = `fan -> steward settled (${askTx})${meterTx ? ` and steward -> meter (${meterTx})` : ''}`;
    await emit({ step: 'ask-settled', txId: askTx, hashscan: hashscanTx(askTx), from: a.fan, to: a.steward, amountHbar: hbar(tip), payer: r2.payer });

    // ── 5. forward 96.31% to the artist ──────────────────────────────────
    let fwd;
    try {
      fwd = await deps.forward(a.artist, split.artist, `OSO split 96.31% of ${askTx}`.slice(0, 100));
    } catch (e) {
      throw new StepFailure('forward', `steward forward to the artist failed: ${msg(e)}`, moneyMoved);
    }
    moneyMoved += `, steward -> artist (${fwd.txId})`;
    await emit({ step: 'forwarded', txId: fwd.txId, hashscan: hashscanTx(fwd.txId), status: fwd.status, from: a.steward, to: a.artist, amountHbar: hbar(split.artist) });

    // ── 6. HCS split log ─────────────────────────────────────────────────
    const record = {
      v: 1,
      kind: 'oso-steward-split',
      source: 'oso-tip-loop worker (public judge demo)',
      artist: a.artistLabel,
      settled_tx: askTx,
      tip_tinybar: tip.toString(),
      artist_tinybar: split.artist.toString(),
      compute_tinybar: split.compute.toString(),
      oso_tinybar: '0',
      forward_tx: fwd.txId,
      meter_tx: meterTx,
      zg_request_id: (zg as ZeroGResult | null)?.requestId ?? null,
      at: now().toISOString(),
    };
    let h;
    try {
      h = await deps.hcs(a.topic, JSON.stringify(record));
    } catch (e) {
      throw new StepFailure('hcs', `HCS split log failed: ${msg(e)}`, moneyMoved);
    }
    await emit({ step: 'hcs-logged', txId: h.txId, hashscan: hashscanTx(h.txId), topic: a.topic, topicHashscan: `https://hashscan.io/testnet/topic/${a.topic}`, sequence: h.sequence, status: h.status, record });

    // ── 7. re-read from the mirror node ─────────────────────────────────
    const [askOnMirror, fwdOnMirror] = await Promise.all([deps.mirrorSuccess(askTx), deps.mirrorSuccess(fwd.txId)]);
    await emit({ step: 'mirror', askSettledOnMirror: askOnMirror, forwardOnMirror: fwdOnMirror });

    await emit({ step: 'done', ok: true, startedAt: started, finishedAt: now().toISOString(), txs: { ask: askTx, meter: meterTx, forward: fwd.txId, hcs: h.txId } });
    return { ok: true };
  } catch (e) {
    const f = e instanceof StepFailure ? e : new StepFailure('internal', msg(e), moneyMoved);
    await emit({ step: 'error', ok: false, failedStep: f.failedStep, message: f.message, moneyMoved: f.moneyMoved, proof: 'https://github.com/Open-Source-Orchestra/fork-the-first-artist/blob/main/docs/TX-PROOF.md' });
    return { ok: false };
  }
}

/** Short, secret-free error text. */
function msg(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.replace(/[0-9a-f]{60,}/gi, '[redacted]').slice(0, 300);
}

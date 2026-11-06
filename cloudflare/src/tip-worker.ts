/**
 * Worker `oso-tip-loop`: public judge-clickable "⚡ tip the artist" demo.
 *
 *   GET  /health  -> config summary (public ids only) + today's remaining runs
 *   POST /tip     -> runs the REAL x402 loop on Hedera testnet, NDJSON stream of steps
 *
 * Abuse/spend controls: one run per 60 s globally and a small UTC-daily cap, both held
 * in a single Durable Object (`TipGate`) so they are global, not per isolate. Amounts
 * are fixed server-side (0.1 HBAR tip, 0.00369 HBAR meter) — the caller only sends a
 * question. Testnet only; synthetic demo accounts; keys are Worker secrets.
 */
import './window-shim.ts';
import type { Config } from '../../payments/src/config.ts';
import { createHederaGate } from '../../payments/src/gate/hedera.ts';
import { spendControlsFor } from '../../agent/src/rails/payer.ts';
import { callZeroG } from './zero-g.ts';
import { runTipLoop, type TipDeps, type TipEvent } from './tip-loop.ts';

/** Minimal Workers runtime types (this package does not depend on @cloudflare/workers-types). */
interface GateStub { fetch(url: string, init?: RequestInit): Promise<Response> }
interface GateNamespace { idFromName(name: string): unknown; get(id: unknown): GateStub }
interface WaitCtx { waitUntil(p: Promise<unknown>): void }
interface GateState {
  storage: { get<T>(key: string): Promise<T | undefined>; put(entries: Record<string, unknown>): Promise<void> };
}

export interface TipEnv {
  TIP_GATE: GateNamespace;
  FAN_ACCOUNT_ID?: string;
  FAN_PRIVATE_KEY?: string;
  STEWARD_ACCOUNT_ID?: string;
  STEWARD_PRIVATE_KEY?: string;
  ARTIST_ACCOUNT_ID?: string;
  METER_ACCOUNT_ID?: string;
  HCS_TOPIC_ID?: string;
  ARTIST_LABEL?: string;
  UPSTREAM_API_KEY?: string;
  UPSTREAM_BASE_URL?: string;
  UPSTREAM_MODEL?: string;
  TIP_TINYBAR?: string;
  METER_TINYBAR?: string;
  DAILY_CAP?: string;
  MIN_GAP_SECONDS?: string;
  FACILITATOR_URL?: string;
  MIRROR_URL?: string;
}

export const TIP_ALLOWED_ORIGINS = new Set([
  'https://artist.opensourceorchestra.org',
  'https://artist-preview-kzu6ctlpau-ffieyo32.taur.link',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);

const NETWORK = 'hedera:testnet';
const PROOF_URL = 'https://github.com/Open-Source-Orchestra/fork-the-first-artist/blob/main/docs/TX-PROOF.md';

function cors(origin: string | null): Record<string, string> {
  return origin && TIP_ALLOWED_ORIGINS.has(origin)
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'Origin',
      }
    : { vary: 'Origin' };
}

function json(data: unknown, status: number, origin: string | null, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors(origin), ...extra },
  });
}

const acct = (v: string | undefined, name: string): string => {
  const t = v?.trim() ?? '';
  if (!/^0\.0\.\d+$/.test(t)) throw new Error(`${name} must be a Hedera account id`);
  return t;
};
const tinybar = (v: string | undefined, fallback: bigint, max: bigint): bigint => {
  const n = v?.trim() ? BigInt(v.trim()) : fallback;
  if (n < 1n || n > max) throw new Error('amount out of range');
  return n;
};

export function tipConfig(env: TipEnv) {
  const accounts = {
    fan: acct(env.FAN_ACCOUNT_ID, 'FAN_ACCOUNT_ID'),
    steward: acct(env.STEWARD_ACCOUNT_ID, 'STEWARD_ACCOUNT_ID'),
    artist: acct(env.ARTIST_ACCOUNT_ID, 'ARTIST_ACCOUNT_ID'),
    meter: acct(env.METER_ACCOUNT_ID, 'METER_ACCOUNT_ID'),
    topic: acct(env.HCS_TOPIC_ID, 'HCS_TOPIC_ID'),
    artistLabel: (env.ARTIST_LABEL ?? 'demo-artist.oso.eth').slice(0, 64),
  };
  if (new Set([accounts.fan, accounts.steward, accounts.artist, accounts.meter]).size !== 4) throw new Error('roles must be distinct');
  if (!env.FAN_PRIVATE_KEY || !env.STEWARD_PRIVATE_KEY || !env.UPSTREAM_API_KEY || !env.UPSTREAM_MODEL) throw new Error('secrets missing');
  return {
    accounts,
    amounts: {
      // hard server-side ceilings: a tip can never exceed 0.5 HBAR, a meter call 0.05 HBAR
      tipTinybar: tinybar(env.TIP_TINYBAR, 10_000_000n, 50_000_000n),
      meterTinybar: tinybar(env.METER_TINYBAR, 369_000n, 5_000_000n),
    },
    dailyCap: Math.min(Math.max(Number(env.DAILY_CAP ?? '20') || 20, 1), 50),
    minGapMs: Math.min(Math.max(Number(env.MIN_GAP_SECONDS ?? '60') || 60, 30), 3600) * 1000,
    facilitatorUrl: (env.FACILITATOR_URL ?? 'https://x402.org/facilitator').replace(/\/+$/, ''),
    mirror: (env.MIRROR_URL ?? 'https://testnet.mirrornode.hedera.com').replace(/\/+$/, ''),
  };
}

/** x402 client signer for one account; per-payment cap = exactly the configured price. */
async function x402Signer(accountId: string, privateKey: string, capTinybar: bigint) {
  const [{ x402Client }, { encodePaymentSignatureHeader }, hedera, { ExactHederaScheme }] = await Promise.all([
    import('@x402/core/client'),
    import('@x402/core/http'),
    import('@x402/hedera'),
    import('@x402/hedera/exact/client'),
  ]);
  const signer = hedera.createClientHederaSigner(accountId, hedera.PrivateKey.fromStringECDSA(privateKey), { network: NETWORK });
  const capHbar = (Number(capTinybar) / 1e8).toFixed(8).replace(/\.?0+$/, '');
  const client = new x402Client()
    .register(NETWORK, new ExactHederaScheme(signer))
    .setSpendControls(spendControlsFor({ network: NETWORK, asset: '0.0.0', assetDecimals: 8, maxPerPaymentAsset: capHbar }) as never);
  return async (challenge: { x402Version?: number; accepts: unknown[] }) => {
    const payload = await client.createPaymentPayload({ x402Version: challenge.x402Version ?? 2, accepts: challenge.accepts } as never);
    return encodePaymentSignatureHeader(payload as never);
  };
}

async function hederaClient(accountId: string, privateKey: string) {
  const sdk = await import('@hiero-ledger/sdk');
  const client = sdk.WebClient.forTestnet();
  client.setOperator(sdk.AccountId.fromString(accountId), sdk.PrivateKey.fromStringECDSA(privateKey));
  return { sdk, client };
}

async function realDeps(env: TipEnv, cfg: ReturnType<typeof tipConfig>): Promise<TipDeps> {
  const gate = createHederaGate({ network: NETWORK, facilitatorUrl: cfg.facilitatorUrl, asset: { id: '0.0.0', decimals: 8 } } as Config);
  const fanSign = await x402Signer(cfg.accounts.fan, env.FAN_PRIVATE_KEY!, cfg.amounts.tipTinybar);
  const stewardSign = await x402Signer(cfg.accounts.steward, env.STEWARD_PRIVATE_KEY!, cfg.amounts.meterTinybar);
  const { sdk, client } = await hederaClient(cfg.accounts.steward, env.STEWARD_PRIVATE_KEY!);
  const zcfg = {
    upstreamApiKey: env.UPSTREAM_API_KEY!,
    upstreamBaseUrl: (env.UPSTREAM_BASE_URL ?? 'https://router-api.0g.ai/v1').replace(/\/+$/, ''),
    upstreamModel: env.UPSTREAM_MODEL!,
    upstreamTrustMode: 'verified',
    maxOutputTokens: 320,
  };
  return {
    gate,
    accounts: cfg.accounts,
    amounts: cfg.amounts,
    fanSign,
    stewardSign,
    zeroG: async (q) => {
      const r = await callZeroG(q, zcfg, fetch);
      return { answer: r.answer, requestId: r.provenance.requestId, model: r.provenance.model, teeVerified: r.provenance.routerReportedTeeVerified };
    },
    forward: async (to, amount, memo) => {
      const tx = await new sdk.TransferTransaction()
        .addHbarTransfer(sdk.AccountId.fromString(cfg.accounts.steward), sdk.Hbar.fromTinybars(`-${amount}`))
        .addHbarTransfer(sdk.AccountId.fromString(to), sdk.Hbar.fromTinybars(amount.toString()))
        // No transaction memo: protobufjs' Buffer string path (utf8Write) throws ERR_OUT_OF_RANGE in
        // workerd for any memo string; the HCS record below carries the settled-tx link instead.
        .execute(client);
      void memo;
      const receipt = await tx.getReceipt(client);
      return { txId: tx.transactionId!.toString(), status: receipt.status.toString() };
    },
    hcs: async (topic, message) => {
      const tx = await new sdk.TopicMessageSubmitTransaction().setTopicId(sdk.TopicId.fromString(topic)).setMessage(message).execute(client);
      const receipt = await tx.getReceipt(client);
      return { txId: tx.transactionId!.toString(), status: receipt.status.toString(), sequence: receipt.topicSequenceNumber?.toString() ?? null };
    },
    mirrorSuccess: async (txId) => {
      const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(txId);
      const id = m ? `${m[1]}-${m[2]}-${m[3].padStart(9, '0')}` : txId;
      for (let i = 0; i < 8; i++) {
        try {
          const r = await fetch(`${cfg.mirror}/api/v1/transactions/${id}`, { signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            const body = (await r.json()) as { transactions?: { result?: string }[] };
            if (body.transactions?.some((t) => t.result === 'SUCCESS')) return true;
          }
        } catch {
          /* mirror lag */
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
      return false;
    },
  };
}

async function readQuestion(request: Request): Promise<string> {
  const text = await request.text();
  if (text.length > 2048) throw new Error('body too large');
  let q = 'Who are you, and which song should a first-time fan hear?';
  if (text.trim()) {
    const body = JSON.parse(text) as { question?: unknown };
    if (typeof body.question === 'string' && body.question.trim()) q = body.question.trim().slice(0, 280);
  }
  return q;
}

export default {
  async fetch(request: Request, env: TipEnv, ctx?: WaitCtx): Promise<Response> {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    if (origin && !TIP_ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403, null);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    let cfg: ReturnType<typeof tipConfig>;
    try {
      cfg = tipConfig(env);
    } catch {
      return json({ ok: false, error: 'NOT_CONFIGURED', message: 'the tip loop is not configured', proof: PROOF_URL }, 503, origin);
    }
    const gate = env.TIP_GATE.get(env.TIP_GATE.idFromName('global'));

    if (url.pathname === '/health') {
      const state = (await (await gate.fetch('https://gate/state', { method: 'POST', body: JSON.stringify({ cap: cfg.dailyCap, gapMs: cfg.minGapMs }) })).json()) as Record<string, unknown>;
      return json({
        ok: true,
        service: 'oso-tip-loop',
        routes: ['POST /tip', 'GET /health'],
        network: NETWORK,
        asset: 'HBAR (0.0.0)',
        tipHbar: Number(cfg.amounts.tipTinybar) / 1e8,
        meterHbar: Number(cfg.amounts.meterTinybar) / 1e8,
        split: { artist: '96.31%', compute: '3.69%', oso: '0%' },
        accounts: cfg.accounts,
        facilitator: cfg.facilitatorUrl,
        limits: { oneRunEverySeconds: cfg.minGapMs / 1000, dailyCap: cfg.dailyCap, ...state },
        synthetic: 'all four accounts are synthetic testnet demo accounts; no real artist is paid',
      }, 200, origin);
    }
    if (url.pathname !== '/tip') return json({ ok: false, error: 'NOT_FOUND', message: 'use GET /health or POST /tip' }, 404, origin);
    if (request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, origin, { allow: 'POST' });

    let question: string;
    try {
      question = await readQuestion(request);
    } catch {
      return json({ ok: false, error: 'BAD_REQUEST', message: 'send {"question": "..."} (≤280 chars) or an empty body' }, 400, origin);
    }

    const permit = (await (await gate.fetch('https://gate/acquire', { method: 'POST', body: JSON.stringify({ cap: cfg.dailyCap, gapMs: cfg.minGapMs }) })).json()) as { ok: boolean; reason?: string; retryAfterSeconds?: number; runsToday?: number };
    if (!permit.ok) {
      return json({ ok: false, error: 'RATE_LIMITED', reason: permit.reason, retryAfterSeconds: permit.retryAfterSeconds, message: permit.reason === 'daily-cap' ? 'today’s live-run cap is used up — see the recorded proof' : 'someone just ran the live loop — try again shortly', proof: PROOF_URL }, 429, origin, { 'retry-after': String(permit.retryAfterSeconds ?? 60) });
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const emit = async (e: TipEvent) => {
      await writer.write(enc.encode(`${JSON.stringify(e)}\n`));
    };
    const work = (async () => {
      try {
        const deps = await realDeps(env, cfg);
        await runTipLoop(deps, question, url.origin, emit);
      } catch {
        await emit({ step: 'error', ok: false, failedStep: 'setup', message: 'the live loop could not start; nothing was paid', moneyMoved: 'nothing has moved yet', proof: PROOF_URL });
      } finally {
        await writer.close();
      }
    })();
    ctx?.waitUntil(work);
    return new Response(readable, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-run-number-today': String(permit.runsToday ?? ''), ...cors(origin) },
    });
  },
};

/** Global run gate: one run per `gapMs`, at most `cap` runs per UTC day. */
export class TipGate {
  private readonly state: GateState;
  constructor(state: GateState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const { cap, gapMs } = (await request.json()) as { cap: number; gapMs: number };
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const last = ((await this.state.storage.get<number>('last')) ?? 0);
    const storedDay = (await this.state.storage.get<string>('day')) ?? day;
    const count = storedDay === day ? ((await this.state.storage.get<number>('count')) ?? 0) : 0;
    const path = new URL(request.url).pathname;
    const nextInSeconds = Math.max(0, Math.ceil((last + gapMs - now) / 1000));
    if (path === '/state') {
      return Response.json({ runsToday: count, remainingToday: Math.max(0, cap - count), nextRunInSeconds: nextInSeconds });
    }
    if (count >= cap) {
      const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
      return Response.json({ ok: false, reason: 'daily-cap', retryAfterSeconds: Math.ceil((midnight - now) / 1000), runsToday: count });
    }
    if (nextInSeconds > 0) return Response.json({ ok: false, reason: 'cooldown', retryAfterSeconds: nextInSeconds, runsToday: count });
    await this.state.storage.put({ last: now, day, count: count + 1 });
    return Response.json({ ok: true, runsToday: count + 1 });
  }
}

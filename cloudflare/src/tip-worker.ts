/**
 * Worker `oso-tip-loop`: public judge-clickable "⚡ tip the artist" demo.
 *
 *   GET  /health          -> config summary (public ids only) + today's remaining runs / HBAR
 *   GET  /artist?name=x   -> who `x.osoartist.eth` pays, resolved live from their own ENS records
 *   POST /tip             -> runs the REAL x402 loop on Hedera testnet, NDJSON stream of steps
 *                            body { question?, amountHbar? (0.01–10), artist? (garden slug) }
 *
 * No `artist`: the example loop pays the synthetic demo artist (Mira Modal). With `artist`, the
 * steward forwards 96.31% to the payout the artist set on their OWN ENS name — the request can
 * never name an account. Spend controls (one Durable Object `TipGate`, global): one run per gap,
 * a UTC-daily run cap AND a UTC-daily HBAR budget; per-run ceiling 10 HBAR. Testnet only; the
 * fan and steward are demo accounts whose keys are Worker secrets.
 */
import './window-shim.ts';
import type { Config } from '../../payments/src/config.ts';
import type { PaymentRequirementsView } from '../../payments/src/gate/types.ts';
import { createHederaGate } from '../../payments/src/gate/hedera.ts';
import { spendControlsFor } from '../../agent/src/rails/payer.ts';
import { callZeroG } from './zero-g.ts';
import { runTipLoop, type TipDeps, type TipEvent } from './tip-loop.ts';
import { STEWARDS, type StewardArtist } from './zero-g.ts';
import { HARD_MAX_TIP_TINYBAR, MIN_TIP_TINYBAR, TipRequestError, meterFor, parseTipRequest, resolveArtistTarget, type ArtistTarget, type ResolvedPayTo, type TargetDeps } from './pay-target.ts';
// @ts-expect-error — plain ESM module shared with the ENS leg (tested there)
import { resolvePayTo } from '../../ens/src/resolve-artist.mjs';
import { DirectTipError, assetFor, checkReceivable, networkConfig, walletHealth, type AssetInfo, type DirectEnv, type MirrorResult, type NetworkConfig, type TipRecord } from './direct-split.ts';
import { claimIn, prepareTip, settleTip, publicRecord, type TipStore, type WalletDeps } from './wallet-tip.ts';
import { attachSignature, buildLegTx, fanPublicKey } from './wallet-tx.ts';

/** Minimal Workers runtime types (this package does not depend on @cloudflare/workers-types). */
interface GateStub { fetch(url: string, init?: RequestInit): Promise<Response> }
interface GateNamespace { idFromName(name: string): unknown; get(id: unknown): GateStub }
interface WaitCtx { waitUntil(p: Promise<unknown>): void }
interface GateState {
  storage: { get<T>(key: string): Promise<T | undefined>; put(entries: Record<string, unknown>): Promise<void> };
}

export interface TipEnv extends DirectEnv {
  TIP_GATE: GateNamespace;
  /** secret, unset until Shaka's go: signs the mainnet HCS ledger message (never a payment) */
  MAINNET_STEWARD_PRIVATE_KEY?: string;
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
  DAILY_HBAR_CAP?: string;
  MAX_TIP_HBAR?: string;
  MIN_GAP_SECONDS?: string;
  ENS_RPC_URL?: string;
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

const DEFAULT_ENS_RPC = 'https://eth.drpc.org,https://rpc.mevblocker.io,https://eth-mainnet.public.blastapi.io,https://1rpc.io/eth,https://eth.rpc.blxrbdn.com,https://ethereum-rpc.publicnode.com';
const ensRpc = (env: { ENS_RPC_URL?: string }) => env.ENS_RPC_URL?.trim() || DEFAULT_ENS_RPC;

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
      // defaults for the example run; a caller may pick any amount in [0.01, maxTip]
      tipTinybar: tinybar(env.TIP_TINYBAR, 10_000_000n, 50_000_000n),
      meterTinybar: tinybar(env.METER_TINYBAR, 369_000n, 5_000_000n),
    },
    // hard ceilings: ≤10 HBAR per run, ≤500 HBAR per UTC day, ≤200 runs per day
    maxTipTinybar: BigInt(Math.round(Math.min(Math.max(Number(env.MAX_TIP_HBAR ?? '10') || 10, 0.01), Number(HARD_MAX_TIP_TINYBAR) / 1e8) * 1e8)),
    dailyHbarCapTinybar: BigInt(Math.round(Math.min(Math.max(Number(env.DAILY_HBAR_CAP ?? '100') || 100, 1), 500) * 1e8)),
    ensRpcUrl: ensRpc(env),
    dailyCap: Math.min(Math.max(Number(env.DAILY_CAP ?? '20') || 20, 1), 200),
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

export interface RunPlan {
  tipTinybar: bigint;
  meterTinybar: bigint;
  target: ArtistTarget | null;
}

/** The 0G steward speaks for: the artist's garden steward (asked or preview) if one exists, else a minimal consented-artist profile. */
export function stewardFor(target: ArtistTarget | null): StewardArtist | undefined {
  if (!target) return undefined; // example run: the fictional demo artist (callZeroG default)
  const known = Object.hasOwn(STEWARDS, target.label) ? STEWARDS[target.label] : undefined;
  // Roster artists get their preview steward (public garden profile only); never the fictional demo.
  if (known && known.mode !== 'demo') return known;
  return { slug: target.label, fictional: false, mode: 'preview', label: target.ens, data: { name: target.ens, note: 'A real artist in the Open Source Orchestra garden who consented with their own key and owns this ENS name. No further public profile is loaded into this steward yet.' } };
}

/** Successful ENS resolutions only, 60 s per isolate: a payout change on ENS shows up within a minute. */
const ENS_CACHE = new Map<string, { value: ResolvedPayTo; until: number }>();

/** ENS answers that are authoritative refusals (from resolve-artist.mjs) — never papered over with a stored read. */
const PAYTO_REFUSALS = new Set(['bad-name', 'network-mismatch', 'no-consent', 'steward-paused', 'bad-record', 'no-payout', 'claim-inactive', 'mismatch']);
export const LAST_GOOD_MAX_MS = 6 * 3600_000;

/** Durable last-good store (TipGate) so a public-RPC rate limit doesn't break a judge's click. */
export interface LastGoodStore {
  get(name: string): Promise<{ value: ResolvedPayTo; at: number } | null>;
  put(name: string, value: ResolvedPayTo): Promise<void>;
}

export function targetDeps(cfg: { ensRpcUrl: string; mirror: string }, fetchImpl: typeof fetch = fetch, store: LastGoodStore | null = null,
  live: (name: string) => Promise<ResolvedPayTo> = (name) => resolvePayTo(name, { network: 'testnet', requireConsent: true, rpcUrl: cfg.ensRpcUrl }),
  network: 'testnet' | 'mainnet' = 'testnet'): TargetDeps {
  // the cache and the last-good store are per network: a mainnet tip never uses a testnet read
  const key = (name: string) => (network === 'testnet' ? name : `${network}:${name}`);
  return {
    resolve: async (name) => {
      const hit = ENS_CACHE.get(key(name));
      if (hit && hit.until > Date.now()) return hit.value;
      try {
        const value = await live(name);
        ENS_CACHE.set(key(name), { value, until: Date.now() + 60_000 });
        // last-good fallback only for testnet: a mainnet payout is never paid from a stored read
        if (network === 'testnet') await store?.put(name, value).catch(() => {});
        return value;
      } catch (e) {
        const code = (e as { code?: string })?.code ?? '';
        console.error('ens resolve failed', name, code, String((e as Error)?.message ?? e).slice(0, 300));
        if (PAYTO_REFUSALS.has(code) || !store || network !== 'testnet') throw e;
        // transport failure (rate limit / timeout): use the last LIVE read, if recent, and say so
        const last = await store.get(name).catch(() => null);
        if (!last || Date.now() - last.at > LAST_GOOD_MAX_MS) throw e;
        return { ...last.value, lastLiveReadAt: new Date(last.at).toISOString() };
      }
    },
    aliasAccount: async (evm) => {
      const r = await fetchImpl(`${cfg.mirror}/api/v1/accounts/${evm.toLowerCase()}`, { signal: AbortSignal.timeout(6000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`mirror ${r.status}`);
      const b = (await r.json()) as { account?: string; evm_address?: string };
      return typeof b.account === 'string' && /^0\.0\.\d+$/.test(b.account) && b.evm_address?.toLowerCase() === evm.toLowerCase() ? b.account : null;
    },
  };
}

async function realDeps(env: TipEnv, cfg: ReturnType<typeof tipConfig>, run: RunPlan): Promise<TipDeps> {
  const gate = createHederaGate({ network: NETWORK, facilitatorUrl: cfg.facilitatorUrl, asset: { id: '0.0.0', decimals: 8 } } as Config);
  const fanSign = await x402Signer(cfg.accounts.fan, env.FAN_PRIVATE_KEY!, run.tipTinybar);
  const stewardSign = await x402Signer(cfg.accounts.steward, env.STEWARD_PRIVATE_KEY!, run.meterTinybar);
  const { sdk, client } = await hederaClient(cfg.accounts.steward, env.STEWARD_PRIVATE_KEY!);
  const zcfg = {
    upstreamApiKey: env.UPSTREAM_API_KEY!,
    upstreamBaseUrl: (env.UPSTREAM_BASE_URL ?? 'https://router-api.0g.ai/v1').replace(/\/+$/, ''),
    upstreamModel: env.UPSTREAM_MODEL!,
    upstreamTrustMode: 'verified',
    maxOutputTokens: 320,
  };
  const t = run.target;
  const steward = stewardFor(t);
  return {
    gate,
    accounts: t ? { ...cfg.accounts, artist: t.payTo, artistLabel: t.ens } : cfg.accounts,
    amounts: { tipTinybar: run.tipTinybar, meterTinybar: run.meterTinybar },
    target: t ? { ens: t.ens, payTo: t.payTo, accountId: t.accountId, alias: t.alias, source: t.source } : null,
    fanSign,
    stewardSign,
    zeroG: async (q) => {
      const r = await callZeroG(q, zcfg, fetch, steward);
      return { answer: r.answer, requestId: r.provenance.requestId, model: r.provenance.model, teeVerified: r.provenance.routerReportedTeeVerified };
    },
    forward: async (to, amount, memo) => {
      const tx = await new sdk.TransferTransaction()
        .addHbarTransfer(sdk.AccountId.fromString(cfg.accounts.steward), sdk.Hbar.fromTinybars(`-${amount}`))
        .addHbarTransfer(/^0x[0-9a-fA-F]{40}$/.test(to) ? sdk.AccountId.fromEvmAddress(0, 0, to) : sdk.AccountId.fromString(to), sdk.Hbar.fromTinybars(amount.toString()))
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


// ── fan-wallet direct split (plan steps 3–5) ─────────────────────────────────────

/** TipStore backed by the TipGate Durable Object instance "wallet" (claim is atomic there). */
export function gateTipStore(gate: GateStub): TipStore {
  const call = async <T>(path: string, body: unknown): Promise<T> => (await (await gate.fetch(`https://gate${path}`, { method: 'POST', body: JSON.stringify(body) })).json()) as T;
  return {
    get: async (id) => (await call<{ rec?: TipRecord }>('/w/get', { id })).rec ?? null,
    put: async (rec) => { await call('/w/put', { rec }); },
    claim: async (id, leg, now, leaseMs) => call('/w/claim', { id, leg, now, leaseMs }),
    appendLedger: async (network, label, line) => { await call('/w/ledger-append', { network, label, line }); },
    ledger: async (network, label) => (await call<{ lines?: Record<string, unknown>[] }>('/w/ledger', { network, label })).lines ?? [],
    admit: async (network, currency, atomic, cap, budget) => call('/w/admit', { network, currency, atomic: atomic.toString(), cap, budget: budget.toString() }),
  };
}

/** x402 payment header for a transaction the FAN's wallet already signed (no key here). */
export async function walletPaymentHeader(requirements: PaymentRequirementsView, signedTx: string): Promise<string> {
  const [{ x402Client }, { encodePaymentSignatureHeader }, { ExactHederaScheme }] = await Promise.all([
    import('@x402/core/client'),
    import('@x402/core/http'),
    import('@x402/hedera/exact/client'),
  ]);
  const signer = {
    accountId: 'wallet',
    createPartiallySignedTransferTransaction: async (r: { payTo: string; amount: string; asset: string }) => {
      if (r.payTo !== requirements.payTo || r.amount !== requirements.amount || r.asset !== requirements.asset) throw new Error('requirements changed');
      return signedTx;
    },
  };
  const decimals = requirements.asset === '0.0.0' ? 8 : 6;
  const cap = (Number(BigInt(requirements.amount)) / 10 ** decimals).toFixed(decimals).replace(/\.?0+$/, '');
  const client = new x402Client()
    .register(requirements.network as never, new ExactHederaScheme(signer as never))
    .setSpendControls(spendControlsFor({ network: requirements.network, asset: requirements.asset, assetDecimals: decimals, maxPerPaymentAsset: cap }) as never);
  const payload = await client.createPaymentPayload({ x402Version: 2, accepts: [requirements] } as never);
  return encodePaymentSignatureHeader(payload as never);
}

export async function mirrorTxResult(mirror: string, txId: string, fetchImpl: typeof fetch = fetch): Promise<MirrorResult | null> {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(txId);
  const id = m ? `${m[1]}-${m[2]}-${m[3]!.padStart(9, '0')}` : txId;
  try {
    const r = await fetchImpl(`${mirror}/api/v1/transactions/${id}`, { signal: AbortSignal.timeout(6000) });
    if (r.status === 404) return 'NOT_FOUND';
    if (!r.ok) return null;
    const b = (await r.json()) as { transactions?: { result?: string; scheduled?: boolean }[] };
    const own = (b.transactions ?? []).filter((t) => !t.scheduled);
    if (!own.length) return 'NOT_FOUND';
    if (own.some((t) => t.result === 'SUCCESS')) return 'SUCCESS';
    return { failed: own[0]!.result ?? 'UNKNOWN' };
  } catch {
    return null;
  }
}

export function walletDeps(env: TipEnv, gateNs: GateNamespace, fetchImpl: typeof fetch = fetch): WalletDeps {
  const store = gateTipStore(gateNs.get(gateNs.idFromName('wallet')));
  const ensGate = gateStore(gateNs.get(gateNs.idFromName('global')));
  const gates = new Map<string, ReturnType<typeof createHederaGate>>();
  const feePayers = new Map<string, string>();
  return {
    env,
    store,
    resolveArtist: async (label, network) => {
      const mirror = network === 'mainnet' ? (env.MAINNET_MIRROR_URL?.trim() || 'https://mainnet-public.mirrornode.hedera.com') : (env.MIRROR_URL?.trim() || 'https://testnet.mirrornode.hedera.com');
      const rpc = ensRpc(env);
      const deps = targetDeps({ ensRpcUrl: rpc, mirror }, fetchImpl, ensGate, (name) => resolvePayTo(name, { network, requireConsent: true, rpcUrl: rpc }), network);
      try {
        return await resolveArtistTarget(label, deps, []);
      } catch (e) {
        if (e instanceof TipRequestError) throw new DirectTipError(e.code, e.message, e.code === 'BAD_ARTIST' ? 400 : 404);
        throw e;
      }
    },
    gateFor: (cfg, asset) => {
      const k = `${cfg.caip2}|${cfg.facilitatorUrl}|${asset.id}`;
      if (!gates.has(k)) gates.set(k, createHederaGate({ network: cfg.caip2, facilitatorUrl: cfg.facilitatorUrl, asset: { id: asset.id, decimals: asset.decimals } } as Config));
      return gates.get(k)!;
    },
    feePayer: async (cfg, gate) => {
      const k = `${cfg.caip2}|${cfg.facilitatorUrl}`;
      if (!feePayers.has(k)) {
        const c = await gate.challenge({ resource: 'oso-tip:probe', amountAtomic: 1n, payTo: cfg.stewardAccount, description: 'probe' });
        const fp = (c.body.accepts[0]?.extra as { feePayer?: string } | undefined)?.feePayer;
        if (!fp || !/^0\.0\.\d+$/.test(fp)) throw new DirectTipError('FACILITATOR_UNAVAILABLE', 'the facilitator did not advertise a Hedera fee payer', 503);
        feePayers.set(k, fp);
      }
      return feePayers.get(k)!;
    },
    receivable: (cfg, account, asset: AssetInfo) => checkReceivable(cfg.mirror, account, asset, fetchImpl),
    buildLeg: (o) => buildLegTx(o),
    attach: async (cfg, fan, leg, sig) => attachSignature(leg, sig, await fanPublicKey(cfg.mirror, fan, fetchImpl)),
    paymentHeader: walletPaymentHeader,
    mirrorTx: (cfg, txId) => mirrorTxResult(cfg.mirror, txId, fetchImpl),
    hcs: async (cfg: NetworkConfig, message: string) => {
      const key = cfg.network === 'mainnet' ? env.MAINNET_STEWARD_PRIVATE_KEY : env.STEWARD_PRIVATE_KEY;
      if (!key || !cfg.hcsTopic) throw new Error('HCS ledger key not configured');
      const sdk = await import('@hiero-ledger/sdk');
      const client = cfg.network === 'mainnet' ? sdk.WebClient.forMainnet() : sdk.WebClient.forTestnet();
      client.setOperator(sdk.AccountId.fromString(cfg.stewardAccount), sdk.PrivateKey.fromStringECDSA(key));
      const tx = await new sdk.TopicMessageSubmitTransaction().setTopicId(sdk.TopicId.fromString(cfg.hcsTopic)).setMessage(message).execute(client);
      const receipt = await tx.getReceipt(client);
      return { txId: tx.transactionId!.toString(), sequence: receipt.topicSequenceNumber?.toString() ?? null };
    },
    reserved: (cfg) => cfg.network === 'testnet' ? [env.FAN_ACCOUNT_ID, env.STEWARD_ACCOUNT_ID, env.METER_ACCOUNT_ID].filter((a): a is string => Boolean(a)) : [cfg.stewardAccount],
  };
}

async function walletRoute(url: URL, request: Request, env: TipEnv, origin: string | null, deps: WalletDeps): Promise<Response> {
  try {
    if (url.pathname === '/wallet/prepare' || url.pathname === '/wallet/settle') {
      if (request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, origin, { allow: 'POST' });
      const text = await request.text();
      if (text.length > 16_384) throw new DirectTipError('BAD_REQUEST', 'body too large');
      const out = url.pathname === '/wallet/prepare' ? await prepareTip(deps, text) : await settleTip(deps, text);
      return json({ ok: true, ...out }, 200, origin);
    }
    if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, origin, { allow: 'GET' });
    if (url.pathname === '/wallet/tip') {
      const id = url.searchParams.get('id') ?? '';
      const rec = /^[A-Za-z0-9_-]{16,64}$/.test(id) ? await deps.store.get(id) : null;
      if (!rec) return json({ ok: false, error: 'NOT_FOUND' }, 404, origin);
      const cfg = networkConfig(env, rec.network);
      const fp = await deps.feePayer(cfg, deps.gateFor(cfg, assetFor(rec.network, rec.currency)));
      return json({ ok: true, record: publicRecord(rec, cfg, fp) }, 200, origin);
    }
    if (url.pathname === '/wallet/ledger') {
      const cfg = networkConfig(env, url.searchParams.get('network') ?? 'testnet');
      const label = url.searchParams.get('artist') ?? '';
      if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(label)) throw new DirectTipError('BAD_ARTIST', 'artist must be a garden slug');
      return json({ ok: true, network: cfg.caip2, artist: `${label}.osoartist.eth`, lines: await deps.store.ledger(cfg.network, label) }, 200, origin);
    }
    if (url.pathname === '/wallet/check') {
      const cfg = networkConfig(env, url.searchParams.get('network') ?? 'testnet');
      const currency = url.searchParams.get('currency') === 'USDC' ? 'USDC' : 'HBAR';
      const asset = assetFor(cfg.network, currency);
      const t = await deps.resolveArtist(url.searchParams.get('artist') ?? '', cfg.network);
      const artist = t.accountId ? await deps.receivable(cfg, t.accountId, asset) : await checkReceivable(cfg.mirror, t.alias ?? t.payTo, asset);
      return json({ ok: true, network: cfg.caip2, currency, asset: asset.id, artist: { ...t, receivable: artist } }, 200, origin);
    }
    return json({ ok: false, error: 'NOT_FOUND' }, 404, origin);
  } catch (e) {
    const err = e instanceof DirectTipError ? e : null;
    if (!err) console.error('wallet route failed', String((e as Error)?.message ?? e).slice(0, 300));
    const extra = (e as { retryAfterSeconds?: number }).retryAfterSeconds;
    return json({ ok: false, error: err?.code ?? 'INTERNAL', message: err?.message ?? 'the wallet tip service hit an error — nothing was paid by this request', ...(extra ? { retryAfterSeconds: extra } : {}) }, err?.status ?? 500, origin);
  }
}

/** The network a POST /tip body asks for ("testnet" when absent or unparseable — parseTipRequest rejects bad JSON). */
export function demoFanNetwork(text: string): string {
  try {
    const b = text.trim() ? JSON.parse(text) : {};
    return b && typeof b === 'object' && !Array.isArray(b) && 'network' in b ? String(b.network) : 'testnet';
  } catch {
    return 'testnet';
  }
}

const DEFAULT_QUESTION = 'Who are you, and which song should a first-time fan hear?';
const ARTIST_QUESTION = 'Who is this artist, and what should a first-time fan know?';
function gateStore(gate: GateStub): LastGoodStore {
  return {
    get: async (name) => {
      const b = (await (await gate.fetch('https://gate/ens-get', { method: 'POST', body: JSON.stringify({ name }) })).json()) as { value?: ResolvedPayTo; at?: number };
      return b.value && typeof b.at === 'number' ? { value: b.value, at: b.at } : null;
    },
    put: async (name, value) => { await gate.fetch('https://gate/ens-put', { method: 'POST', body: JSON.stringify({ name, value }) }); },
  };
}
const reservedAccounts = (cfg: ReturnType<typeof tipConfig>) => [cfg.accounts.fan, cfg.accounts.steward, cfg.accounts.meter];

export default {
  async fetch(request: Request, env: TipEnv, ctx?: WaitCtx): Promise<Response> {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    if (origin && !TIP_ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403, null);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    // the fan's own wallet pays (two direct x402 payments) — needs no server fan key at all
    if (url.pathname.startsWith('/wallet/')) return walletRoute(url, request, env, origin, walletDeps(env, env.TIP_GATE));

    let cfg: ReturnType<typeof tipConfig>;
    try {
      cfg = tipConfig(env);
    } catch {
      return json({ ok: false, error: 'NOT_CONFIGURED', message: 'the tip loop is not configured', proof: PROOF_URL }, 503, origin);
    }
    const gate = env.TIP_GATE.get(env.TIP_GATE.idFromName('global'));

    if (url.pathname === '/health') {
      const state = (await (await gate.fetch('https://gate/state', { method: 'POST', body: JSON.stringify({ cap: cfg.dailyCap, gapMs: cfg.minGapMs, hbarCap: cfg.dailyHbarCapTinybar.toString() }) })).json()) as Record<string, unknown>;
      return json({
        ok: true,
        service: 'oso-tip-loop',
        routes: ['POST /tip', 'GET /artist?name=<slug>', 'GET /health'],
        network: NETWORK,
        asset: 'HBAR (0.0.0)',
        tipHbar: Number(cfg.amounts.tipTinybar) / 1e8,
        meterHbar: Number(cfg.amounts.meterTinybar) / 1e8,
        amount: { minHbar: Number(MIN_TIP_TINYBAR) / 1e8, maxHbar: Number(cfg.maxTipTinybar) / 1e8, defaultHbar: Number(cfg.amounts.tipTinybar) / 1e8, meter: '3.69% of the tip' },
        split: { artist: '96.31%', compute: '3.69%', oso: '0%' },
        accounts: cfg.accounts,
        facilitator: cfg.facilitatorUrl,
        limits: { oneRunEverySeconds: cfg.minGapMs / 1000, dailyCap: cfg.dailyCap, dailyHbarCap: Number(cfg.dailyHbarCapTinybar) / 1e8, ...state },
        synthetic: 'the fan, steward and meter are testnet demo accounts; without `artist` the example pays the fictional demo artist, with `artist` the payout comes from that artist\'s own ENS name',
        demoFan: { route: 'POST /tip', network: NETWORK, label: 'DEMO: a server-side testnet fan signs — never available on mainnet' },
        wallet: { routes: ['POST /wallet/prepare', 'POST /wallet/settle', 'GET /wallet/tip?id=', 'GET /wallet/ledger?artist=&network=', 'GET /wallet/check?artist=&network=&currency='], ...walletHealth(env) },
      }, 200, origin);
    }
    if (url.pathname === '/artist') {
      if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, origin, { allow: 'GET' });
      try {
        const t = await resolveArtistTarget(url.searchParams.get('name') ?? '', targetDeps(cfg, fetch, gateStore(gate)), reservedAccounts(cfg));
        return json({ ok: true, network: NETWORK, artist: t, resolvedFrom: 'Ethereum mainnet ENS (the artist\'s own resolver), read just now' }, 200, origin);
      } catch (e) {
        const err = e instanceof TipRequestError ? e : new TipRequestError('ARTIST_NOT_PAYABLE', 'could not resolve the artist — nothing was paid');
        return json({ ok: false, error: err.code, message: err.message }, err.code === 'BAD_ARTIST' ? 400 : 404, origin);
      }
    }
    if (url.pathname !== '/tip') return json({ ok: false, error: 'NOT_FOUND', message: 'use GET /health, GET /artist?name=<slug> or POST /tip' }, 404, origin);
    if (request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, origin, { allow: 'POST' });

    let run: RunPlan;
    let question: string;
    try {
      const text = await request.text();
      // the server demo fan exists on testnet ONLY — whatever the mainnet switch says
      if (demoFanNetwork(text) !== 'testnet') {
        return json({ ok: false, error: 'DEMO_FAN_TESTNET_ONLY', message: 'the server demo fan only runs on Hedera testnet; on mainnet a fan pays from their own wallet (POST /wallet/prepare) — nothing was paid' }, 403, origin);
      }
      const req = parseTipRequest(text, cfg.maxTipTinybar);
      const target = req.artist ? await resolveArtistTarget(req.artist, targetDeps(cfg, fetch, gateStore(gate)), reservedAccounts(cfg)) : null;
      run = { tipTinybar: req.tipTinybar, meterTinybar: meterFor(req.tipTinybar), target };
      question = req.question ?? (target ? ARTIST_QUESTION : DEFAULT_QUESTION);
    } catch (e) {
      const err = e instanceof TipRequestError ? e : new TipRequestError('BAD_REQUEST', 'send {"question"?, "amountHbar"?, "artist"?} or an empty body');
      return json({ ok: false, error: err.code, message: err.message }, err.code === 'ARTIST_NOT_PAYABLE' ? 404 : 400, origin);
    }

    const permit = (await (await gate.fetch('https://gate/acquire', { method: 'POST', body: JSON.stringify({ cap: cfg.dailyCap, gapMs: cfg.minGapMs, hbarCap: cfg.dailyHbarCapTinybar.toString(), tinybar: run.tipTinybar.toString() }) })).json()) as { ok: boolean; reason?: string; retryAfterSeconds?: number; runsToday?: number; remainingHbarToday?: number };
    if (!permit.ok) {
      const message = permit.reason === 'daily-cap' ? 'today’s live-run cap is used up — see the recorded proof'
        : permit.reason === 'hbar-cap' ? `that would pass today’s testnet HBAR budget (${permit.remainingHbarToday ?? 0} HBAR left) — try a smaller amount`
        : 'someone just ran the live loop — try again shortly';
      return json({ ok: false, error: 'RATE_LIMITED', reason: permit.reason, retryAfterSeconds: permit.retryAfterSeconds, remainingHbarToday: permit.remainingHbarToday, message, proof: PROOF_URL }, 429, origin, { 'retry-after': String(permit.retryAfterSeconds ?? 60) });
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const emit = async (e: TipEvent) => {
      await writer.write(enc.encode(`${JSON.stringify(e)}\n`));
    };
    const work = (async () => {
      try {
        const deps = await realDeps(env, cfg, run);
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
    const p = new URL(request.url).pathname;
    if (p.startsWith('/w/')) return this.wallet(p, (await request.json()) as Record<string, unknown>);
    if (p === '/ens-get' || p === '/ens-put') {
      const b = (await request.json()) as { name?: string; value?: unknown };
      if (typeof b.name !== 'string' || !/^[a-z0-9-]{1,40}\.osoartist\.eth$/.test(b.name)) return Response.json({});
      if (p === '/ens-get') return Response.json((await this.state.storage.get<Record<string, unknown>>(`ens:${b.name}`)) ?? {});
      await this.state.storage.put({ [`ens:${b.name}`]: { value: b.value, at: Date.now() } });
      return Response.json({ ok: true });
    }
    const { cap, gapMs, hbarCap, tinybar } = (await request.json()) as { cap: number; gapMs: number; hbarCap?: string; tinybar?: string };
    const budget = BigInt(hbarCap ?? '0');
    const want = BigInt(tinybar ?? '0');
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const last = ((await this.state.storage.get<number>('last')) ?? 0);
    const storedDay = (await this.state.storage.get<string>('day')) ?? day;
    const count = storedDay === day ? ((await this.state.storage.get<number>('count')) ?? 0) : 0;
    const spent = storedDay === day ? BigInt((await this.state.storage.get<string>('spent')) ?? '0') : 0n;
    const leftHbar = budget > 0n ? Number(budget > spent ? budget - spent : 0n) / 1e8 : null;
    const path = new URL(request.url).pathname;
    const nextInSeconds = Math.max(0, Math.ceil((last + gapMs - now) / 1000));
    if (path === '/state') {
      return Response.json({ runsToday: count, remainingToday: Math.max(0, cap - count), nextRunInSeconds: nextInSeconds, hbarSpentToday: Number(spent) / 1e8, remainingHbarToday: leftHbar });
    }
    if (count >= cap) {
      const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
      return Response.json({ ok: false, reason: 'daily-cap', retryAfterSeconds: Math.ceil((midnight - now) / 1000), runsToday: count });
    }
    if (budget > 0n && spent + want > budget) {
      const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
      return Response.json({ ok: false, reason: 'hbar-cap', retryAfterSeconds: Math.ceil((midnight - now) / 1000), runsToday: count, remainingHbarToday: leftHbar });
    }
    if (nextInSeconds > 0) return Response.json({ ok: false, reason: 'cooldown', retryAfterSeconds: nextInSeconds, runsToday: count });
    await this.state.storage.put({ last: now, day, count: count + 1, spent: (spent + want).toString() });
    return Response.json({ ok: true, runsToday: count + 1, remainingHbarToday: budget > 0n ? Number(budget - spent - want) / 1e8 : null });
  }

  /** Fan-wallet tip records + per-artist ledgers. Each call is one atomic read-modify-write. */
  private async wallet(p: string, b: Record<string, unknown>): Promise<Response> {
    const okId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);
    const okLedger = (n: unknown, l: unknown) => (n === 'testnet' || n === 'mainnet') && typeof l === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(l);
    const s = this.state.storage;
    if (p === '/w/get') return Response.json(okId(b.id) ? { rec: (await s.get<TipRecord>(`tip:${b.id}`)) ?? null } : {});
    if (p === '/w/put') {
      const rec = b.rec as TipRecord | undefined;
      if (!rec || !okId(rec.id)) return Response.json({ ok: false }, { status: 400 });
      await s.put({ [`tip:${rec.id}`]: rec });
      return Response.json({ ok: true });
    }
    if (p === '/w/claim') {
      if (!okId(b.id) || (b.leg !== 'artist' && b.leg !== 'steward')) return Response.json({ ok: false, reason: 'missing' });
      const rec = (await s.get<TipRecord>(`tip:${b.id}`)) ?? null;
      let saved: TipRecord | null = null;
      const out = claimIn(rec ? structuredClone(rec) : null, b.leg, Number(b.now), Number(b.leaseMs), (r) => { saved = r; });
      if (saved) await s.put({ [`tip:${b.id}`]: saved });
      return Response.json(out);
    }
    if (p === '/w/ledger-append' || p === '/w/ledger') {
      if (!okLedger(b.network, b.label)) return Response.json({ lines: [] });
      const k = `ledger:${b.network}:${b.label}`;
      const lines = (await s.get<Record<string, unknown>[]>(k)) ?? [];
      if (p === '/w/ledger') return Response.json({ lines });
      await s.put({ [k]: [b.line as Record<string, unknown>, ...lines].slice(0, 50) });
      return Response.json({ ok: true });
    }
    if (p === '/w/admit') {
      const day = new Date().toISOString().slice(0, 10);
      const k = `admit:${String(b.network)}:${String(b.currency)}`;
      const cur = (await s.get<{ day: string; count: number; spent: string }>(k)) ?? { day, count: 0, spent: '0' };
      const st = cur.day === day ? cur : { day, count: 0, spent: '0' };
      const retryAfterSeconds = Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86_400_000 - Date.now()) / 1000);
      if (st.count >= Number(b.cap)) return Response.json({ ok: false, reason: 'cap', retryAfterSeconds });
      if (BigInt(st.spent) + BigInt(String(b.atomic)) > BigInt(String(b.budget))) return Response.json({ ok: false, reason: 'budget', retryAfterSeconds });
      await s.put({ [k]: { day, count: st.count + 1, spent: (BigInt(st.spent) + BigInt(String(b.atomic))).toString() } });
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false }, { status: 404 });
  }
}

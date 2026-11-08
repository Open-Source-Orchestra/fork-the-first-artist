/**
 * The fan-wallet tip (plan steps 3–5): the fan's OWN Hedera wallet signs two x402 `exact` payments,
 * one to the artist (96.31%) and one to the steward (3.69%). OSO never holds the money.
 *
 *   POST /wallet/prepare  { id, network, currency, amount, artist, fan }
 *        -> resolves the artist's payout from THEIR ENS name, checks both payees can receive the asset,
 *           builds both unsigned transfers (fees on the facilitator's feePayer), stores the tip record
 *           under the idempotency key `id`, returns the two TransactionBody blobs for the wallet.
 *           Same id again -> the same record (only an unsettled leg whose old tx provably can't land
 *           anymore is rebuilt). Same id + different tip -> 409.
 *   POST /wallet/settle   { id, signatures: { artist?: <SignatureMap b64>, steward?: <…> } }
 *        -> artist leg first, then steward. Per leg: never twice (settled = skip; the mirror is checked
 *           for the leg's fixed txId before any resubmit), facilitator /verify then /settle, recorded.
 *           Leg 1 ok + leg 2 failed => state "partial": the artist is paid, only leg 2 is retried.
 *   GET  /wallet/tip?id=  the stored record (no secrets in it — the fan's signatures are not stored)
 *   GET  /wallet/ledger?artist=&network=  the per-artist ledger (latest 50 lines)
 *
 * Pure orchestration with every side effect injected (`WalletDeps`) so tests prove ordering,
 * idempotency, recovery and the mainnet refusal without a network.
 */
import type { Gate, PaymentRequirementsView } from '../../payments/src/gate/types.ts';
import {
  DirectTipError, LEASE_MS, assertConserved, assetFor, networkConfig, fingerprint, fromAtomic, hashscan, ledgerLine, legDecision, parseDirectTip, splitDirect, tipState,
  type AssetInfo, type DirectEnv, type DirectTipRequest, type LegName, type LegRecord, type MirrorResult, type NetworkConfig, type Receivable, type TipRecord,
} from './direct-split.ts';
import type { ArtistTarget } from './pay-target.ts';
import { checkLegBody, type LegTx } from './wallet-tx.ts';

/** Durable per-tip store. `claim` must be atomic (the TipGate Durable Object serializes it). */
export interface TipStore {
  get(id: string): Promise<TipRecord | null>;
  put(rec: TipRecord): Promise<void>;
  /** atomically: if leg is not settled and not leased, lease it (status settling) and return the record */
  claim(id: string, leg: LegName, now: number, leaseMs: number): Promise<{ ok: true; rec: TipRecord } | { ok: false; reason: 'settled' | 'in-flight' | 'missing' }>;
  appendLedger(network: string, label: string, line: Record<string, unknown>): Promise<void>;
  ledger(network: string, label: string): Promise<Record<string, unknown>[]>;
  /** daily cap for NEW tips (per network+currency); false = over the cap */
  admit(network: string, currency: string, atomic: bigint, cap: number, budget: bigint): Promise<{ ok: boolean; reason?: string; retryAfterSeconds?: number }>;
}

export interface WalletDeps {
  env: DirectEnv;
  store: TipStore;
  /** label -> payable target on `network` (ENS, consent required), reserved accounts refused */
  resolveArtist: (label: string, network: 'testnet' | 'mainnet') => Promise<ArtistTarget>;
  gateFor: (cfg: NetworkConfig, asset: AssetInfo) => Gate;
  /** the facilitator's feePayer for this network (from GET /supported) */
  feePayer: (cfg: NetworkConfig, gate: Gate) => Promise<string>;
  receivable: (cfg: NetworkConfig, account: string, asset: AssetInfo) => Promise<Receivable>;
  buildLeg: (o: { fan: string; payTo: string; amount: bigint; asset: string; feePayer: string }) => Promise<LegTx>;
  /** wallet SignatureMap -> signed tx base64 (checks the fan key) */
  attach: (cfg: NetworkConfig, fan: string, leg: LegRecord, signatureMap: unknown) => Promise<string>;
  /** x402 payment header for a signed tx + requirements (x402Client + ExactHederaScheme) */
  paymentHeader: (requirements: PaymentRequirementsView, signedTxB64: string) => Promise<string>;
  mirrorTx: (cfg: NetworkConfig, txId: string) => Promise<MirrorResult | null>;
  hcs: ((cfg: NetworkConfig, message: string) => Promise<{ txId: string; sequence: string | null }>) | null;
  /** reserved OSO accounts that may never be an artist payee */
  reserved: (cfg: NetworkConfig) => string[];
  now?: () => number;
}

const ORDER: LegName[] = ['artist', 'steward'];

function requirementsFor(cfg: NetworkConfig, asset: AssetInfo, leg: LegRecord, feePayer: string, rec: TipRecord): PaymentRequirementsView {
  return {
    scheme: 'exact',
    network: cfg.caip2,
    amount: leg.amount,
    asset: asset.id,
    payTo: leg.payTo,
    resource: `oso-tip:${rec.id}:${leg.leg}`,
    description: leg.leg === 'artist' ? `96.31% tip to ${rec.artist.ens}` : `3.69% to the steward of ${rec.artist.ens} (0G compute)`,
    maxTimeoutSeconds: 180,
    extra: { feePayer },
  };
}

/** What the browser needs per leg: the body to sign + the plan to check it against. */
function legView(rec: TipRecord, leg: LegRecord, feePayer: string, cfg: NetworkConfig) {
  return {
    leg: leg.leg,
    payTo: leg.payTo,
    amount: leg.amount,
    amountDisplay: `${fromAtomic(BigInt(leg.amount), rec.decimals)} ${rec.currency}`,
    status: leg.status,
    txId: leg.txId,
    bodyBytes: leg.status === 'settled' ? null : leg.bodyBytes,
    validUntil: new Date(leg.validUntilMs).toISOString(),
    feePayer,
    settledTx: leg.settledTx ?? null,
    hashscan: leg.settledTx ? hashscan(cfg.network, 'transaction', leg.settledTx) : null,
    error: leg.error ?? null,
  };
}

export function publicRecord(rec: TipRecord, cfg: NetworkConfig, feePayer: string) {
  return {
    id: rec.id,
    state: tipState(rec),
    network: `hedera:${rec.network}`,
    currency: rec.currency,
    asset: rec.asset,
    total: rec.total,
    totalDisplay: `${fromAtomic(BigInt(rec.total), rec.decimals)} ${rec.currency}`,
    artist: rec.artist,
    fan: rec.fan,
    split: { artist: '96.31%', steward: '3.69%', oso: '0%', custody: 'none' },
    legs: rec.legs.map((l) => legView(rec, l, feePayer, cfg)),
    hcs: rec.hcs ?? null,
  };
}

async function newLeg(deps: WalletDeps, name: LegName, payTo: string, amount: bigint, fan: string, asset: AssetInfo, feePayer: string, abandoned: string[] = []): Promise<LegRecord> {
  const tx = await deps.buildLeg({ fan, payTo, amount, asset: asset.id, feePayer });
  // self-check with the SAME decoder the browser runs before it asks the wallet
  const problems = checkLegBody(tx.bodyBytes, { fan, payTo, amount, asset: asset.id, feePayer });
  if (problems.length) throw new DirectTipError('BUILD_MISMATCH', `prepared ${name} transfer failed its own check: ${problems.join('; ')}`, 500);
  return { leg: name, payTo, amount: amount.toString(), status: 'prepared', txId: tx.txId, txBytes: tx.txBytes, bodyBytes: tx.bodyBytes, validUntilMs: tx.validUntilMs, attempts: 0, ...(abandoned.length ? { abandoned } : {}) };
}

export async function prepareTip(deps: WalletDeps, bodyText: string) {
  const now = (deps.now ?? Date.now)();
  const { req, cfg, asset } = parseDirectTip(bodyText, deps.env);
  const target = await deps.resolveArtist(req.artist, cfg.network);
  if (!target.accountId) {
    throw new DirectTipError('PAYEE_ALIAS_ONLY', `${target.ens} pays a wallet address (${target.alias}) that has no Hedera ${cfg.network} account yet. x402 facilitators only pay a 0.0.N account, and an alias-only payee can never receive USDC. The artist can receive any HBAR once to activate it, or set a 0.0.N payout on /payout.`, 409);
  }
  const reserved = deps.reserved(cfg);
  if (reserved.includes(target.accountId) && target.accountId !== cfg.stewardAccount) throw new DirectTipError('ARTIST_NOT_PAYABLE', `${target.ens} points at an OSO account — refusing`, 409);
  if (target.accountId === cfg.stewardAccount) throw new DirectTipError('ARTIST_NOT_PAYABLE', `${target.ens} points at the steward account — refusing`, 409);
  if (req.fan === target.accountId || req.fan === cfg.stewardAccount) throw new DirectTipError('BAD_FAN', 'the fan account cannot be a payee of its own tip', 400);
  const fp = fingerprint(req, target.accountId, cfg.stewardAccount);
  const gate = deps.gateFor(cfg, asset);
  const feePayer = await deps.feePayer(cfg, gate);

  const existing = await deps.store.get(req.id);
  if (existing) {
    if (existing.fingerprint !== fp) throw new DirectTipError('IDEMPOTENCY_CONFLICT', 'this tip id was already used for a different tip — use a new id per tip', 409);
    // rebuild only legs whose old transaction provably can never land
    let changed = false;
    for (let i = 0; i < existing.legs.length; i++) {
      const leg = existing.legs[i]!;
      if (leg.status === 'settled') continue;
      const decision = legDecision(leg, now, now > leg.validUntilMs || leg.status !== 'prepared' ? await deps.mirrorTx(cfg, leg.txId) : null);
      if (decision === 'reconcile') {
        existing.legs[i] = { ...leg, status: 'settled', settledTx: leg.txId, error: undefined, leaseUntilMs: undefined };
        changed = true;
      } else if (decision === 'rebuild') {
        existing.legs[i] = await newLeg(deps, leg.leg, leg.payTo, BigInt(leg.amount), existing.fan, asset, feePayer, [...(leg.abandoned ?? []), leg.txId]);
        changed = true;
      }
    }
    if (changed) {
      existing.updatedAt = new Date(now).toISOString();
      await deps.store.put(existing);
    }
    return { reused: true, record: publicRecord(existing, cfg, feePayer) };
  }

  // a NEW tip: both payees must be able to receive this asset
  for (const [who, acct] of [['artist', target.accountId], ['steward', cfg.stewardAccount]] as const) {
    const r = await deps.receivable(cfg, acct, asset);
    if (!r.ok) throw new DirectTipError(r.code === 'mirror-error' ? 'MIRROR_UNAVAILABLE' : who === 'artist' ? 'ARTIST_CANNOT_RECEIVE' : 'STEWARD_CANNOT_RECEIVE', `${who}: ${r.message}`, r.code === 'mirror-error' ? 503 : 409);
  }
  const permit = await deps.store.admit(cfg.network, req.currency, req.amount, cfg.dailyCap, cfg.dailyBudget[req.currency]);
  if (!permit.ok) throw Object.assign(new DirectTipError('RATE_LIMITED', permit.reason === 'budget' ? `today's ${cfg.network} ${req.currency} budget for wallet tips is used up` : `today's ${cfg.network} wallet-tip cap is used up`, 429), { retryAfterSeconds: permit.retryAfterSeconds });

  const split = splitDirect(req.amount);
  const legs = [
    await newLeg(deps, 'artist', target.accountId, split.artist, req.fan, asset, feePayer),
    await newLeg(deps, 'steward', cfg.stewardAccount, split.steward, req.fan, asset, feePayer),
  ];
  const at = new Date(now).toISOString();
  const rec: TipRecord = {
    v: 1, id: req.id, fingerprint: fp, network: cfg.network, currency: req.currency, asset: asset.id, decimals: asset.decimals,
    artist: { label: target.label, ens: target.ens, payTo: target.accountId, source: target.source },
    fan: req.fan, total: req.amount.toString(), legs, createdAt: at, updatedAt: at,
  };
  assertConserved(rec);
  await deps.store.put(rec);
  return { reused: false, record: publicRecord(rec, cfg, feePayer) };
}

export interface SettleBody { id?: unknown; network?: unknown; signatures?: Record<string, unknown> }

export async function settleTip(deps: WalletDeps, bodyText: string) {
  const now = deps.now ?? Date.now;
  let b: SettleBody;
  try {
    b = JSON.parse(bodyText);
  } catch {
    throw new DirectTipError('BAD_REQUEST', 'body must be JSON');
  }
  if (typeof b?.id !== 'string') throw new DirectTipError('BAD_ID', 'id is required');
  const rec0 = await deps.store.get(b.id);
  if (!rec0) throw new DirectTipError('NOT_FOUND', 'no prepared tip with this id — prepare it first', 404);
  // the mainnet switch is re-checked at settle time too: turning it off stops in-flight mainnet tips
  const cfg = networkConfig(deps.env, rec0.network);
  const asset = assetFor(rec0.network, rec0.currency);
  const gate = deps.gateFor(cfg, asset);
  const feePayer = await deps.feePayer(cfg, gate);
  assertConserved(rec0);
  const sigs = b.signatures && typeof b.signatures === 'object' ? b.signatures : {};
  const results: Record<string, unknown>[] = [];

  for (const name of ORDER) {
    const cur = await deps.store.get(b.id);
    const leg = cur!.legs.find((l) => l.leg === name)!;
    if (leg.status === 'settled') { results.push({ leg: name, status: 'settled', txId: leg.settledTx, already: true }); continue; }
    // before ANY (re)submission: has this exact txId already landed?
    const mirror = leg.attempts > 0 || now() > leg.validUntilMs ? await deps.mirrorTx(cfg, leg.txId) : null;
    const decision = legDecision(leg, now(), mirror);
    if (decision === 'reconcile') {
      await finishLeg(deps, b.id, name, { status: 'settled', settledTx: leg.txId });
      results.push({ leg: name, status: 'settled', txId: leg.txId, reconciled: true });
      continue;
    }
    if (decision === 'in-flight') { results.push({ leg: name, status: 'in-flight', message: 'another settle is running for this leg, or its old transaction may still land — retry in a minute' }); break; }
    if (decision === 'rebuild') { results.push({ leg: name, status: 'needs-new-signature', message: 'this leg\'s transaction expired without landing — prepare again (same id) and sign the new one' }); break; }
    const sig = sigs[name];
    if (!sig) { results.push({ leg: name, status: 'needs-signature' }); break; }
    const claim = await deps.store.claim(b.id, name, now(), LEASE_MS);
    if (!claim.ok) { results.push({ leg: name, status: claim.reason }); break; }
    let header: string;
    const requirements = requirementsFor(cfg, asset, leg, feePayer, cur!);
    try {
      const signed = await deps.attach(cfg, cur!.fan, leg, sig);
      header = await deps.paymentHeader(requirements, signed);
    } catch (e) {
      await finishLeg(deps, b.id, name, { status: 'failed', error: short(e) });
      results.push({ leg: name, status: 'failed', step: 'signature', error: short(e) });
      break;
    }
    try {
      const v = await gate.verify({ paymentHeader: header, requirements });
      if (!v.ok) throw new Error(`facilitator refused: ${v.reason ?? 'invalid payment'}`);
      const s = await gate.settle({ handle: v.handle, requirements });
      if (!s.success || !s.txId) throw new Error(`settle failed: ${s.errorReason ?? 'no transaction id'}`);
      if (s.txId !== leg.txId) console.warn('facilitator returned a different tx id', s.txId, leg.txId);
      await finishLeg(deps, b.id, name, { status: 'settled', settledTx: s.txId });
      results.push({ leg: name, status: 'settled', txId: s.txId, hashscan: hashscan(cfg.network, 'transaction', s.txId) });
    } catch (e) {
      // ambiguous? the mirror decides on the next attempt (same txId can't run twice)
      await finishLeg(deps, b.id, name, { status: 'failed', error: short(e) });
      results.push({ leg: name, status: 'failed', step: 'facilitator', error: short(e) });
      break;
    }
  }

  let rec = (await deps.store.get(b.id))!;
  const state = tipState(rec);
  if ((state === 'complete' || state === 'partial') && rec.legs.some((l) => l.status === 'settled')) {
    const line = ledgerLine(rec);
    // the ledger line is written once per state change (complete is final)
    const last = (await deps.store.ledger(rec.network, rec.artist.label)).find((l) => l.tip === rec.id);
    if (!last || last.state !== line.state) {
      await deps.store.appendLedger(rec.network, rec.artist.label, line);
      if (state === 'complete' && deps.hcs && cfg.hcsTopic && !(rec.hcs && 'txId' in rec.hcs)) {
        try {
          const h = await deps.hcs(cfg, JSON.stringify(line));
          rec = { ...rec, hcs: h, updatedAt: new Date(now()).toISOString() };
        } catch (e) {
          rec = { ...rec, hcs: { error: short(e) } };
        }
        await deps.store.put(rec);
      }
    }
  }
  return { state: tipState(rec), results, record: publicRecord(rec, cfg, feePayer), ...(tipState(rec) === 'partial' ? { recovery: 'the artist leg is paid; only the steward leg is retried — prepare again with the same id, sign the steward leg, settle' } : {}) };
}

async function finishLeg(deps: WalletDeps, id: string, name: LegName, patch: Partial<LegRecord>) {
  const rec = (await deps.store.get(id))!;
  rec.legs = rec.legs.map((l) => (l.leg === name ? { ...l, ...patch, leaseUntilMs: undefined, ...(patch.status === 'settled' ? { error: undefined } : {}) } : l));
  rec.updatedAt = new Date((deps.now ?? Date.now)()).toISOString();
  await deps.store.put(rec);
}

function short(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/[0-9a-f]{60,}/gi, '[redacted]').slice(0, 240);
}

/** In-memory TipStore (tests + the testnet script). Same semantics as the Durable Object. */
export function memoryStore(): TipStore & { dump(): Map<string, unknown> } {
  const m = new Map<string, unknown>();
  const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const admits = new Map<string, { day: string; count: number; spent: bigint }>();
  return {
    dump: () => m,
    async get(id) { return clone((m.get(`tip:${id}`) as TipRecord) ?? null); },
    async put(rec) { m.set(`tip:${rec.id}`, clone(rec)); },
    async claim(id, leg, now, leaseMs) { return claimIn(clone(m.get(`tip:${id}`) as TipRecord | undefined) ?? null, leg, now, leaseMs, (r) => { m.set(`tip:${id}`, clone(r)); }); },
    async appendLedger(network, label, line) { const k = `ledger:${network}:${label}`; m.set(k, [line, ...((m.get(k) as unknown[]) ?? [])].slice(0, 50)); },
    async ledger(network, label) { return clone((m.get(`ledger:${network}:${label}`) as Record<string, unknown>[]) ?? []); },
    async admit(network, currency, atomic, cap, budget) {
      const day = new Date().toISOString().slice(0, 10);
      const k = `${network}:${currency}`;
      const s = admits.get(k);
      const cur = s && s.day === day ? s : { day, count: 0, spent: 0n };
      if (cur.count >= cap) return { ok: false, reason: 'cap' };
      if (cur.spent + atomic > budget) return { ok: false, reason: 'budget' };
      admits.set(k, { day, count: cur.count + 1, spent: cur.spent + atomic });
      return { ok: true };
    },
  };
}

/** The atomic claim rule, shared by the memory store and the Durable Object. */
export function claimIn(rec: TipRecord | null, leg: LegName, now: number, leaseMs: number, save: (r: TipRecord) => void) {
  if (!rec) return { ok: false as const, reason: 'missing' as const };
  const l = rec.legs.find((x) => x.leg === leg);
  if (!l) return { ok: false as const, reason: 'missing' as const };
  if (l.status === 'settled') return { ok: false as const, reason: 'settled' as const };
  if (l.status === 'settling' && (l.leaseUntilMs ?? 0) > now) return { ok: false as const, reason: 'in-flight' as const };
  l.status = 'settling';
  l.leaseUntilMs = now + leaseMs;
  l.attempts += 1;
  save(rec);
  return { ok: true as const, rec };
}

export type { DirectTipRequest };

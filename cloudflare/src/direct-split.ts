/**
 * Direct split — plan steps 3–5: the FAN pays from their own Hedera wallet, as TWO x402 `exact`
 * payments per tip, straight to the two recipients. No custody, no forwarding:
 *
 *   leg 1 · artist   96.31%  fan -> the artist's own Hedera account (read from their ENS name)
 *   leg 2 · steward   3.69%  fan -> the steward account (repays the 0G compute OSO pre-funds)
 *
 * Everything here is pure (no network, no SDK) so the money rules are unit-tested:
 *   - integer atomic units only; the two legs sum to EXACTLY the tip; rounding favours the artist
 *     (same rule as payments/src/split.ts: floor the steward share, the artist gets the remainder)
 *   - one idempotency key per tip; a settled leg is never settled again; a failed leg is retried
 *     alone, and a leg is only re-signed once its old transaction can no longer land on Hedera
 *   - mainnet is behind MAINNET_ENABLED (absent / anything but "true" ⇒ refused) and needs every
 *     mainnet setting present; there is no server "demo fan" on mainnet at all
 *   - USDC needs the payee to be able to hold the token (associated, or a free auto-association
 *     slot); an alias-only payee (wallet address with no Hedera account yet) can't be paid by x402
 */

export type HederaNetwork = 'testnet' | 'mainnet';
export type Currency = 'HBAR' | 'USDC';
export type LegName = 'artist' | 'steward';

export const STEWARD_BPS = 369n; // 3.69%
export const TOTAL_BPS = 10_000n;

/** Hedera USDC (Circle) — verified against circle.com/multi-chain-usdc/hedera and @x402/hedera constants. */
export const USDC_TOKEN: Record<HederaNetwork, string> = { mainnet: '0.0.456858', testnet: '0.0.429274' };

export interface AssetInfo {
  currency: Currency;
  /** x402 asset id: "0.0.0" = HBAR, else the HTS token id */
  id: string;
  decimals: number;
}

export function assetFor(network: HederaNetwork, currency: Currency): AssetInfo {
  return currency === 'HBAR' ? { currency, id: '0.0.0', decimals: 8 } : { currency, id: USDC_TOKEN[network], decimals: 6 };
}

export class DirectTipError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** "1.5" -> atomic units for `decimals`. Exact decimal text only: no exponents, no negatives. */
export function toAtomic(text: unknown, decimals: number): bigint {
  const s = typeof text === 'number' ? (Number.isFinite(text) ? text.toFixed(decimals) : '') : String(text ?? '').trim();
  const re = new RegExp(`^(\\d{1,6})(?:\\.(\\d{1,${decimals}}))?$`);
  const m = re.exec(s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
  if (!m) throw new DirectTipError('BAD_AMOUNT', `amount must be a plain number with at most ${decimals} decimals`);
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt((m[2] ?? '').padEnd(decimals, '0') || '0');
}

export function fromAtomic(v: bigint, decimals: number): string {
  const s = v.toString().padStart(decimals + 1, '0');
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${s.slice(0, -decimals)}.${frac}` : s.slice(0, -decimals);
}

/** 96.31 / 3.69 in atomic units. steward = floor(3.69%), artist = the rest ⇒ artist + steward === total, always. */
export function splitDirect(total: bigint): { artist: bigint; steward: bigint } {
  if (total <= 0n) throw new DirectTipError('BAD_AMOUNT', 'amount must be positive');
  const steward = (total * STEWARD_BPS) / TOTAL_BPS;
  const artist = total - steward;
  if (steward <= 0n) throw new DirectTipError('BAD_AMOUNT', 'amount too small to split into two payments');
  return { artist, steward };
}

// ── network config + the mainnet switch ─────────────────────────────────────────────

export interface NetworkConfig {
  network: HederaNetwork;
  caip2: `hedera:${HederaNetwork}`;
  facilitatorUrl: string;
  mirror: string;
  stewardAccount: string;
  hcsTopic: string | null;
  /** per-asset ceilings, atomic units */
  maxTip: Record<Currency, bigint>;
  dailyCap: number;
  dailyBudget: Record<Currency, bigint>;
  currencies: Currency[];
}

export interface DirectEnv {
  STEWARD_ACCOUNT_ID?: string;
  HCS_TOPIC_ID?: string;
  FACILITATOR_URL?: string;
  MIRROR_URL?: string;
  WALLET_MAX_TIP_HBAR?: string;
  WALLET_MAX_TIP_USDC?: string;
  WALLET_DAILY_CAP?: string;
  WALLET_DAILY_HBAR?: string;
  WALLET_DAILY_USDC?: string;
  /** THE MAINNET SWITCH. Only the exact string "true" turns it on. Default: off. */
  MAINNET_ENABLED?: string;
  MAINNET_FACILITATOR_URL?: string;
  MAINNET_MIRROR_URL?: string;
  MAINNET_STEWARD_ACCOUNT_ID?: string;
  MAINNET_HCS_TOPIC_ID?: string;
  MAINNET_MAX_TIP_HBAR?: string;
  MAINNET_MAX_TIP_USDC?: string;
  MAINNET_DAILY_CAP?: string;
  MAINNET_DAILY_HBAR?: string;
  MAINNET_DAILY_USDC?: string;
  MAINNET_CURRENCIES?: string;
}

const ACCT_RE = /^0\.0\.[1-9]\d{0,18}$/;
const httpsUrl = (v: string | undefined): string | null => {
  const t = v?.trim() ?? '';
  try {
    const u = new URL(t);
    return u.protocol === 'https:' && !u.username && !u.password ? t.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
};
/** Positive decimal text -> atomic, clamped to [min, hardMax]. */
const capAtomic = (v: string | undefined, fallback: string, decimals: number, hardMax: string): bigint => {
  let n: bigint;
  try {
    n = toAtomic(v?.trim() || fallback, decimals);
  } catch {
    n = toAtomic(fallback, decimals);
  }
  const hard = toAtomic(hardMax, decimals);
  return n > hard ? hard : n <= 0n ? toAtomic(fallback, decimals) : n;
};
const capInt = (v: string | undefined, fallback: number, max: number): number => {
  const n = Number(v ?? fallback);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
};

export const mainnetEnabled = (env: DirectEnv): boolean => env.MAINNET_ENABLED === 'true';

/**
 * The config for one network, or a DirectTipError. Testnet uses the existing demo-loop settings.
 * Mainnet: refused unless MAINNET_ENABLED === "true" AND every mainnet setting is present; caps are
 * deliberately small and hard-clamped (≤ 25 HBAR / 5 USDC per tip, ≤ 20 tips a day).
 */
export function networkConfig(env: DirectEnv, network: unknown): NetworkConfig {
  if (network !== 'testnet' && network !== 'mainnet') throw new DirectTipError('BAD_NETWORK', 'network must be "testnet" or "mainnet"');
  if (network === 'testnet') {
    const steward = env.STEWARD_ACCOUNT_ID?.trim() ?? '';
    if (!ACCT_RE.test(steward)) throw new DirectTipError('NOT_CONFIGURED', 'testnet steward account is not configured', 503);
    const topic = env.HCS_TOPIC_ID?.trim() ?? '';
    return {
      network,
      caip2: 'hedera:testnet',
      facilitatorUrl: httpsUrl(env.FACILITATOR_URL) ?? 'https://x402.org/facilitator',
      mirror: httpsUrl(env.MIRROR_URL) ?? 'https://testnet.mirrornode.hedera.com',
      stewardAccount: steward,
      hcsTopic: ACCT_RE.test(topic) ? topic : null,
      maxTip: { HBAR: capAtomic(env.WALLET_MAX_TIP_HBAR, '10', 8, '10'), USDC: capAtomic(env.WALLET_MAX_TIP_USDC, '10', 6, '10') },
      dailyCap: capInt(env.WALLET_DAILY_CAP, 100, 500),
      dailyBudget: { HBAR: capAtomic(env.WALLET_DAILY_HBAR, '200', 8, '1000'), USDC: capAtomic(env.WALLET_DAILY_USDC, '200', 6, '1000') },
      currencies: ['HBAR', 'USDC'],
    };
  }
  if (!mainnetEnabled(env)) {
    throw new DirectTipError('MAINNET_DISABLED', 'mainnet tips are switched off on this service (MAINNET_ENABLED is not "true") — nothing was prepared or paid', 403);
  }
  const facilitatorUrl = httpsUrl(env.MAINNET_FACILITATOR_URL);
  const steward = env.MAINNET_STEWARD_ACCOUNT_ID?.trim() ?? '';
  const topic = env.MAINNET_HCS_TOPIC_ID?.trim() ?? '';
  const missing = [
    !facilitatorUrl && 'MAINNET_FACILITATOR_URL',
    !ACCT_RE.test(steward) && 'MAINNET_STEWARD_ACCOUNT_ID',
    !ACCT_RE.test(topic) && 'MAINNET_HCS_TOPIC_ID',
    !env.MAINNET_DAILY_CAP?.trim() && 'MAINNET_DAILY_CAP',
  ].filter(Boolean);
  if (missing.length) throw new DirectTipError('MAINNET_NOT_CONFIGURED', `mainnet is switched on but not configured (${missing.join(', ')}) — refusing`, 503);
  const currencies = (env.MAINNET_CURRENCIES ?? 'USDC,HBAR').split(',').map((c) => c.trim().toUpperCase()).filter((c): c is Currency => c === 'HBAR' || c === 'USDC');
  return {
    network,
    caip2: 'hedera:mainnet',
    facilitatorUrl: facilitatorUrl!,
    mirror: httpsUrl(env.MAINNET_MIRROR_URL) ?? 'https://mainnet-public.mirrornode.hedera.com',
    stewardAccount: steward,
    hcsTopic: topic,
    maxTip: { HBAR: capAtomic(env.MAINNET_MAX_TIP_HBAR, '10', 8, '25'), USDC: capAtomic(env.MAINNET_MAX_TIP_USDC, '1', 6, '5') },
    dailyCap: capInt(env.MAINNET_DAILY_CAP, 5, 20),
    dailyBudget: { HBAR: capAtomic(env.MAINNET_DAILY_HBAR, '50', 8, '100'), USDC: capAtomic(env.MAINNET_DAILY_USDC, '10', 6, '25') },
    currencies: currencies.length ? currencies : ['USDC'],
  };
}

/** Public, secret-free summary for /health. */
export function walletHealth(env: DirectEnv): Record<string, unknown> {
  const one = (n: HederaNetwork) => {
    try {
      const c = networkConfig(env, n);
      return {
        enabled: true,
        network: c.caip2,
        facilitator: c.facilitatorUrl,
        steward: c.stewardAccount,
        hcsTopic: c.hcsTopic,
        currencies: c.currencies.map((cur) => ({ currency: cur, asset: assetFor(n, cur).id, maxTip: fromAtomic(c.maxTip[cur], assetFor(n, cur).decimals) })),
        dailyCap: c.dailyCap,
      };
    } catch (e) {
      return { enabled: false, error: (e as DirectTipError).code ?? 'UNAVAILABLE', message: (e as Error).message };
    }
  };
  return { testnet: one('testnet'), mainnet: one('mainnet'), split: { artist: '96.31%', steward: '3.69%', oso: '0%', legs: 2, custody: 'none — the fan pays both recipients directly' } };
}

// ── the tip request ───────────────────────────────────────────────────────────────

export const TIP_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export interface DirectTipRequest {
  id: string;
  network: HederaNetwork;
  currency: Currency;
  artist: string;
  fan: string;
  amount: bigint;
}

/** Parse + validate POST /wallet/prepare. The request names the artist by LABEL only — never an account. */
export function parseDirectTip(text: string, env: DirectEnv): { req: DirectTipRequest; cfg: NetworkConfig; asset: AssetInfo } {
  if (text.length > 2048) throw new DirectTipError('BAD_REQUEST', 'body too large');
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(text);
  } catch {
    throw new DirectTipError('BAD_REQUEST', 'body must be JSON');
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new DirectTipError('BAD_REQUEST', 'body must be a JSON object');
  // the network is checked FIRST: a mainnet request with the switch off is refused before anything else
  const cfg = networkConfig(env, b.network ?? 'testnet');
  if (typeof b.id !== 'string' || !TIP_ID_RE.test(b.id)) throw new DirectTipError('BAD_ID', 'id must be an idempotency key of 16–64 [A-Za-z0-9_-] characters (one per tip)');
  const currency = b.currency ?? 'HBAR';
  if (currency !== 'HBAR' && currency !== 'USDC') throw new DirectTipError('BAD_CURRENCY', 'currency must be "HBAR" or "USDC"');
  if (!cfg.currencies.includes(currency)) throw new DirectTipError('BAD_CURRENCY', `${currency} is not enabled on ${cfg.network}`);
  if (typeof b.artist !== 'string' || !LABEL_RE.test(b.artist)) throw new DirectTipError('BAD_ARTIST', 'artist must be a garden slug like "shaka"');
  if (typeof b.fan !== 'string' || !ACCT_RE.test(b.fan)) throw new DirectTipError('BAD_FAN', 'fan must be the 0.0.N account your wallet connected');
  const asset = assetFor(cfg.network, currency);
  const amount = toAtomic(b.amount, asset.decimals);
  const min = asset.decimals === 8 ? 1_000_000n : 10_000n; // 0.01 HBAR / 0.01 USDC
  if (amount < min || amount > cfg.maxTip[currency]) {
    throw new DirectTipError('BAD_AMOUNT', `amount must be between ${fromAtomic(min, asset.decimals)} and ${fromAtomic(cfg.maxTip[currency], asset.decimals)} ${currency}`);
  }
  return { req: { id: b.id, network: cfg.network, currency, artist: b.artist, fan: b.fan, amount }, cfg, asset };
}

/** Everything that makes two prepare calls "the same tip". Same id + different fingerprint ⇒ 409. */
export const fingerprint = (r: DirectTipRequest, payTo: string, steward: string): string =>
  [r.network, r.currency, r.artist, r.fan, r.amount.toString(), payTo, steward].join('|');

// ── the per-tip ledger record + recovery rules ───────────────────────────────────

export type LegStatus = 'prepared' | 'settling' | 'settled' | 'failed';

export interface LegRecord {
  leg: LegName;
  payTo: string;
  amount: string; // atomic, string for JSON
  status: LegStatus;
  /** the Hedera transaction id fixed at prepare time (feePayer@validStart): Hedera never runs it twice */
  txId: string;
  /** unsigned frozen TransactionList bytes (base64) the fan's wallet signs */
  txBytes: string;
  bodyBytes: string;
  validUntilMs: number;
  attempts: number;
  leaseUntilMs?: number;
  settledTx?: string;
  error?: string;
  /** previous transaction ids of this leg that provably never landed (expired, not on the mirror) */
  abandoned?: string[];
}

export interface TipRecord {
  v: 1;
  id: string;
  fingerprint: string;
  network: HederaNetwork;
  currency: Currency;
  asset: string;
  decimals: number;
  artist: { label: string; ens: string; payTo: string; source: string };
  fan: string;
  total: string;
  legs: LegRecord[];
  createdAt: string;
  updatedAt: string;
  hcs?: { txId: string; sequence: string | null } | { error: string };
}

export type TipState = 'prepared' | 'partial' | 'complete' | 'failed';

export function tipState(r: TipRecord): TipState {
  const settled = r.legs.filter((l) => l.status === 'settled').length;
  if (settled === r.legs.length) return 'complete';
  if (settled > 0) return 'partial';
  return r.legs.some((l) => l.status === 'failed') ? 'failed' : 'prepared';
}

/** Conservation check on a stored record — a record that does not add up is never settled. */
export function assertConserved(r: Pick<TipRecord, 'total' | 'legs'>): void {
  const sum = r.legs.reduce((s, l) => s + BigInt(l.amount), 0n);
  if (sum !== BigInt(r.total) || r.legs.some((l) => BigInt(l.amount) <= 0n)) throw new DirectTipError('NOT_CONSERVED', `legs sum to ${sum}, tip is ${r.total}`, 500);
}

/** Grace after a transaction's validity window ends before we call it "can never land". */
export const EXPIRY_GRACE_MS = 30_000;
/** How long one settle attempt may hold a leg. */
export const LEASE_MS = 90_000;

export type MirrorResult = 'SUCCESS' | 'NOT_FOUND' | { failed: string };

/**
 * What to do with a leg that is not (known to be) settled, before touching the facilitator.
 *   settled            -> skip (never settle twice)
 *   in-flight          -> another settle holds the lease; don't race it
 *   reconcile          -> the mirror shows this txId SUCCESS: mark settled, no new payment
 *   resubmit           -> the signed tx can still land: (re)submit the SAME bytes (Hedera dedupes the txId)
 *   rebuild            -> the old tx provably can't land anymore (expired + not on mirror, or failed on chain):
 *                         a fresh transaction (new txId) for THIS leg only, signed again by the fan
 */
export type LegDecision = 'settled' | 'in-flight' | 'reconcile' | 'resubmit' | 'rebuild';

export function legDecision(leg: LegRecord, now: number, mirror: MirrorResult | null): LegDecision {
  if (leg.status === 'settled') return 'settled';
  if (leg.status === 'settling' && (leg.leaseUntilMs ?? 0) > now) return 'in-flight';
  if (mirror === 'SUCCESS') return 'reconcile';
  if (mirror && typeof mirror === 'object') return 'rebuild'; // reached consensus and failed: that txId is spent, no money moved
  if (now > leg.validUntilMs + EXPIRY_GRACE_MS) return mirror === 'NOT_FOUND' ? 'rebuild' : 'in-flight'; // unknown mirror state: wait, never guess
  return 'resubmit';
}

/** Per-artist ledger line (DO storage list + the HCS message body). */
export function ledgerLine(r: TipRecord): Record<string, unknown> {
  const leg = (n: LegName) => r.legs.find((l) => l.leg === n)!;
  return {
    v: 2,
    kind: 'oso-direct-split',
    tip: r.id,
    network: `hedera:${r.network}`,
    asset: r.asset,
    currency: r.currency,
    artist: r.artist.ens,
    artist_pay_to: r.artist.payTo,
    fan: r.fan,
    total: r.total,
    artist_amount: leg('artist').amount,
    steward_amount: leg('steward').amount,
    oso_amount: '0',
    custody: 'none',
    artist_tx: leg('artist').settledTx ?? null,
    steward_tx: leg('steward').settledTx ?? null,
    state: tipState(r),
    at: r.updatedAt,
  };
}

export const hashscan = (network: HederaNetwork, kind: 'transaction' | 'account' | 'topic', id: string): string => {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(id);
  const tx = kind === 'transaction' && m ? `${m[1]}-${m[2]}-${m[3]!.padStart(9, '0')}` : encodeURIComponent(id);
  return `https://hashscan.io/${network}/${kind}/${tx}`;
};

// ── can the payee receive this asset? (mirror node) ───────────────────────────────

export interface Receivable {
  ok: boolean;
  code: 'ok' | 'no-account' | 'not-associated' | 'auto-slots-full' | 'mirror-error';
  /** how a token would land: an existing association, unlimited auto-association, or a free slot */
  via?: 'hbar' | 'associated' | 'auto-unlimited' | 'auto-slot';
  /** a hollow account (made by sending to a wallet address) can receive but has no key yet */
  hollow?: boolean;
  message: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Mirror-node check, same rules as @x402/hedera's facilitator preflight:
 * `/api/v1/accounts/{id}/tokens?token.id=` non-empty ⇒ associated; else max_automatic_token_associations
 * -1 ⇒ unlimited; 0 ⇒ must associate first; N ⇒ a free slot must remain.
 */
export async function checkReceivable(mirror: string, account: string, asset: AssetInfo, fetchImpl: FetchLike = fetch): Promise<Receivable> {
  const get = async (path: string) => {
    const r = await fetchImpl(`${mirror}${path}`, { signal: AbortSignal.timeout(8000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`mirror ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  };
  try {
    if (!ACCT_RE.test(account)) {
      return { ok: false, code: 'no-account', message: `${account} is a wallet address with no Hedera account yet — x402 facilitators only pay a 0.0.N account; receive any HBAR once (or set a 0.0.N payout on /payout) first` };
    }
    const info = await get(`/api/v1/accounts/${account}`);
    if (!info) return { ok: false, code: 'no-account', message: `${account} does not exist on Hedera ${mirror.includes('mainnet') ? 'mainnet' : 'testnet'}` };
    const hollow = info.key == null;
    if (asset.currency === 'HBAR') return { ok: true, code: 'ok', via: 'hbar', hollow, message: hollow ? `${account} is a hollow account (made from a wallet address): it receives HBAR; activate it with your own key to spend` : `${account} can receive HBAR` };
    const tokens = (await get(`/api/v1/accounts/${account}/tokens?token.id=${asset.id}`)) as { tokens?: unknown[] } | null;
    if (tokens?.tokens?.length) return { ok: true, code: 'ok', via: 'associated', hollow, message: `${account} has associated USDC (${asset.id})` };
    const maxAuto = Number(info.max_automatic_token_associations ?? 0);
    if (maxAuto === -1) return { ok: true, code: 'ok', via: 'auto-unlimited', hollow, message: `${account} auto-associates tokens: the first USDC will associate on arrival` };
    if (maxAuto === 0) return { ok: false, code: 'not-associated', hollow, message: `${account} has not associated USDC (${asset.id}) — associate it in your wallet (HashPack: Tokens → + → ${asset.id}) and try again` };
    let used = 0;
    let next: string | null = `/api/v1/accounts/${account}/tokens?limit=100`;
    for (let page = 0; next && page < 10; page++) {
      const p = (await get(next)) as { tokens?: { automatic_association?: boolean }[]; links?: { next?: string | null } } | null;
      used += (p?.tokens ?? []).filter((t) => t.automatic_association).length;
      next = p?.links?.next ?? null;
    }
    return used < maxAuto
      ? { ok: true, code: 'ok', via: 'auto-slot', hollow, message: `${account} has a free auto-association slot: the first USDC will associate on arrival` }
      : { ok: false, code: 'auto-slots-full', hollow, message: `${account} has used all ${maxAuto} auto-association slots and has not associated USDC (${asset.id}) — associate it in your wallet first` };
  } catch (e) {
    return { ok: false, code: 'mirror-error', message: `could not check ${account} on the mirror node right now (${String((e as Error)?.message ?? e).slice(0, 80)}) — nothing was prepared` };
  }
}

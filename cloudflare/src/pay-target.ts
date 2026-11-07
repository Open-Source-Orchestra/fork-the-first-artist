/**
 * "💸 pay this artist" — who gets paid, and how much. Pure + injectable so it is fully tested.
 *
 * The browser may only send an artist LABEL (e.g. "shaka") and an amount. The payout is never
 * taken from the request: it is resolved live from the artist's OWN ENS name
 * `<label>.osoartist.eth` on Ethereum mainnet (their resolver, their records) via
 * ens/src/resolve-artist.mjs, which fails closed on no consent / paused steward / wrong network /
 * no payout record. An EVM payout (their wallet as a Hedera alias) is looked up on the Hedera
 * mirror node so the page can show the 0.0.N account it maps to.
 */
import { splitTip } from './tip-loop.ts';

export const ENS_PARENT = 'osoartist.eth';
export const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const MIN_TIP_TINYBAR = 1_000_000n; // 0.01 HBAR
export const HARD_MAX_TIP_TINYBAR = 1_000_000_000n; // 10 HBAR — never more per run, whatever the config says
export const DEFAULT_TIP_TINYBAR = 10_000_000n; // 0.1 HBAR

export class TipRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** "1.5" | 1.5 -> 150000000n tinybar. Up to 8 decimals, no exponents, no negatives. */
export function hbarToTinybar(v: unknown): bigint {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(8) : '') : String(v ?? '').trim();
  const m = /^(\d{1,4})(?:\.(\d{1,8}))?$/.exec(s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
  if (!m) throw new TipRequestError('BAD_AMOUNT', 'amount must be HBAR like 0.1, 1 or 2.5 (max 8 decimals)');
  return BigInt(m[1]!) * 100_000_000n + BigInt((m[2] ?? '').padEnd(8, '0') || '0');
}

/** The steward's 3.69% share pays the 0G meter, so the meter price follows the tip. */
export function meterFor(tip: bigint): bigint {
  return splitTip(tip).compute;
}

export interface TipRequest {
  question: string | null;
  artist: string | null;
  tipTinybar: bigint;
}

/** Parse + validate the POST /tip body. `maxTip` is the configured ceiling (≤ HARD_MAX_TIP_TINYBAR). */
export function parseTipRequest(text: string, maxTip: bigint = HARD_MAX_TIP_TINYBAR): TipRequest {
  if (text.length > 2048) throw new TipRequestError('BAD_REQUEST', 'body too large');
  let body: { question?: unknown; artist?: unknown; amountHbar?: unknown } = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new TipRequestError('BAD_REQUEST', 'body must be JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TipRequestError('BAD_REQUEST', 'body must be a JSON object');
  }
  const question = typeof body.question === 'string' && body.question.trim() ? body.question.trim().slice(0, 280) : null;
  let artist: string | null = null;
  if (body.artist != null && body.artist !== '') {
    if (typeof body.artist !== 'string' || !LABEL_RE.test(body.artist)) throw new TipRequestError('BAD_ARTIST', 'artist must be a garden slug like "shaka"');
    artist = body.artist;
  }
  const cap = maxTip < HARD_MAX_TIP_TINYBAR ? maxTip : HARD_MAX_TIP_TINYBAR;
  const tipTinybar = body.amountHbar == null || body.amountHbar === '' ? DEFAULT_TIP_TINYBAR : hbarToTinybar(body.amountHbar);
  if (tipTinybar < MIN_TIP_TINYBAR || tipTinybar > cap) {
    throw new TipRequestError('BAD_AMOUNT', `amount must be between ${Number(MIN_TIP_TINYBAR) / 1e8} and ${Number(cap) / 1e8} HBAR`);
  }
  return { question, artist, tipTinybar };
}

export interface ResolvedPayTo {
  name: string;
  path: string;
  payTo: string;
  hederaAccountId: string | null;
  hederaAlias: string | null;
  resolver: string | null;
  /** set only when the live ENS read failed (rate limit) and the last live read (≤6 h old) was used */
  lastLiveReadAt?: string;
}

export interface ArtistTarget {
  label: string;
  ens: string;
  /** what the steward's forward transfer is sent to: 0.0.N, or a 0x EVM alias (auto-creates a hollow account) */
  payTo: string;
  /** the 0.0.N account, when known (direct record, or the alias already exists on Hedera) */
  accountId: string | null;
  alias: string | null;
  path: string;
  resolver: string | null;
  source: string;
  lastLiveReadAt: string | null;
}

export interface TargetDeps {
  /** ENS name -> payout (ens/src/resolve-artist.mjs resolvePayTo, network testnet, consent required) */
  resolve: (ensName: string) => Promise<ResolvedPayTo>;
  /** EVM address -> existing Hedera account id on testnet, or null if none yet */
  aliasAccount: (evm: string) => Promise<string | null>;
}

/** Resolve one garden label to a payable target, or throw TipRequestError (fail closed). */
export async function resolveArtistTarget(label: string, deps: TargetDeps, reserved: string[] = []): Promise<ArtistTarget> {
  if (!LABEL_RE.test(label)) throw new TipRequestError('BAD_ARTIST', 'artist must be a garden slug like "shaka"');
  const ens = `${label}.${ENS_PARENT}`;
  let r: ResolvedPayTo;
  try {
    r = await deps.resolve(ens);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const why = code === 'no-consent' ? `${ens} has not consented yet (or is not issued)`
      : code === 'no-payout' ? `${ens} has no payout record`
      : code === 'steward-paused' ? `${ens} has paused payments through OSO`
      : code === 'network-mismatch' ? `${ens} is set up for a different Hedera network`
      : code === 'bad-name' ? `${ens} is not a valid name`
      : `${ens} could not be resolved right now (${String((e as Error)?.message ?? e).replace(/https?:\/\/\S+/g, '[rpc]').slice(0, 160)})`;
    throw new TipRequestError('ARTIST_NOT_PAYABLE', `${why} — nothing was paid`);
  }
  if (r.name !== ens) throw new TipRequestError('ARTIST_NOT_PAYABLE', 'resolved a different name — nothing was paid');
  let accountId: string | null = null;
  let alias: string | null = null;
  if (/^0\.0\.\d+$/.test(r.payTo)) accountId = r.payTo;
  else if (/^0x[0-9a-fA-F]{40}$/.test(r.payTo)) {
    alias = r.payTo;
    try {
      accountId = await deps.aliasAccount(r.payTo);
    } catch {
      accountId = null;
    }
  } else throw new TipRequestError('ARTIST_NOT_PAYABLE', `${ens} has a malformed payout record — nothing was paid`);
  const payTo = accountId ?? (alias as string);
  if (reserved.includes(payTo)) throw new TipRequestError('ARTIST_NOT_PAYABLE', `${ens} points at an OSO demo account — refusing`);
  return {
    label,
    ens,
    payTo,
    accountId,
    alias,
    path: r.path,
    resolver: r.resolver,
    lastLiveReadAt: r.lastLiveReadAt ?? null,
    source: (r.lastLiveReadAt ? `last live ENS read ${r.lastLiveReadAt.slice(11, 16)}Z (the public ENS node is busy right now): ` : '') + (r.path === 'hbar' ? 'their ENS record addr(3030) → Hedera account'
      : r.path === 'hedera-evm' ? 'their ENS record for Hedera testnet (ENSIP-11) → their own wallet as a Hedera alias'
      : 'their ENS ETH address → their own wallet as a Hedera alias'),
  };
}

/**
 * The two Hedera-SDK touch points of the fan-wallet flow, kept tiny and tested against the real SDK:
 *
 *  buildLegTx        the UNSIGNED x402 `exact` transfer for one leg — same shape as
 *                    @x402/hedera createClientHederaSigner (fan -amount, payTo +amount, transaction id
 *                    on the facilitator's feePayer) but frozen for ONE node so a wallet signs exactly one
 *                    TransactionBody (HIP-820 hedera_signTransaction).
 *  attachSignature   adds the SignatureMap the fan's wallet returned, after checking that the signature
 *                    really is over that body and comes from a key that controls the fan's account.
 *
 * No private key of the fan ever exists here. The facilitator adds its own fee-payer signature at /settle.
 */
// @ts-expect-error — plain ESM module shared with the browser (tested in frontend/test + here)
import { b64ToBytes, bytesToB64, checkTransferBody, decodeSignatureMap, decodeTransactionBody } from '../../frontend/public/hedera-body.mjs';
import type { HederaNetwork } from './direct-split.ts';

export interface LegTx {
  txId: string;
  txBytes: string;
  bodyBytes: string;
  validUntilMs: number;
  node: string;
}

/** Hedera consensus nodes we pin a leg to (one per tx). 0.0.3 exists on both networks. */
export const DEFAULT_NODE = '0.0.3';

export async function buildLegTx(opts: { fan: string; payTo: string; amount: bigint; asset: string; feePayer: string; node?: string; now?: number; validSeconds?: number }): Promise<LegTx> {
  const sdk = await import('@hiero-ledger/sdk');
  const tx = new sdk.TransferTransaction();
  const fan = sdk.AccountId.fromString(opts.fan);
  const payTo = sdk.AccountId.fromString(opts.payTo);
  if (opts.asset === '0.0.0') {
    tx.addHbarTransfer(fan, sdk.Hbar.fromTinybars((-opts.amount).toString()));
    tx.addHbarTransfer(payTo, sdk.Hbar.fromTinybars(opts.amount.toString()));
  } else {
    const token = sdk.TokenId.fromString(opts.asset);
    tx.addTokenTransfer(token, fan, sdk.Long.fromString((-opts.amount).toString()));
    tx.addTokenTransfer(token, payTo, sdk.Long.fromString(opts.amount.toString()));
  }
  const start = opts.now ?? Date.now();
  // a few seconds in the past so a node with a slightly slow clock never sees it "in the future"
  const validStart = sdk.Timestamp.fromDate(new Date(start - 5_000));
  tx.setTransactionId(sdk.TransactionId.withValidStart(sdk.AccountId.fromString(opts.feePayer), validStart));
  tx.setNodeAccountIds([sdk.AccountId.fromString(opts.node ?? DEFAULT_NODE)]);
  tx.setTransactionValidDuration(opts.validSeconds ?? 120);
  tx.freeze();
  const list = tx.signableNodeBodyBytesList;
  if (list.length !== 1) throw new Error('expected exactly one node body');
  const body = list[0]!.signableTransactionBodyBytes;
  const txId = tx.transactionId!.toString();
  return {
    txId,
    txBytes: bytesToB64(tx.toBytes()),
    bodyBytes: bytesToB64(body),
    validUntilMs: start - 5_000 + (opts.validSeconds ?? 120) * 1000,
    node: opts.node ?? DEFAULT_NODE,
  };
}

/** Check a prepared leg body against the plan (same function the browser runs before asking the wallet). */
export function checkLegBody(bodyBytes: string, plan: { fan: string; payTo: string; amount: bigint; asset: string; feePayer: string }): string[] {
  return checkTransferBody(bodyBytes, { ...plan, amount: plan.amount.toString() }) as string[];
}

export class SignatureError extends Error {
  readonly code = 'BAD_SIGNATURE';
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The fan account's on-chain key, from the mirror node (simple ED25519/ECDSA keys only). */
export async function fanPublicKey(mirror: string, fan: string, fetchImpl: FetchLike = fetch): Promise<{ type: string; key: string } | null> {
  const r = await fetchImpl(`${mirror}/api/v1/accounts/${fan}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const b = (await r.json()) as { key?: { _type?: string; key?: string } | null };
  return b.key?._type && b.key.key ? { type: b.key._type, key: b.key.key } : null;
}

/**
 * Returns the base64 signed transaction for the facilitator. Refuses unless one signature pair in the
 * wallet's SignatureMap (a) verifies over exactly `bodyBytes` and (b) is the fan account's own key.
 */
export async function attachSignature(leg: { txBytes: string; bodyBytes: string }, signatureMapB64: unknown, onChainKey: { type: string; key: string } | null): Promise<string> {
  if (typeof signatureMapB64 !== 'string' || signatureMapB64.length > 4096) throw new SignatureError('signatureMap must be base64 (from hedera_signTransaction)');
  const sdk = await import('@hiero-ledger/sdk');
  let pairs: { pubKey: Uint8Array; type: string; signature: Uint8Array }[];
  try {
    pairs = decodeSignatureMap(signatureMapB64);
  } catch {
    throw new SignatureError('signatureMap is not a valid SignatureMap');
  }
  if (!onChainKey) throw new SignatureError('the fan account has no simple key on the mirror node (hollow, threshold or unknown account) — pay from an activated single-key account');
  const expected = onChainKey.type === 'ED25519' ? sdk.PublicKey.fromStringED25519(onChainKey.key)
    : onChainKey.type === 'ECDSA_SECP256K1' ? sdk.PublicKey.fromStringECDSA(onChainKey.key) : null;
  if (!expected) throw new SignatureError(`fan key type ${onChainKey.type} is not supported for wallet tips`);
  const body = b64ToBytes(leg.bodyBytes) as Uint8Array;
  const tx = sdk.Transaction.fromBytes(b64ToBytes(leg.txBytes));
  // the frozen bytes we stored must still carry exactly the body the wallet was shown
  const stored = tx.signableNodeBodyBytesList;
  if (stored.length !== 1 || bytesToB64(stored[0]!.signableTransactionBodyBytes) !== leg.bodyBytes) throw new SignatureError('stored transaction does not match its body');
  for (const p of pairs) {
    if (p.type !== (onChainKey.type === 'ED25519' ? 'ed25519' : 'ecdsa')) continue;
    // HashPack sends the full public key as the prefix; an empty prefix is allowed (we know the key)
    if (p.pubKey.length && ![expected.toBytesRaw(), expected.toBytesDer()].some((k) => bytesToB64(k) === bytesToB64(p.pubKey))) continue;
    if (!expected.verify(body, p.signature)) continue;
    tx.addSignature(expected, p.signature);
    if (!expected.verifyTransaction(tx)) throw new SignatureError('signature did not attach');
    return bytesToB64(tx.toBytes());
  }
  throw new SignatureError('no signature in the SignatureMap is the fan account key over this exact transaction');
}

/** For tests + the testnet script: what a wallet's hedera_signTransaction returns, from a raw key. */
export async function walletSignatureMap(privateKey: { sign(b: Uint8Array): Uint8Array; publicKey: { toBytesRaw(): Uint8Array; _key?: unknown } }, bodyBytes: string, type: 'ed25519' | 'ecdsa'): Promise<string> {
  const sig = privateKey.sign(b64ToBytes(bodyBytes));
  const pub = privateKey.publicKey.toBytesRaw();
  const enc = (field: number, bytes: Uint8Array) => [field << 3 | 2, ...varint(bytes.length), ...bytes];
  const pair = [...enc(1, pub), ...enc(type === 'ed25519' ? 3 : 6, sig)];
  return bytesToB64(Uint8Array.from(enc(1, Uint8Array.from(pair))));
}
function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
  out.push(n);
  return out;
}

export const decodeBody = decodeTransactionBody as (b: string | Uint8Array) => { payer: string; transactionId: string; node: string; validSeconds: bigint; hbar: { account: string; amount: bigint }[]; tokens: Record<string, { account: string; amount: bigint }[]> };
export type { HederaNetwork };

// A tiny, dependency-free reader for the two Hedera protobuf messages a fan's wallet touches:
// the TransactionBody it is asked to sign (hedera_signTransaction, HIP-820) and the SignatureMap
// it returns. Used by the /pay page BEFORE asking the wallet (so the page refuses to request a
// signature over anything but the planned transfer) and by the Worker AFTER (same check, both
// sides). Strict: any field outside the allow-list below makes the body "not a plain transfer".
//
// Field numbers from hashgraph/hedera-protobufs: TransactionBody (1 transactionID, 2 nodeAccountID,
// 3 transactionFee, 4 transactionValidDuration, 5 generateRecord, 6 memo, 14 cryptoTransfer),
// CryptoTransferTransactionBody (1 transfers, 2 tokenTransfers), AccountAmount (1 accountID,
// 2 amount sint64, 3 is_approval), TokenTransferList (1 token, 2 transfers, 3 nftTransfers,
// 4 expected_decimals), SignaturePair (1 pubKeyPrefix, 3 ed25519, 6 ECDSASecp256k1).

export function b64ToBytes(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4) throw new Error('not base64');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Parse one protobuf message into [{ field, wire, value }] (value: BigInt for varints, Uint8Array for bytes). */
function fields(buf) {
  const out = [];
  let i = 0;
  const varint = () => {
    let v = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error('truncated varint');
      const b = buf[i++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
      shift += 7n;
      if (shift > 63n) throw new Error('varint too long');
    }
  };
  while (i < buf.length) {
    const key = Number(varint());
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 0) throw new Error('bad field 0');
    if (wire === 0) out.push({ field, wire, value: varint() });
    else if (wire === 2) {
      const len = Number(varint());
      if (i + len > buf.length) throw new Error('truncated bytes');
      out.push({ field, wire, value: buf.subarray(i, i + len) });
      i += len;
    } else if (wire === 1) { if (i + 8 > buf.length) throw new Error('truncated'); out.push({ field, wire, value: buf.subarray(i, i + 8) }); i += 8; }
    else if (wire === 5) { if (i + 4 > buf.length) throw new Error('truncated'); out.push({ field, wire, value: buf.subarray(i, i + 4) }); i += 4; }
    else throw new Error(`unsupported wire type ${wire}`);
  }
  return out;
}
const one = (fs, n) => fs.filter((f) => f.field === n).at(-1)?.value;
const asInt64 = (v) => (v == null ? 0n : BigInt.asIntN(64, v));
const zigzag = (v) => (v >> 1n) ^ -(v & 1n);

function accountId(bytes) {
  const fs = fields(bytes);
  const alias = one(fs, 4);
  if (alias) {
    const hex = [...alias].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${asInt64(one(fs, 1))}.${asInt64(one(fs, 2))}.${alias.length === 20 ? '0x' : 'alias:'}${hex}`;
  }
  return `${asInt64(one(fs, 1))}.${asInt64(one(fs, 2))}.${asInt64(one(fs, 3))}`;
}
function accountAmount(bytes) {
  const fs = fields(bytes);
  const id = one(fs, 1);
  return { account: id ? accountId(id) : '', amount: zigzag(one(fs, 2) ?? 0n), approval: one(fs, 3) === 1n };
}

const BODY_FIELDS = new Set([1, 2, 3, 4, 5, 6, 14]);

/**
 * Decode a TransactionBody. Returns { payer, validStartSeconds, validStartNanos, transactionId, node,
 * fee, validSeconds, memo, hbar: [{account, amount}], tokens: { [tokenId]: [{account, amount}] },
 * nft: boolean, other: number[] (unexpected field numbers) }.
 */
export function decodeTransactionBody(input) {
  const buf = typeof input === 'string' ? b64ToBytes(input) : input;
  const fs = fields(buf);
  const other = [...new Set(fs.map((f) => f.field).filter((n) => !BODY_FIELDS.has(n)))];
  const txid = one(fs, 1);
  let payer = '';
  let secs = 0n;
  let nanos = 0n;
  let scheduled = false;
  if (txid) {
    const t = fields(txid);
    const ts = one(t, 1);
    if (ts) { const tf = fields(ts); secs = asInt64(one(tf, 1)); nanos = asInt64(one(tf, 2)); }
    const acc = one(t, 2);
    if (acc) payer = accountId(acc);
    scheduled = one(t, 3) === 1n;
  }
  const node = one(fs, 2) ? accountId(one(fs, 2)) : '';
  const dur = one(fs, 4);
  const validSeconds = dur ? asInt64(one(fields(dur), 1)) : 0n;
  const memoBytes = one(fs, 6);
  const memo = memoBytes ? new TextDecoder().decode(memoBytes) : '';
  const hbar = [];
  const tokens = {};
  let nft = false;
  const ct = one(fs, 14);
  if (ct) {
    for (const f of fields(ct)) {
      if (f.field === 1) for (const a of fields(f.value)) { if (a.field === 1) hbar.push(accountAmount(a.value)); }
      else if (f.field === 2) {
        const tl = fields(f.value);
        const tok = one(tl, 1);
        const id = tok ? (() => { const t = fields(tok); return `${asInt64(one(t, 1))}.${asInt64(one(t, 2))}.${asInt64(one(t, 3))}`; })() : '';
        tokens[id] ??= [];
        for (const a of tl) {
          if (a.field === 2) tokens[id].push(accountAmount(a.value));
          if (a.field === 3) nft = true;
        }
      } else other.push(1400 + f.field);
    }
  }
  return {
    payer,
    validStartSeconds: secs,
    validStartNanos: nanos,
    transactionId: payer ? `${payer}@${secs}.${nanos.toString().padStart(9, '0')}` : '',
    scheduled,
    node,
    fee: one(fs, 3) ?? 0n,
    validSeconds,
    memo,
    isTransfer: Boolean(ct),
    hbar,
    tokens,
    nft,
    other,
  };
}

/**
 * Is this body EXACTLY "fan pays `amount` of `asset` to `payTo`, fees by `feePayer`"? Returns [] when it
 * is, else the list of problems (never asks a wallet to sign when non-empty).
 */
export function checkTransferBody(body, { fan, payTo, amount, asset, feePayer, maxValidSeconds = 180 }) {
  const b = typeof body === 'string' || body instanceof Uint8Array ? decodeTransactionBody(body) : body;
  const want = BigInt(amount);
  const problems = [];
  if (!b.isTransfer) problems.push('not a crypto transfer');
  if (b.other.length) problems.push(`unexpected fields ${b.other.join(',')}`);
  if (b.scheduled) problems.push('scheduled transaction');
  if (b.payer !== feePayer) problems.push(`fee payer is ${b.payer}, expected the facilitator ${feePayer}`);
  if (b.payer === fan) problems.push('the fan would pay the network fee (unexpected)');
  if (b.memo) problems.push('memo present');
  if (b.nft) problems.push('NFT transfer present');
  if (b.validSeconds <= 0n || b.validSeconds > BigInt(maxValidSeconds)) problems.push(`validity ${b.validSeconds}s`);
  const exactPair = (list) => list.length === 2
    && list.some((a) => a.account === fan && a.amount === -want && !a.approval)
    && list.some((a) => a.account === payTo && a.amount === want && !a.approval);
  const tokenIds = Object.keys(b.tokens);
  if (asset === '0.0.0') {
    if (tokenIds.length) problems.push('token transfers in an HBAR payment');
    if (!exactPair(b.hbar)) problems.push(`HBAR transfers are not exactly ${fan} -${want} → ${payTo} +${want}`);
  } else {
    if (b.hbar.length) problems.push('HBAR transfers in a token payment');
    if (tokenIds.length !== 1 || tokenIds[0] !== asset) problems.push(`token is ${tokenIds.join(',') || 'none'}, expected ${asset}`);
    else if (!exactPair(b.tokens[asset])) problems.push(`token transfers are not exactly ${fan} -${want} → ${payTo} +${want}`);
  }
  if (want <= 0n) problems.push('amount must be positive');
  return problems;
}

/** Decode a SignatureMap -> [{ pubKey: Uint8Array, type: 'ed25519'|'ecdsa', signature: Uint8Array }]. */
export function decodeSignatureMap(input) {
  const buf = typeof input === 'string' ? b64ToBytes(input) : input;
  const pairs = [];
  for (const f of fields(buf)) {
    if (f.field !== 1) continue;
    const p = fields(f.value);
    const pubKey = one(p, 1) ?? new Uint8Array();
    const ed = one(p, 3);
    const ec = one(p, 6);
    if (ed) pairs.push({ pubKey, type: 'ed25519', signature: ed });
    else if (ec) pairs.push({ pubKey, type: 'ecdsa', signature: ec });
  }
  return pairs;
}

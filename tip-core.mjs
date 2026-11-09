// 💸 Tip the artist on any Ethereum chain — the pure, tested core (no DOM, no network).
//
// The fan's OWN wallet sends plain transfers: 96.31% straight to the artist's address (read live
// from their ENS name), 3.69% to the steward (read live from osoartist.eth and pinned). No contract
// is deployed, nothing passes through Open Source Orchestra, no server is involved, and amounts are
// integer base units of the token on THAT chain (USDC is 6 decimals; Binance-Peg USDC on BNB is 18).
//
// Unit tests: frontend/test/tip-core.test.mjs. Browser flow: frontend/public/tip.mjs.

export const STEWARD_BPS = 369n; // 3.69%
export const BPS = 10000n;
export const TRANSFER_SELECTOR = '0xa9059cbb'; // transfer(address,uint256)
export const BALANCE_OF_SELECTOR = '0x70a08231'; // balanceOf(address)
export const DECIMALS_SELECTOR = '0x313ce567';
export const SYMBOL_SELECTOR = '0x95d89b41';
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ZERO = '0x0000000000000000000000000000000000000000';
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
export const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** EIP-7702 delegation designator: an EOA that delegated its code is still an EOA held by its key. */
export const DELEGATION_RE = /^0xef0100[0-9a-fA-F]{40}$/;

/** "12.5" → 12500000n at 6 decimals. Digits only, no exponent, no sign, ≤ `decimals` fraction digits. */
export function toAtomic(text, decimals, maxWholeDigits = 9) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  let s = String(text ?? '').trim();
  if (/^\d*,\d*$/.test(s)) s = s.replace(',', '.'); // one decimal comma (es/fr/de/pt keyboards) = a decimal point
  const re = decimals > 0 ? new RegExp(`^(\\d{1,${maxWholeDigits}})(?:\\.(\\d{0,${decimals}}))?$`) : new RegExp(`^(\\d{1,${maxWholeDigits}})$`);
  const m = re.exec(s) ?? (decimals > 0 ? new RegExp(`^()\\.(\\d{1,${decimals}})$`).exec(s) : null);
  if (!m) return null;
  return BigInt(m[1] || '0') * 10n ** BigInt(decimals) + BigInt((m[2] ?? '').padEnd(decimals, '0') || '0');
}

export function fromAtomic(value, decimals) {
  const v = BigInt(value);
  if (v < 0n) throw new RangeError('negative amount');
  if (decimals === 0) return v.toString();
  const s = v.toString().padStart(decimals + 1, '0');
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${s.slice(0, -decimals)}.${frac}` : s.slice(0, -decimals);
}

/** steward = floor(3.69%), artist = everything else → the two legs always add up to exactly the tip. */
export function splitTip(total) {
  const t = BigInt(total);
  if (t <= 0n) throw new RangeError('tip must be positive');
  const steward = (t * STEWARD_BPS) / BPS;
  return { total: t, artist: t - steward, steward };
}

/** Validate a typed amount against [min, max] (both decimal strings in whole tokens). */
export function parseAmount(text, decimals, { min, max, symbol }) {
  const total = toAtomic(text, decimals);
  const lo = toAtomic(min, decimals);
  const hi = toAtomic(max, decimals);
  if (lo == null || hi == null) return { ok: false, message: 'This token is not configured correctly — nothing can be sent.' };
  if (total == null) return { ok: false, message: `Type an amount like ${min} (up to ${decimals} decimals).` };
  if (total < lo || total > hi) return { ok: false, message: `Pick an amount from ${min} to ${max} ${symbol}.` };
  const split = splitTip(total);
  if (split.steward === 0n) return { ok: false, message: `That is too small to split — pick at least ${min} ${symbol}.` };
  return { ok: true, ...split };
}

function word(hexNo0x) {
  return hexNo0x.toLowerCase().padStart(64, '0');
}

/** ABI-encode transfer(to, amount). Hand-rolled on purpose (cross-checked against viem in the tests). */
export function encodeTransfer(to, amount) {
  if (!ADDRESS_RE.test(to)) throw new TypeError('bad recipient');
  const a = BigInt(amount);
  if (a <= 0n || a >= 2n ** 256n) throw new RangeError('bad amount');
  return TRANSFER_SELECTOR + word(to.slice(2)) + word(a.toString(16));
}

export function encodeBalanceOf(owner) {
  if (!ADDRESS_RE.test(owner)) throw new TypeError('bad owner');
  return BALANCE_OF_SELECTOR + word(owner.slice(2));
}

/** Decode an ABI string (or a bytes32 legacy symbol) returned by eth_call. */
export function decodeString(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 66) return null;
  const b = hex.slice(2);
  if (b.length === 64) {
    const bytes = b.match(/../g).map((x) => parseInt(x, 16)).filter((x) => x !== 0);
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
  const off = Number(BigInt('0x' + b.slice(0, 64))) * 2;
  if (off + 64 > b.length) return null;
  const len = Number(BigInt('0x' + b.slice(off, off + 64))) * 2;
  if (len > 256 || off + 64 + len > b.length) return null;
  const bytes = (b.slice(off + 64, off + 64 + len).match(/../g) ?? []).map((x) => parseInt(x, 16));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function hexToBigInt(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hex)) throw new TypeError('not a hex quantity');
  return BigInt(hex);
}

export const chainHex = (id) => '0x' + Number(id).toString(16);
export const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export const shortAddress = (a) => (ADDRESS_RE.test(a ?? '') ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

/** ENSIP-11 coin type for an EVM chain (Ethereum mainnet keeps SLIP-44 coin type 60). */
export function coinTypeFor(chainId) {
  const id = BigInt(chainId);
  if (id === 1n) return 60n;
  if (id <= 0n || id >= 0x80000000n) throw new RangeError('bad chain id');
  return 0x80000000n | id;
}
/** ENSIP-19 default EVM coin type: "this address, on every EVM chain". */
export const DEFAULT_EVM_COIN = 0x80000000n;

export const isContractCode = (code) => typeof code === 'string' && /^0x[0-9a-fA-F]*$/.test(code) && code.length > 2 && !DELEGATION_RE.test(code);

/**
 * Choose where an ENS name gets paid on one chain. First match wins:
 *   1. the chain's own ENSIP-11 record (the owner said "on THIS chain, pay here");
 *   2. the ENSIP-19 default EVM record (the owner said "on every EVM chain, pay here");
 *   3. the plain ETH record (coin type 60) — ONLY if it is a key-held account (no contract code on Ethereum
 *      mainnet and none on the target chain; an EIP-7702 delegated EOA counts as key-held). A smart-contract
 *      wallet may not exist at the same address on another chain, so money could be lost: refuse instead.
 * Inputs: { chainId, specific, defaultEvm, eth, ethCodeOnMainnet, codeOnTarget } (addresses or null, code hex).
 */
export function pickPayout({ chainId, specific, defaultEvm, eth, ethCodeOnMainnet, codeOnTarget, defaultCodeOnMainnet, defaultCodeOnTarget }) {
  const ok = (a) => typeof a === 'string' && ADDRESS_RE.test(a) && !sameAddress(a, ZERO);
  if (Number(chainId) === 1) {
    if (ok(eth)) return { ok: true, address: eth, source: 'ETH address record (coin type 60)' };
    if (ok(defaultEvm)) return { ok: true, address: defaultEvm, source: 'default EVM address record (ENSIP-19)' };
    return { ok: false, code: 'no-address', message: 'no Ethereum address on this ENS name yet' };
  }
  if (ok(specific)) return { ok: true, address: specific, source: `address record for chain ${chainId} (ENSIP-11)` };
  if (ok(defaultEvm)) {
    // a smart-contract wallet on Ethereum that does not exist (yet) on this chain could lose the money
    if (defaultCodeOnMainnet === undefined && defaultCodeOnTarget === undefined) return { ok: true, address: defaultEvm, source: 'default EVM address record (ENSIP-19)' };
    if (defaultCodeOnMainnet == null || defaultCodeOnTarget == null) return { ok: false, code: 'unchecked', message: 'could not check the default EVM address on this chain — not paying' };
    if (isContractCode(defaultCodeOnMainnet) && !isContractCode(defaultCodeOnTarget)) return { ok: false, code: 'contract-wallet', message: 'the default EVM address is a smart-contract wallet that does not exist on this chain yet' };
    return { ok: true, address: defaultEvm, source: 'default EVM address record (ENSIP-19)' };
  }
  if (ok(eth)) {
    if (ethCodeOnMainnet == null || codeOnTarget == null) return { ok: false, code: 'unchecked', message: 'could not check that the ETH address is a key-held wallet — not paying' };
    if (isContractCode(ethCodeOnMainnet) || isContractCode(codeOnTarget)) {
      return { ok: false, code: 'contract-wallet', message: 'the ETH address is a smart-contract wallet; it needs its own record for this chain before it can be paid here' };
    }
    return { ok: true, address: eth, source: 'ETH address record (coin type 60) — a key-held wallet, same key on every EVM chain' };
  }
  return { ok: false, code: 'no-address', message: 'no EVM address on this ENS name yet' };
}

/**
 * Build the exact transfers for one tip. Legs that pay the same address are merged into one transfer
 * (same result, one wallet prompt less). Refuses anything odd BEFORE a wallet is asked.
 * asset: { kind: 'erc20', address, decimals, symbol } | { kind: 'native', decimals, symbol }
 */
export function planTip({ chainId, asset, fan, artist, steward, total }) {
  const problems = [];
  if (!Number.isInteger(chainId) || chainId <= 0) problems.push('no chain');
  if (!asset || !['erc20', 'native'].includes(asset.kind)) problems.push('no token');
  if (asset?.kind === 'erc20' && !ADDRESS_RE.test(asset.address ?? '')) problems.push('bad token address');
  for (const [k, a] of [['fan', fan], ['artist', artist?.address], ['steward', steward?.address]]) {
    if (!ADDRESS_RE.test(a ?? '') || sameAddress(a, ZERO)) problems.push(`no ${k} address`);
  }
  if (problems.length) return { ok: false, problems };
  if (sameAddress(fan, artist.address)) problems.push('this wallet IS the artist’s payout wallet — a fan wallet cannot tip itself');
  if (sameAddress(fan, steward.address)) problems.push('this wallet is the steward wallet — use a different fan wallet');
  if (asset.kind === 'erc20' && (sameAddress(artist.address, asset.address) || sameAddress(steward.address, asset.address))) problems.push('a payee is the token contract itself');
  if (problems.length) return { ok: false, problems };
  const split = splitTip(total);
  let legs = [
    { leg: 'artist', to: artist.address, amount: split.artist, label: artist.label },
    { leg: 'steward', to: steward.address, amount: split.steward, label: steward.label },
  ];
  if (sameAddress(artist.address, steward.address)) legs = [{ leg: 'artist+steward', to: artist.address, amount: split.total, label: artist.label }];
  return {
    ok: true,
    chainId,
    asset,
    fan,
    total: split.total,
    split,
    legs: legs.map((l) => ({ ...l, tx: txFor(asset, fan, l.to, l.amount, chainId) })),
  };
}

/** The exact transaction for one leg. `chainId` is always set, so a wallet that moved to another chain refuses it. */
export function txFor(asset, from, to, amount, chainId) {
  if (!Number.isInteger(chainId) || chainId <= 0) throw new TypeError('txFor needs a chain id');
  if (asset.kind === 'native') return { from, to, value: '0x' + BigInt(amount).toString(16), chainId: chainHex(chainId) };
  return { from, to: asset.address, value: '0x0', data: encodeTransfer(to, amount), chainId: chainHex(chainId) };
}

const topicAddr = (t) => (typeof t === 'string' && t.length === 66 ? '0x' + t.slice(26) : null);

/**
 * Did this mined transaction do EXACTLY what the leg promised?
 *  erc20: status 1 and a Transfer(from=fan, to=payee, value=amount) log emitted by the token contract;
 *  native: status 1 and the transaction itself sends `amount` from the fan to the payee.
 */
export function checkLegReceipt({ asset, fan, leg, receipt, tx }) {
  if (!receipt) return { done: false, reason: 'pending' };
  if (receipt.status !== '0x1' && receipt.status !== 1 && receipt.status !== 'success') return { done: true, ok: false, code: 'reverted', reason: 'the transaction failed (reverted) — nothing moved in this transfer' };
  if (asset.kind === 'erc20') {
    const hit = (receipt.logs ?? []).find((l) => sameAddress(l.address, asset.address) && (l.topics ?? [])[0]?.toLowerCase() === TRANSFER_TOPIC
      && sameAddress(topicAddr(l.topics[1]), fan) && sameAddress(topicAddr(l.topics[2]), leg.to) && (() => { try { return BigInt(l.data) === BigInt(leg.amount); } catch { return false; } })());
    return hit ? { done: true, ok: true } : { done: true, ok: false, code: 'mismatch', reason: 'mined, but no matching token Transfer was found — check the explorer' };
  }
  if (!tx) return { done: false, reason: 'reading the transaction' };
  const okNative = sameAddress(tx.from, fan) && sameAddress(tx.to, leg.to) && BigInt(tx.value) === BigInt(leg.amount);
  return okNative ? { done: true, ok: true } : { done: true, ok: false, code: 'mismatch', reason: 'mined, but it is not the planned transfer — check the explorer' };
}

/**
 * Tip ledger (kept in this browser only): what may happen to the next unfinished leg?
 *  planned            → 'send'
 *  sent (has a hash)  → 'wait'   (keep polling; never send again)
 *  failed (reverted, receipt proves nothing moved) → 'send'
 *  rejected (wallet said 4001) / unknown (any other wallet error) / replaced (nonce moved, no receipt)
 *                     → 'check'  (only re-send if the wallet's nonce has NOT moved since that attempt)
 *  mismatch / anything else → 'stop' (a human looks at the explorer)
 */
export function nextLeg(record) {
  for (const l of record?.legs ?? []) {
    if (l.state === 'confirmed') continue;
    if (l.state === 'sent') return { leg: l, action: 'wait' };
    if (l.state === 'planned' || l.state === 'failed') return { leg: l, action: 'send' };
    if (l.state === 'rejected' || l.state === 'unknown' || l.state === 'replaced') return { leg: l, action: 'check' };
    return { leg: l, action: 'stop' };
  }
  return { leg: null, action: 'done' };
}

/** A fresh plan may only continue a stored tip if every leg pays the same address the same amount, in order. */
export function legsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((l, i) => sameAddress(l.to, b[i].to) && BigInt(l.amount) === BigInt(b[i].amount));
}

const RECORD_STATES = new Set(['planned', 'sent', 'confirmed', 'failed', 'rejected', 'unknown', 'replaced', 'mismatch']);
/** Schema check for a ledger record read back from localStorage (anything odd → ignored, never sent). */
export function validRecord(r) {
  try {
    if (!r || typeof r !== 'object' || !/^tip_[0-9a-f]{20}$/.test(r.id)) return false;
    if (!Number.isInteger(r.chainId) || !['single', 'orchestra'].includes(r.kind ?? 'single')) return false;
    if (!ADDRESS_RE.test(r.fan) || !['erc20', 'native'].includes(r.asset?.kind)) return false;
    if (BigInt(r.total) <= 0n || !Array.isArray(r.legs) || !r.legs.length || r.legs.length > 64) return false;
    let sum = 0n;
    for (const l of r.legs) {
      if (!ADDRESS_RE.test(l.to) || !RECORD_STATES.has(l.state) || BigInt(l.amount) <= 0n) return false;
      if (l.hash != null && !HASH_RE.test(l.hash)) return false;
      sum += BigInt(l.amount);
    }
    return sum === BigInt(r.total);
  } catch {
    return false;
  }
}

export function newTipId(rand = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return `tip_${[...rand(10)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** EIP-3085 params for wallet_addEthereumChain, straight from the checked chain table. */
export function addChainParams(c) {
  return {
    chainId: chainHex(c.chainId),
    chainName: c.name,
    nativeCurrency: { name: c.nativeCurrency.name, symbol: c.nativeCurrency.symbol, decimals: c.nativeCurrency.decimals },
    rpcUrls: c.rpcUrls.slice(0, 1),
    blockExplorerUrls: [c.explorer],
  };
}

export function explorerTx(c, hash) {
  return HASH_RE.test(hash ?? '') ? `${c.explorer.replace(/\/$/, '')}/tx/${hash}` : null;
}
export function explorerAddress(c, a) {
  return ADDRESS_RE.test(a ?? '') ? `${c.explorer.replace(/\/$/, '')}/address/${a}` : null;
}

/** USD value of a token amount: USDC is 1:1 by design; ETH uses a Chainlink ETH/USD answer (8 decimals). */
export function usdOf(amount, decimals, kind, ethUsd8) {
  const a = BigInt(amount);
  let cents;
  if (kind === 'usdc') cents = (a * 100n) / 10n ** BigInt(decimals);
  else if (ethUsd8 == null) return null;
  else cents = (a * BigInt(ethUsd8)) / 10n ** BigInt(decimals + 6); // 8-dec price → cents
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** A Chainlink answer is usable only if positive and fresh (ETH/USD heartbeat 3600 s + margin). */
export function freshPrice({ answer, updatedAt }, nowSec, maxAge = 3 * 3600) {
  try {
    const a = BigInt(answer);
    const u = Number(updatedAt);
    return a > 0n && u > 0 && nowSec - u <= maxAge ? a : null;
  } catch {
    return null;
  }
}

/** Wallet errors → words a fan can act on. */
export function walletErrorText(e) {
  const code = e?.code ?? e?.data?.originalError?.code;
  if (code === 4001) return 'You declined in your wallet — nothing was sent.';
  if (code === -32002) return 'Your wallet already has a request open. Open the wallet, finish or close it, then try again.';
  if (code === 4902) return 'Your wallet does not know this chain yet.';
  if (code === 4100) return 'Your wallet has not allowed this site yet — connect again.';
  const msg = String(e?.message ?? e ?? '').slice(0, 160);
  if (/insufficient funds/i.test(msg)) return 'Not enough of the chain’s gas token in this wallet to pay the network fee.';
  if (/exceeds balance|transfer amount exceeds/i.test(msg)) return 'Not enough tokens in this wallet for this tip.';
  return typeof code === 'number' ? `The wallet said: ${msg || 'unknown error'}` : (msg || 'unknown error');
}

/* ── 🎻 tip the whole orchestra ─────────────────────────────────────────────── */

/**
 * One amount for everyone who switched tips on: the steward takes floor(3.69%), the other 96.31% is split
 * EQUALLY across the DISTINCT artist wallets (two cards paid to the same address count once), and the
 * integer dust that can't be split equally goes to the steward. A recipient whose wallet IS the steward
 * wallet is merged with the steward into one transfer. Every leg is an exact integer of base units and
 * the legs always add up to exactly `total`.
 * recipients: [{ slug, label, address }]
 */
export function planOrchestra({ chainId, asset, fan, recipients, steward, total }) {
  const problems = [];
  if (!Number.isInteger(chainId) || chainId <= 0) problems.push('no chain');
  if (!asset || !['erc20', 'native'].includes(asset.kind)) problems.push('no token');
  if (asset?.kind === 'erc20' && !ADDRESS_RE.test(asset.address ?? '')) problems.push('bad token address');
  if (!ADDRESS_RE.test(fan ?? '') || sameAddress(fan, ZERO)) problems.push('no fan address');
  if (!ADDRESS_RE.test(steward?.address ?? '') || sameAddress(steward?.address, ZERO)) problems.push('no steward address');
  const list = Array.isArray(recipients) ? recipients : [];
  if (!list.length) problems.push('nobody has switched tips on yet');
  for (const r of list) if (!ADDRESS_RE.test(r?.address ?? '') || sameAddress(r.address, ZERO)) problems.push(`no address for ${r?.label ?? '?'}`);
  if (problems.length) return { ok: false, problems };
  // distinct wallets, first-seen order, labels merged
  const wallets = [];
  for (const r of list) {
    const w = wallets.find((x) => sameAddress(x.address, r.address));
    if (w) { w.labels.push(r.label); w.slugs.push(r.slug); } else wallets.push({ address: r.address, labels: [r.label], slugs: [r.slug] });
  }
  for (const w of wallets) {
    if (sameAddress(w.address, fan)) problems.push(`this wallet is ${w.labels.join(' + ')}’s payout wallet — use a different fan wallet`);
    if (asset.kind === 'erc20' && sameAddress(w.address, asset.address)) problems.push('a payee is the token contract itself');
  }
  if (sameAddress(steward.address, fan)) problems.push('this wallet is the steward wallet — use a different fan wallet');
  if (problems.length) return { ok: false, problems };
  const t = BigInt(total);
  if (t <= 0n) return { ok: false, problems: ['tip must be positive'] };
  const stewardBase = (t * STEWARD_BPS) / BPS;
  const pool = t - stewardBase;
  const n = BigInt(wallets.length);
  const each = pool / n;
  const dust = pool - each * n;
  if (each === 0n || stewardBase === 0n) return { ok: false, problems: [`too small to split across ${wallets.length} wallets — pick a bigger amount`] };
  let stewardAmount = stewardBase + dust;
  const legs = [];
  for (const w of wallets) {
    if (sameAddress(w.address, steward.address)) { stewardAmount += each; w.mergedWithSteward = true; continue; }
    legs.push({ leg: 'artist', to: w.address, amount: each, label: w.labels.join(' + '), slugs: w.slugs });
  }
  const merged = wallets.filter((w) => w.mergedWithSteward);
  legs.push({ leg: merged.length ? 'artist+steward' : 'steward', to: steward.address, amount: stewardAmount, label: merged.length ? `${merged.flatMap((w) => w.labels).join(' + ')} + steward` : steward.label, slugs: merged.flatMap((w) => w.slugs) });
  const sum = legs.reduce((s, l) => s + l.amount, 0n);
  if (sum !== t) return { ok: false, problems: ['internal: legs do not add up — refusing'] };
  return {
    ok: true, chainId, asset, fan, total: t, kind: 'orchestra',
    split: { pool, each, dust, steward: stewardAmount, wallets: wallets.length },
    legs: legs.map((l) => ({ ...l, tx: txFor(asset, fan, l.to, l.amount, chainId) })),
  };
}

/** EIP-5792 calls for wallet_sendCalls (ERC-20 only — native batches are sent one by one so each is verifiable). */
export function batchCalls(plan) {
  return plan.legs.map((l) => ({ to: l.tx.to, value: l.tx.value ?? '0x0', data: l.tx.data ?? '0x' }));
}

/** Read wallet_getCapabilities for one chain: can it run an ATOMIC batch? (EIP-5792 v2 `atomic`, v1 `atomicBatch`) */
export function atomicSupport(caps, chainId) {
  if (!caps || typeof caps !== 'object') return false;
  const c = caps[chainHex(chainId)] ?? caps[String(chainId)] ?? caps[chainId];
  if (!c || typeof c !== 'object') return false;
  const st = c.atomic?.status;
  if (st === 'supported' || st === 'ready') return true;
  return c.atomicBatch?.supported === true;
}

/** wallet_getCallsStatus → 'pending' | 'confirmed' | 'failed' (nothing moved) | 'unknown' */
export function callsStatus(res) {
  const s = res?.status;
  if (s === 100 || s === 'PENDING' || s === 'pending') return 'pending';
  if (s === 200 || s === 'CONFIRMED' || s === 'confirmed' || s === 'success') return 'confirmed';
  if (s === 400 || s === 500) return 'failed'; // 400 = never included, 500 = reverted completely (atomic) → nothing moved
  return 'unknown'; // 600 partial or anything else: stop, look at the explorer, never resend
}

/** After a batch: every ERC-20 leg must have its exact Transfer(fan → payee, amount) in the receipts. */
export function checkBatchReceipts({ asset, fan, legs, receipts }) {
  if (asset.kind !== 'erc20') return { ok: false, reason: 'native batches are not verified this way' };
  const rs = Array.isArray(receipts) ? receipts : [];
  if (!rs.length) return { ok: false, reason: 'the wallet returned no receipts' };
  if (rs.some((r) => !(r.status === '0x1' || r.status === 1 || r.status === 'success'))) return { ok: false, reason: 'a call in the batch reverted' };
  const logs = rs.flatMap((r) => r.logs ?? []);
  const used = new Set();
  for (const leg of legs) {
    const i = logs.findIndex((l, k) => !used.has(k) && sameAddress(l.address, asset.address) && (l.topics ?? [])[0]?.toLowerCase() === TRANSFER_TOPIC
      && sameAddress(topicAddr(l.topics[1]), fan) && sameAddress(topicAddr(l.topics[2]), leg.to) && (() => { try { return BigInt(l.data) === BigInt(leg.amount); } catch { return false; } })());
    if (i < 0) return { ok: false, reason: `no matching transfer to ${leg.label} in the batch` };
    used.add(i);
  }
  return { ok: true };
}

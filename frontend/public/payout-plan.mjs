// /payout — pure helpers. An artist changes the Hedera payout on THEIR OWN <label>.osoartist.eth:
// read the current records, build the exact resolver calls, and check who may sign. Nothing here
// signs or sends; the page hands the finished transaction to the artist's own wallet.
//
// The calldata is the same as ens/src/plan.mjs (setAddress / setText on the artist's
// PermissionedResolver, ENSv2 DNS-encoded names), bundled into ONE multicall so the artist signs once.
// The payout priority it must respect is resolvePayTo() in ens/src/resolve-artist.mjs:
//   addr(3030) Hedera account  >  addr(ENSIP-11 Hedera EVM for that network)  >  addr(60)
// so "pay my wallet address" must CLEAR an old addr(3030), or the old account would keep winning.
import { decodeErrorResult, decodeFunctionResult, encodeFunctionData, getAddress, isAddress, namehash } from './vendor/viem-ens.min.js';

export const PARENT_NAME = 'osoartist.eth';
/** osoartist.eth's live UserRegistry (ens/ENS-PROOF.md); /fork/registry.json can override it. */
export const DEFAULT_REGISTRY = '0xE9d4002cb12a53b50FAA244Cf801Ced40D7c3b48';
export const UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
/** Browser-friendly public Ethereum RPCs (CORS), tried in order. Same set the tip Worker falls back to. */
export const PUBLIC_RPCS = Object.freeze(['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth']);

export const COIN = Object.freeze({
  ETH: 60n,
  HBAR: 3030n, // SLIP-44: 20 bytes = shard u32 | realm u64 | num u64 (no network inside — hence hedera.network)
  HEDERA_TESTNET_EVM: 0x80000128n, // ENSIP-11, EVM chain 296
  HEDERA_MAINNET_EVM: 0x80000127n, // ENSIP-11, EVM chain 295
});
export const TEXT = Object.freeze({ network: 'hedera.network', consent: 'oso.consent', stewardStatus: 'oso.steward.status' });
export const NETWORKS = Object.freeze(['testnet', 'mainnet']);

const RESOLVER_ABI = [
  { type: 'function', name: 'setAddress', stateMutability: 'nonpayable', inputs: [{ name: 'name', type: 'bytes' }, { name: 'coinType', type: 'uint256' }, { name: 'addressBytes', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'setText', stateMutability: 'nonpayable', inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }], outputs: [] },
  { type: 'function', name: 'multicall', stateMutability: 'nonpayable', inputs: [{ name: 'calls', type: 'bytes[]' }], outputs: [{ name: 'results', type: 'bytes[]' }] },
  { type: 'error', name: 'EACUnauthorizedAccountRoles', inputs: [{ name: 'resource', type: 'uint256' }, { name: 'roleBitmap', type: 'uint256' }, { name: 'account', type: 'address' }] },
];
const PROFILE_ABI = [
  { type: 'function', name: 'addr', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'coinType', type: 'uint256' }], outputs: [{ type: 'bytes' }] },
  { type: 'function', name: 'text', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }], outputs: [{ type: 'string' }] },
];
const UR_ABI = [
  { type: 'function', name: 'resolve', stateMutability: 'view', inputs: [{ name: 'name', type: 'bytes' }, { name: 'data', type: 'bytes' }], outputs: [{ type: 'bytes' }, { type: 'address' }] },
  { type: 'function', name: 'findResolver', stateMutability: 'view', inputs: [{ name: 'name', type: 'bytes' }], outputs: [{ name: 'resolver', type: 'address' }, { name: 'node', type: 'bytes32' }, { name: 'offset', type: 'uint256' }] },
];
const REGISTRY_ABI = [
  { type: 'function', name: 'findOwner', stateMutability: 'view', inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
];
export const ABIS = Object.freeze({ resolver: RESOLVER_ABI, profile: PROFILE_ABI, universalResolver: UR_ABI, registry: REGISTRY_ABI });

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ID_RE = /^(\d{1,10})\.(\d{1,20})\.(\d{1,20})$/;
const ZERO = '0x0000000000000000000000000000000000000000';

/** "Shaka" / "shaka.osoartist.eth" / " shaka " → "shaka". Throws on anything else. */
export function parseLabel(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (s.endsWith(`.${PARENT_NAME}`)) s = s.slice(0, -PARENT_NAME.length - 1);
  if (!LABEL_RE.test(s)) throw new Error(`a name label is lowercase a–z, 0–9 and inner hyphens (e.g. "shaka" for shaka.${PARENT_NAME})`);
  return s;
}

export const fullName = (label) => `${parseLabel(label)}.${PARENT_NAME}`;

/** RFC 1035 wire format; labels are ASCII-only here, so this equals ens/src/plan.mjs dnsEncode. */
export function dnsEncode(name) {
  const parts = String(name).split('.');
  let hex = '0x';
  for (const p of parts) {
    if (!/^[a-z0-9-]{1,63}$/.test(p)) throw new Error(`bad label "${p}"`);
    hex += p.length.toString(16).padStart(2, '0');
    for (const ch of p) hex += ch.charCodeAt(0).toString(16).padStart(2, '0');
  }
  return `${hex}00`;
}

export const isHederaAccountId = (s) => typeof s === 'string' && ID_RE.test(s.trim());

/** Same bytes as ens/src/hbar.mjs encodeHbar: "0.0.11345896" → 0x00000000 0000000000000000 0000000000ad1fe8. */
export function encodeHbar(accountId) {
  const m = ID_RE.exec(String(accountId ?? '').trim());
  if (!m) throw new Error(`not a Hedera account id (shard.realm.num, e.g. 0.0.12345): ${accountId}`);
  const [shard, realm, num] = m.slice(1).map(BigInt);
  if (shard > 0xffffffffn || realm > 0xffffffffffffffffn || num > 0xffffffffffffffffn) throw new Error(`Hedera account id out of range: ${accountId}`);
  return `0x${shard.toString(16).padStart(8, '0')}${realm.toString(16).padStart(16, '0')}${num.toString(16).padStart(16, '0')}`;
}

export function decodeHbar(hex) {
  const h = String(hex ?? '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{40}$/i.test(h)) return null;
  return `${BigInt(`0x${h.slice(0, 8)}`)}.${BigInt(`0x${h.slice(8, 24)}`)}.${BigInt(`0x${h.slice(24, 40)}`)}`;
}

export function evmCoinFor(network) {
  if (network === 'mainnet') return COIN.HEDERA_MAINNET_EVM;
  if (network === 'testnet') return COIN.HEDERA_TESTNET_EVM;
  throw new Error('network must be testnet or mainnet');
}

export const coinLabel = (coin) => ({
  [String(COIN.ETH)]: 'addr 60 · Ethereum',
  [String(COIN.HBAR)]: 'addr 3030 · Hedera account',
  [String(COIN.HEDERA_TESTNET_EVM)]: 'addr 0x80000128 · Hedera testnet EVM address',
  [String(COIN.HEDERA_MAINNET_EVM)]: 'addr 0x80000127 · Hedera mainnet EVM address',
})[String(coin)] ?? `addr ${coin}`;

const sameAddr = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

/** What resolvePayTo(name, {network}) would pick from these records (no consent/steward checks). */
export function effectivePayout(records, network) {
  if (records?.hbarAccount) return { path: 'hbar', payTo: records.hbarAccount };
  const evm = network === 'mainnet' ? records?.evmMainnet : records?.evmTestnet;
  if (evm) return { path: 'hedera-evm', payTo: evm };
  if (records?.eth) return { path: 'eth-alias', payTo: records.eth };
  return { path: null, payTo: null };
}

/**
 * The writes for one payout change, before any encoding.
 * @param {{label:string, network:'testnet'|'mainnet', mode:'account'|'wallet', accountId?:string, walletAddress?:string,
 *          current?: object|null}} input  current = readRecords() result (null = unknown → clear defensively)
 */
export function planPayout({ label, network, mode, accountId, walletAddress, current = null }) {
  const name = fullName(label);
  evmCoinFor(network);
  const records = current?.records ?? null;
  const writes = [];
  if (mode === 'account') {
    const id = String(accountId ?? '').trim();
    writes.push({ kind: 'addr', coinType: COIN.HBAR, value: encodeHbar(id), human: `${id} (Hedera ${network} account)` });
  } else if (mode === 'wallet') {
    if (!isAddress(String(walletAddress ?? ''), { strict: false })) throw new Error('connect the wallet that owns the name first — its address becomes the payout');
    const addr = getAddress(walletAddress);
    // addr(3030) outranks the EVM record: an old Hedera account there would keep receiving tips.
    if (!records || records.hbarAccount || records.hbarRaw) writes.push({ kind: 'addr', coinType: COIN.HBAR, value: '0x', human: records?.hbarAccount ? `cleared (was ${records.hbarAccount})` : 'cleared (so it cannot outrank your wallet address)' });
    writes.push({ kind: 'addr', coinType: evmCoinFor(network), value: addr.toLowerCase(), human: `${addr} (your wallet address, paid as a Hedera ${network} alias — only your key can spend it)` });
  } else {
    throw new Error('choose a Hedera account or "my wallet address"');
  }
  writes.push({ kind: 'text', key: TEXT.network, value: network, human: network });
  const dns = dnsEncode(name);
  const calls = writes.map((w) => (w.kind === 'addr'
    ? encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'setAddress', args: [dns, w.coinType, w.value] })
    : encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'setText', args: [dns, w.key, w.value] })));
  const after = { ...(records ?? {}) };
  for (const w of writes) {
    if (w.kind === 'text') after.network = w.value;
    else if (w.coinType === COIN.HBAR) { after.hbarRaw = w.value === '0x' ? null : w.value; after.hbarAccount = w.value === '0x' ? null : decodeHbar(w.value); }
    else if (w.coinType === COIN.HEDERA_MAINNET_EVM) after.evmMainnet = getAddress(w.value);
    else if (w.coinType === COIN.HEDERA_TESTNET_EVM) after.evmTestnet = getAddress(w.value);
  }
  const warnings = [];
  if (records?.network && records.network !== network) {
    warnings.push(`Your name says hedera.network=${records.network} today. After this change tips on Hedera ${records.network} are refused and only Hedera ${network} tips are paid.`);
  }
  if (records && records.consent !== 'active') warnings.push(`oso.consent is "${records.consent ?? 'unset'}", so OSO will not route tips to this name until it is "active" (that is your separate choice).`);
  if (network === 'mainnet' && mode === 'wallet') warnings.push('USDC cannot reach a wallet-address alias until you activate that Hedera account with your own key; HBAR works right away.');
  if (network === 'mainnet' && mode === 'account') warnings.push('Double-check this is a Hedera MAINNET account you control (HashPack shows it). A testnet account number on mainnet is someone else\'s account.');
  return { name, label: parseLabel(label), network, mode, writes, calls, expected: effectivePayout(after, network), warnings };
}

/** One transaction to the artist's own resolver: multicall(calls). value 0. */
export function buildTx(plan, resolver) {
  if (!isAddress(String(resolver ?? ''), { strict: false }) || sameAddr(resolver, ZERO)) throw new Error('this name has no resolver');
  const data = plan.calls.length === 1 ? plan.calls[0] : encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'multicall', args: [plan.calls] });
  return { to: getAddress(resolver), value: '0x0', data };
}

/** Human, line-by-line description of exactly what will be written. */
export function describePlan(plan, resolver) {
  return [
    `on ${plan.name}, resolver ${resolver ?? '(unknown)'}, Ethereum mainnet:`,
    ...plan.writes.map((w) => (w.kind === 'addr' ? `  set ${coinLabel(w.coinType)} ← ${w.human}` : `  set text ${w.key} ← ${w.human}`)),
    `then a fan's tip on Hedera ${plan.network} pays: ${plan.expected.payTo ?? 'nobody (no payout record)'}${plan.expected.path ? ` (${plan.expected.path})` : ''}`,
  ];
}

/**
 * The signer gate: only the name's owner may be asked to sign, and the owner must be a real address.
 * (The resolver itself enforces the same thing; this just stops a doomed wallet prompt.)
 */
export function checkSigner({ owner, account }) {
  if (!owner || sameAddr(owner, ZERO)) return { ok: false, reason: 'this name is not registered (no owner)' };
  if (!account) return { ok: false, reason: 'connect your wallet' };
  if (!sameAddr(owner, account)) return { ok: false, reason: `the connected wallet ${account} is not the owner of this name (${getAddress(owner)}). Switch to the owner account in your wallet.` };
  return { ok: true, reason: 'connected wallet owns this name' };
}

/** Readable reason from a revert payload (eth_call / wallet error data). */
export function revertReason(data) {
  if (typeof data !== 'string' || !/^0x[0-9a-f]{8,}$/i.test(data)) return null;
  try {
    const e = decodeErrorResult({ abi: RESOLVER_ABI, data });
    if (e.errorName === 'EACUnauthorizedAccountRoles') return `the resolver refused: ${e.args[2]} does not hold the record roles on this name`;
    return e.errorName;
  } catch {
    return null;
  }
}

// ───────────────────────────── reads (JSON-RPC eth_call, no library client) ─────────────────────────────

/** Minimal JSON-RPC eth_call with URL fallback. Returns the hex result or throws {revert:data}. */
export function makeRpc(urls = PUBLIC_RPCS, fetchImpl = globalThis.fetch, timeoutMs = 12_000) {
  const list = (Array.isArray(urls) ? urls : String(urls).split(',')).map((u) => String(u).trim()).filter((u) => /^https?:\/\//.test(u));
  if (!list.length) throw new Error('no RPC URL');
  let id = 0;
  async function request(method, params) {
    let lastError = null;
    for (const url of list) {
      try {
        const r = await fetchImpl(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
        });
        if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
        const body = await r.json();
        if (body.error) {
          const data = typeof body.error.data === 'string' ? body.error.data : body.error.data?.data;
          if (data && /^0x[0-9a-f]*$/i.test(data) || /revert/i.test(body.error.message ?? '')) {
            const err = new Error(body.error.message || 'execution reverted');
            err.revert = data ?? '0x';
            throw err; // a revert is an answer, not an outage: don't try the next RPC
          }
          throw new Error(body.error.message || 'RPC error');
        }
        return body.result;
      } catch (e) {
        if (e?.revert !== undefined) throw e;
        lastError = e;
      }
    }
    throw lastError ?? new Error('RPC unavailable');
  }
  return {
    request,
    call: ({ to, data, from }) => request('eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest']),
  };
}

async function urResolve(rpc, dns, data) {
  try {
    const out = await rpc.call({ to: UNIVERSAL_RESOLVER, data: encodeFunctionData({ abi: UR_ABI, functionName: 'resolve', args: [dns, data] }) });
    const [result] = decodeFunctionResult({ abi: UR_ABI, functionName: 'resolve', data: out });
    return result;
  } catch (e) {
    if (e?.revert !== undefined) return null; // unset record / no resolver → treat as empty
    throw e;
  }
}

const decodeAddrBytes = (bytes) => {
  if (!bytes || bytes === '0x') return null;
  try {
    const v = decodeFunctionResult({ abi: PROFILE_ABI, functionName: 'addr', data: bytes });
    return v && v !== '0x' && !/^0x0*$/.test(v) ? v : null;
  } catch { return null; }
};
const decodeTextBytes = (bytes) => {
  if (!bytes || bytes === '0x') return null;
  try { const v = decodeFunctionResult({ abi: PROFILE_ABI, functionName: 'text', data: bytes }); return v === '' ? null : v; } catch { return null; }
};
const toEvm = (hex) => (hex && /^0x[0-9a-f]{40}$/i.test(hex) ? getAddress(hex) : null);

/** Owner, resolver and every payout-relevant record of <label>.osoartist.eth, as ENS resolves them. */
export async function readRecords(label, { rpc = makeRpc(), registry = DEFAULT_REGISTRY } = {}) {
  const name = fullName(label);
  const dns = dnsEncode(name);
  const node = namehash(name);
  const ownerHex = await rpc.call({ to: getAddress(registry), data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'findOwner', args: [parseLabel(label)] }) });
  const owner = decodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'findOwner', data: ownerHex });
  let resolver = null;
  try {
    const out = await rpc.call({ to: UNIVERSAL_RESOLVER, data: encodeFunctionData({ abi: UR_ABI, functionName: 'findResolver', args: [dns] }) });
    const [r] = decodeFunctionResult({ abi: UR_ABI, functionName: 'findResolver', data: out });
    resolver = sameAddr(r, ZERO) ? null : getAddress(r);
  } catch (e) {
    if (e?.revert === undefined) throw e;
  }
  const addr = (coin) => urResolve(rpc, dns, encodeFunctionData({ abi: PROFILE_ABI, functionName: 'addr', args: [node, coin] })).then(decodeAddrBytes);
  const text = (key) => urResolve(rpc, dns, encodeFunctionData({ abi: PROFILE_ABI, functionName: 'text', args: [node, key] })).then(decodeTextBytes);
  const [eth, hbarRaw, evmTestnet, evmMainnet, network, consent, stewardStatus] = resolver
    ? await Promise.all([addr(COIN.ETH), addr(COIN.HBAR), addr(COIN.HEDERA_TESTNET_EVM), addr(COIN.HEDERA_MAINNET_EVM), text(TEXT.network), text(TEXT.consent), text(TEXT.stewardStatus)])
    : [null, null, null, null, null, null, null];
  return {
    name,
    label: parseLabel(label),
    owner: sameAddr(owner, ZERO) ? null : getAddress(owner),
    resolver,
    records: {
      eth: toEvm(eth),
      hbarRaw: hbarRaw ?? null,
      hbarAccount: hbarRaw ? decodeHbar(hbarRaw) : null,
      evmTestnet: toEvm(evmTestnet),
      evmMainnet: toEvm(evmMainnet),
      network,
      consent,
      stewardStatus,
    },
  };
}

/** Dry-run the exact tx from the connected account. {ok:true} or {ok:false, reason}. */
export async function simulate(rpc, tx, from) {
  try {
    await rpc.call({ ...tx, from });
    return { ok: true };
  } catch (e) {
    if (e?.revert !== undefined) return { ok: false, reason: revertReason(e.revert) ?? e.message ?? 'the resolver would revert' };
    throw e;
  }
}

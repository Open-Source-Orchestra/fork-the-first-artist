// 💸 ENS reads for the multichain tip — Ethereum mainnet only, read-only, no wallet involved.
// Who gets paid is never typed, guessed or stored by this site: it is read live from the artist's
// own ENS name `<label>.osoartist.eth` (their resolver, their records) and from osoartist.eth for
// the steward. Fails closed:
//   · no consent text → not tippable; paused steward status → not tippable;
//   · every answer must come from TWO independent public RPCs that agree exactly (one bad RPC can't
//     redirect a tip); a transport error is an error, never "no record";
//   · offchain lookups (CCIP-read) are off, so a resolver can't make visitors' browsers fetch other URLs.
import { DEFAULT_EVM_COIN, coinTypeFor, ADDRESS_RE } from './tip-core.mjs';

export const UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe'; // ENSv2, ens/src/constants.mjs
export const TEXT_CONSENT = 'oso.consent';
export const TEXT_STEWARD_STATUS = 'oso.steward.status';
export const BLOCKING = new Set(['paused', 'frozen', 'disputed', 'revoked', 'suspended']);
export const ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'; // Chainlink ETH / USD (8 dec), ethskills/addresses
const FEED_ABI = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }];

let viemP = null;
export function loadViem() {
  viemP ??= import('./vendor/viem-tip.min.js');
  return viemP;
}

/** One client PER RPC (no fallback): the caller compares their answers. */
export async function makeClients(rpcUrls) {
  const v = await loadViem();
  return rpcUrls.filter((u) => /^https:\/\//.test(u)).map((u) => Object.assign(
    v.createPublicClient({ chain: v.mainnet, transport: v.http(u, { timeout: 12_000, retryCount: 1 }), batch: { multicall: false }, ccipRead: false }),
    { host: new URL(u).host },
  ));
}

const rpcError = (name, e) => Object.assign(new Error(`could not read ${name} right now (${String(e?.shortMessage ?? e?.message ?? e).slice(0, 80)}) — try again`), { code: 'rpc' });

/** One RPC's view of a name. Throws {code:'rpc'} on any transport error — never silently "no record". */
async function readOne(client, v, norm, chainIds) {
  const ur = { universalResolverAddress: UNIVERSAL_RESOLVER };
  const addr = async (coinType) => {
    const a = await client.getEnsAddress({ name: norm, coinType, ...ur });
    if (a == null || /^0x0{40}$/i.test(a)) return null;
    if (!ADDRESS_RE.test(a)) throw Object.assign(new Error(`${norm} has a malformed address record`), { code: 'bad-record' });
    return v.getAddress(a); // EIP-55, so this page shows what the wallet shows
  };
  const text = async (key) => {
    const t = await client.getEnsText({ name: norm, key, ...ur });
    return t ? String(t) : null;
  };
  const extra = chainIds.filter((id) => id !== 1);
  const [consent, stewardStatus, eth, defaultEvm, ...specific] = await Promise.all([
    text(TEXT_CONSENT), text(TEXT_STEWARD_STATUS), addr(60n), addr(DEFAULT_EVM_COIN), ...extra.map((id) => addr(coinTypeFor(id))),
  ]);
  const perChain = { 1: eth };
  extra.forEach((id, i) => { perChain[id] = specific[i]; });
  const code = (a) => (a ? client.getCode({ address: a }).then((c) => c ?? '0x') : Promise.resolve(null));
  const [ethCodeOnMainnet, defaultCodeOnMainnet] = await Promise.all([code(eth), code(defaultEvm)]);
  return { name: norm, consent, stewardStatus: stewardStatus ?? null, eth, defaultEvm, perChain, ethCodeOnMainnet, defaultCodeOnMainnet };
}

/**
 * Read everything needed to pay an ENS name on `chainIds` (ENSIP-11 per chain, ENSIP-19 default, coin 60) from
 * at least TWO independent RPCs and require identical answers. Throws {code} on a hard stop.
 */
export async function readName(clients, name, chainIds = [], { requireConsent = true } = {}) {
  const v = await loadViem();
  let norm;
  try {
    norm = v.normalize(name);
  } catch {
    throw Object.assign(new Error(`${name} is not a valid ENS name`), { code: 'bad-name' });
  }
  const answers = [];
  let lastErr = null;
  for (const c of clients) {
    try {
      answers.push(JSON.stringify(await readOne(c, v, norm, chainIds)));
    } catch (e) {
      if (e?.code === 'bad-record') throw e;
      lastErr = e;
    }
    if (answers.length >= 2) break;
  }
  if (answers.length < 2) throw rpcError(norm, lastErr ?? 'only one Ethereum RPC answered');
  if (answers[0] !== answers[1]) throw Object.assign(new Error(`two Ethereum RPCs gave different answers for ${norm} — refusing to pay until they agree`), { code: 'rpc-disagree' });
  const r = JSON.parse(answers[0]);
  if (requireConsent && r.consent !== 'active') throw Object.assign(new Error(`${norm} has not switched on tips (text ${TEXT_CONSENT} is ${r.consent ?? 'unset'})`), { code: 'no-consent' });
  if (r.stewardStatus && BLOCKING.has(String(r.stewardStatus).toLowerCase())) throw Object.assign(new Error(`${norm} has paused payments through Open Source Orchestra`), { code: 'paused' });
  return r;
}

/** Chainlink ETH/USD on Ethereum mainnet → { answer (8 dec), updatedAt } or null. Display only, never used for amounts. */
export async function readEthUsd(clients) {
  for (const client of clients) {
    try {
      const [desc, round] = await Promise.all([
        client.readContract({ address: ETH_USD_FEED, abi: FEED_ABI, functionName: 'description' }),
        client.readContract({ address: ETH_USD_FEED, abi: FEED_ABI, functionName: 'latestRoundData' }),
      ]);
      if (desc !== 'ETH / USD') return null;
      return { answer: round[1], updatedAt: round[3] };
    } catch { /* next RPC */ }
  }
  return null;
}

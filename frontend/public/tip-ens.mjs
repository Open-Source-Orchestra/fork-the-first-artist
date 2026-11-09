// 💸 ENS reads for the multichain tip — Ethereum mainnet only, read-only, no wallet involved.
// Who gets paid is never typed, guessed or stored by this site: it is read live from the artist's
// own ENS name `<label>.osoartist.eth` (their resolver, their records) and from osoartist.eth for
// the steward. Fails closed: no consent text → not tippable; paused steward status → not tippable.
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

export async function makeClient(rpcUrls) {
  const v = await loadViem();
  const urls = rpcUrls.filter((u) => /^https:\/\//.test(u));
  return createWith(v, urls);
}
function createWith(v, urls) {
  return v.createPublicClient({ chain: v.mainnet, transport: v.fallback(urls.map((u) => v.http(u, { timeout: 12_000, retryCount: 1 }))), batch: { multicall: false } });
}

const nz = (a) => (typeof a === 'string' && ADDRESS_RE.test(a) && !/^0x0{40}$/i.test(a) ? a : null);

/**
 * Read everything needed to pay an ENS name on `chainIds` (ENSIP-11 per chain, ENSIP-19 default, coin 60).
 * Returns { name, consent, stewardStatus, eth, defaultEvm, perChain: {id: addr|null}, ethCodeOnMainnet }.
 * Throws {code} on a hard stop so the caller can show the reason.
 */
export async function readName(client, name, chainIds = [], { requireConsent = true } = {}) {
  const v = await loadViem();
  let norm;
  try {
    norm = v.normalize(name);
  } catch {
    throw Object.assign(new Error(`${name} is not a valid ENS name`), { code: 'bad-name' });
  }
  const ur = { universalResolverAddress: UNIVERSAL_RESOLVER };
  // EIP-55 checksummed, so what the fan reads on this page matches what their wallet shows
  const addr = (coinType) => client.getEnsAddress({ name: norm, coinType, ...ur }).then(nz).then((a) => (a ? v.getAddress(a) : null)).catch(() => null);
  const text = (key) => client.getEnsText({ name: norm, key, ...ur }).then((t) => (t ? String(t) : null)).catch(() => undefined);
  const extra = chainIds.filter((id) => id !== 1);
  const [consent, stewardStatus, eth, defaultEvm, ...specific] = await Promise.all([
    text(TEXT_CONSENT), text(TEXT_STEWARD_STATUS), addr(60n), addr(DEFAULT_EVM_COIN), ...extra.map((id) => addr(coinTypeFor(id))),
  ]);
  if (consent === undefined) throw Object.assign(new Error(`could not read ${norm} right now — try again`), { code: 'rpc' });
  if (requireConsent && consent !== 'active') throw Object.assign(new Error(`${norm} has not switched on tips (text ${TEXT_CONSENT} is ${consent ?? 'unset'})`), { code: 'no-consent' });
  if (stewardStatus && BLOCKING.has(String(stewardStatus).toLowerCase())) throw Object.assign(new Error(`${norm} has paused payments through Open Source Orchestra`), { code: 'paused' });
  const perChain = { 1: eth };
  extra.forEach((id, i) => { perChain[id] = specific[i]; });
  let ethCodeOnMainnet = null;
  if (eth) ethCodeOnMainnet = await client.getCode({ address: eth }).then((c) => c ?? '0x').catch(() => null);
  return { name: norm, consent, stewardStatus: stewardStatus ?? null, eth, defaultEvm, perChain, ethCodeOnMainnet };
}

/** Chainlink ETH/USD on Ethereum mainnet → { answer (8 dec), updatedAt } or null. Display only, never used for amounts. */
export async function readEthUsd(client) {
  try {
    const [desc, round] = await Promise.all([
      client.readContract({ address: ETH_USD_FEED, abi: FEED_ABI, functionName: 'description' }),
      client.readContract({ address: ETH_USD_FEED, abi: FEED_ABI, functionName: 'latestRoundData' }),
    ]);
    if (desc !== 'ETH / USD') return null;
    return { answer: round[1], updatedAt: round[3] };
  } catch {
    return null;
  }
}

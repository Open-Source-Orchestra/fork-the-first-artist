// resolvePayTo(name): ENS name -> Hedera payout for the x402 fan payment. Fails CLOSED.
//
// Works for ANY ENS name (an artist's own existing .eth or <label>.osoartist.eth) — the OSO subname is an
// optional identity, not a requirement to get paid. Resolution goes through the ENS Universal Resolver
// (ENSv2 on mainnet), so the artist's own resolver is the only source of truth.
//
// Payout path, first match wins:
//   1. 'hbar'        addr(coinType 3030)            -> Hedera account 0.0.N
//   2. 'hedera-evm'  addr(ENSIP-11 0x80000128/7)     -> 20-byte EVM address, paid as a Hedera ALIAS
//   3. 'eth-alias'   addr(coinType 60)              -> the name's ETH address, paid as a Hedera ALIAS
// Paying an alias auto-creates a hollow Hedera account that ONLY that Ethereum key can finalize/spend —
// OSO never takes custody.
//
// Fail closed when: no payout record; artist consent text `oso.consent` is not "active" (requireConsent);
// `oso.steward.status` says the OSO service is paused/frozen/disputed/revoked; `hedera.network` disagrees
// with the network we pay on; an external claim check says not active; or an expected account mismatches.
import { createPublicClient, fallback, http, getAddress, namehash } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { ADDR, COIN, TEXT } from './constants.mjs';
import { decodeHbar } from './hbar.mjs';

export class PayToError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PayToError';
    this.code = code;
    this.detail = detail;
  }
}

export const BLOCKING_STEWARD_STATUS = new Set(['paused', 'frozen', 'disputed', 'revoked', 'suspended']);
const RECORD_ID_ABI = [{ type: 'function', name: 'getRecordId', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'uint256' }] }];

/** One RPC URL, or a comma-separated list tried in order (viem fallback) — public RPCs rate-limit shared egress IPs. */
export function makeClient(rpcUrl = globalThis.process?.env?.ENS_RPC_URL ?? 'https://ethereum-rpc.publicnode.com') {
  const urls = String(rpcUrl).split(',').map((u) => u.trim()).filter(Boolean);
  // batch: the ~9 reads of one resolution go out as ONE JSON-RPC batch request per endpoint (public RPCs rate-limit bursts)
  const transport = urls.length > 1
    ? fallback(urls.map((u) => http(u, { timeout: 10_000, retryCount: 2, retryDelay: 400, batch: { wait: 10 } })))
    : http(urls[0], { timeout: 20_000, batch: { wait: 10 } });
  return createPublicClient({ chain: mainnet, transport, batch: { multicall: false } });
}

const isZeroHex = (h) => !h || /^0x0*$/i.test(h);

async function addr(client, name, coinType) {
  const v = await client.getEnsAddress({ name, coinType, universalResolverAddress: ADDR.UniversalResolver });
  return isZeroHex(v) ? null : v;
}

async function text(client, name, key) {
  const v = await client.getEnsText({ name, key, universalResolverAddress: ADDR.UniversalResolver });
  return v === '' || v == null ? null : v;
}

/**
 * @param {string} name ENS name
 * @param {object} opts
 * @param {object} [opts.client]          viem public client (or mock with getEnsAddress/getEnsText/getEnsResolver/readContract)
 * @param {'testnet'|'mainnet'} [opts.network='testnet'] Hedera network we are about to pay on
 * @param {boolean} [opts.requireConsent=true]  require text oso.consent == "active"
 * @param {(r)=>Promise<{active:boolean,reason?:string}>} [opts.claimCheck] external claim/consent state (e.g. Arkiv)
 * @param {string} [opts.expectAccount] fail if the resolved payTo differs (operator pin)
 */
export async function resolvePayTo(name, opts = {}) {
  const network = opts.network ?? 'testnet';
  const requireConsent = opts.requireConsent ?? true;
  const client = opts.client ?? makeClient(opts.rpcUrl);
  let norm;
  try {
    norm = normalize(String(name ?? ''));
  } catch (e) {
    throw new PayToError('bad-name', `not a valid ENS name: ${name} (${e.message})`);
  }
  if (!norm.includes('.')) throw new PayToError('bad-name', `not a full ENS name: ${name}`);

  const evmCoin = network === 'mainnet' ? COIN.HEDERA_MAINNET_EVM : COIN.HEDERA_TESTNET_EVM;
  const [hbarHex, hederaEvm, ethAddr, netText, topic, consent, stewardStatus, stewardUrl, resolver] = await Promise.all([
    addr(client, norm, COIN.HBAR),
    addr(client, norm, evmCoin),
    addr(client, norm, COIN.ETH),
    text(client, norm, TEXT.network),
    text(client, norm, TEXT.hcsTopic),
    text(client, norm, TEXT.consent),
    text(client, norm, TEXT.stewardStatus),
    text(client, norm, TEXT.stewardUrl),
    client.getEnsResolver({ name: norm, universalResolverAddress: ADDR.UniversalResolver }).catch(() => null),
  ]);

  let recordId = null;
  if (resolver && client.readContract) {
    try {
      recordId = String(await client.readContract({ address: resolver, abi: RECORD_ID_ABI, functionName: 'getRecordId', args: [namehash(norm)] }));
    } catch {
      recordId = null; // not a PermissionedResolver — fine, recordId is informational
    }
  }

  const base = { name: norm, network, hcsTopic: topic, resolver: resolver ?? null, recordId, consent, stewardStatus, stewardUrl };

  if (netText && netText !== network) {
    throw new PayToError('network-mismatch', `${norm} says hedera.network=${netText}, refusing to pay on ${network}`, base);
  }
  if (requireConsent && consent !== 'active') {
    throw new PayToError('no-consent', `${norm} has no active artist consent (text ${TEXT.consent}=${consent ?? 'unset'})`, base);
  }
  if (stewardStatus && BLOCKING_STEWARD_STATUS.has(stewardStatus.toLowerCase())) {
    throw new PayToError('steward-paused', `${norm} OSO service status is "${stewardStatus}" — payments through OSO are paused`, base);
  }

  let out;
  if (hbarHex) {
    let id;
    try {
      id = decodeHbar(hbarHex);
    } catch (e) {
      throw new PayToError('bad-record', `${norm} addr(3030) is malformed: ${e.message}`, base);
    }
    out = { ...base, path: 'hbar', coinType: String(COIN.HBAR), hederaAccountId: id, hederaAlias: null, payTo: id };
  } else if (hederaEvm) {
    const a = getAddress(hederaEvm);
    out = { ...base, path: 'hedera-evm', coinType: String(evmCoin), hederaAccountId: null, hederaAlias: a, payTo: a };
  } else if (ethAddr) {
    const a = getAddress(ethAddr);
    out = { ...base, path: 'eth-alias', coinType: String(COIN.ETH), hederaAccountId: null, hederaAlias: a, payTo: a };
  } else {
    throw new PayToError('no-payout', `${norm} has no HBAR (3030), Hedera EVM (${evmCoin}) or ETH (60) address record`, base);
  }

  if (opts.claimCheck) {
    const c = await opts.claimCheck(out);
    if (!c?.active) throw new PayToError('claim-inactive', `claim state for ${norm} is not active${c?.reason ? `: ${c.reason}` : ''}`, out);
  }
  if (opts.expectAccount && String(opts.expectAccount).toLowerCase() !== String(out.payTo).toLowerCase()) {
    throw new PayToError('mismatch', `${norm} resolves to ${out.payTo}, expected ${opts.expectAccount}`, out);
  }
  return out;
}

/** Compact, public-safe summary for HCS memos / logs (no secrets exist in it anyway). */
export function ensMemo(r) {
  return { name: r.name, path: r.path, payTo: r.payTo, resolver: r.resolver, recordId: r.recordId };
}

// CLI: node ens/src/resolve-artist.mjs <name> [--network testnet] [--rpc URL] [--no-consent]
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  resolvePayTo(a[0], { network: opt('--network', 'testnet'), rpcUrl: opt('--rpc'), requireConsent: !a.includes('--no-consent') })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(JSON.stringify({ error: e.code ?? 'error', message: e.message }));
      process.exit(2);
    });
}

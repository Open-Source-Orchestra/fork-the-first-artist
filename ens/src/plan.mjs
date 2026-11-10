// Transaction builders for the ENSv2 leg. Pure functions: they return {to, data, value} and never sign.
// Used by the fork test, the batch onboarding script and the signing kit, so all three use the SAME calldata.
import { encodeFunctionData, getAddress, keccak256, namehash, toBytes, toHex, concat } from 'viem';
import { normalize } from 'viem/ens';
import {
  ADDR, COIN, PARENT, RES, TEXT, RESOLVER_OWNER_ROLES, ARTIST_TOKEN_ROLES, USER_REGISTRY_ROOT, REG, loadAbi,
} from './constants.mjs';
import { encodeHbar } from './hbar.mjs';

export const ABI = {
  factory: loadAbi('VerifiableFactory'),
  userRegistry: loadAbi('UserRegistryImpl'),
  resolver: loadAbi('PermissionedResolverImpl'),
  ethRegistry: loadAbi('ETHRegistry'),
};

/** RFC 1035 wire-format name (what ENSv2 resolvers and the Universal Resolver take). */
export function dnsEncode(name) {
  const norm = normalize(name);
  const parts = norm.split('.').map((l) => {
    const b = toBytes(l);
    if (b.length === 0 || b.length > 255) throw new Error(`bad label in ${name}`);
    return concat([toHex(b.length, { size: 1 }), toHex(b)]);
  });
  return concat([...parts, '0x00']);
}

/** Deterministic VerifiableFactory salt per purpose + name (same input -> same proxy address). */
export function saltFor(purpose, name) {
  return BigInt(keccak256(toBytes(`oso.fork-the-first-artist/${purpose}/${normalize(name)}`)));
}

export function subname(label) {
  const l = normalize(label);
  if (l.includes('.')) throw new Error(`label must be a single label: ${label}`);
  return `${l}.${PARENT.name}`;
}

const deploy = (implementation, salt, data) => ({
  to: ADDR.VerifiableFactory,
  value: 0n,
  data: encodeFunctionData({ abi: ABI.factory, functionName: 'deployProxy', args: [implementation, salt, data] }),
});

// ─────────────────────────────── registry (osoartist.eth subregistry) ───────────────────────────────

/** initialize(grants) for the osoartist.eth UserRegistry. No UPGRADE role to anyone → emancipated + frozen. */
export function userRegistryInit({ registrar, parentOwner = PARENT.owner }) {
  const grants = [
    { account: getAddress(registrar), roleBitmap: USER_REGISTRY_ROOT.registrar },
    { account: getAddress(parentOwner), roleBitmap: USER_REGISTRY_ROOT.parentOwner },
  ];
  return encodeFunctionData({ abi: ABI.userRegistry, functionName: 'initialize', args: [grants] });
}

export function deployUserRegistryTx({ registrar, parentOwner, salt = saltFor('user-registry', PARENT.name) }) {
  return deploy(ADDR.UserRegistryImpl, salt, userRegistryInit({ registrar, parentOwner }));
}

export function setParentTx({ registry }) {
  return {
    to: getAddress(registry),
    value: 0n,
    data: encodeFunctionData({ abi: ABI.userRegistry, functionName: 'setParent', args: [ADDR.ETHRegistry, PARENT.label] }),
  };
}

/** Register <label>.osoartist.eth to the ARTIST's own address with full token roles. expiry: unix seconds. */
export function registerTx({ registry, label, owner, resolver, expiry, roleBitmap = ARTIST_TOKEN_ROLES }) {
  return {
    to: getAddress(registry),
    value: 0n,
    data: encodeFunctionData({
      abi: ABI.userRegistry,
      functionName: 'register',
      args: [normalize(label), getAddress(owner), '0x0000000000000000000000000000000000000000', getAddress(resolver), roleBitmap, BigInt(expiry)],
    }),
  };
}

// ─────────────────────────────── Shaka's transactions (parent owner) ───────────────────────────────

/** THE activation tx: point osoartist.eth's subregistry at the OSO UserRegistry. Signed by 0x2596 only. */
export function setSubregistryTx({ parentTokenId, registry }) {
  return {
    to: ADDR.ETHRegistry,
    value: 0n,
    data: encodeFunctionData({ abi: ABI.ethRegistry, functionName: 'setSubregistry', args: [BigInt(parentTokenId), getAddress(registry)] }),
  };
}

/** OPTIONAL, IRREVERSIBLE: parent owner gives up the ability to re-point osoartist.eth's subregistry. */
export function lockSubregistryTx({ parentTokenId, account = PARENT.owner }) {
  return {
    to: ADDR.ETHRegistry,
    value: 0n,
    data: encodeFunctionData({
      abi: ABI.ethRegistry,
      functionName: 'revokeRoles',
      args: [BigInt(parentTokenId), REG.SET_SUBREGISTRY | REG.admin(REG.SET_SUBREGISTRY), getAddress(account)],
    }),
  };
}

// ─────────────────────────────── per-artist PermissionedResolver ───────────────────────────────

const enc = (functionName, args) => encodeFunctionData({ abi: ABI.resolver, functionName, args });

/**
 * Records + grants for ONE artist's own resolver, all applied inside initialize() (role checks are skipped
 * while initializing). Payout priority written here mirrors resolvePayTo():
 *   hederaAccountId → addr(3030)   else   ethAddress → addr(0x80000128) (Hedera testnet EVM alias)
 * coin 60 is always the artist's own Ethereum address.
 *
 * The steward agent gets ONLY the `oso.steward.status` text setter. grantSetterRoles() checks the caller's
 * admin roles even during init, and the caller is the VerifiableFactory, so the factory is given
 * SET_TEXT_ADMIN for the duration of this one transaction and revokes it as the LAST call. Final state:
 * artist = every role + admin; steward = setText("oso.steward.status") only; factory/OSO/deployer = nothing.
 */
export function artistResolverInit({
  name, artist, steward, hederaAccountId, hederaEvm, network = 'testnet', hcsTopic, url, stewardUrl,
  consentHash, extraTexts = {},
}) {
  const dns = dnsEncode(name);
  const owner = getAddress(artist);
  const calls = [enc('setAddress', [dns, COIN.ETH, owner])];
  if (hederaAccountId) calls.push(enc('setAddress', [dns, COIN.HBAR, encodeHbar(hederaAccountId)]));
  const evm = hederaEvm === undefined ? (hederaAccountId ? null : owner) : hederaEvm;
  if (evm) calls.push(enc('setAddress', [dns, network === 'mainnet' ? COIN.HEDERA_MAINNET_EVM : COIN.HEDERA_TESTNET_EVM, getAddress(evm)]));
  const texts = {
    [TEXT.network]: network,
    ...(hcsTopic ? { [TEXT.hcsTopic]: hcsTopic } : {}),
    ...(url ? { [TEXT.url]: url } : {}),
    ...(stewardUrl ? { [TEXT.stewardUrl]: stewardUrl } : {}),
    [TEXT.consent]: 'active',
    ...(consentHash ? { 'oso.consent.hash': consentHash } : {}),
    ...extraTexts,
  };
  for (const [k, v] of Object.entries(texts)) calls.push(enc('setText', [dns, k, String(v)]));
  const grants = [{ account: owner, roleBitmap: RESOLVER_OWNER_ROLES }];
  if (steward) {
    grants.push({ account: ADDR.VerifiableFactory, roleBitmap: RES.admin(RES.SET_TEXT) });
    calls.push(enc('grantSetterRoles', [enc('setText', [dns, TEXT.stewardStatus, '']), getAddress(steward)]));
    calls.push(enc('revokeRootRoles', [RES.admin(RES.SET_TEXT), ADDR.VerifiableFactory]));
  }
  return { data: enc('initialize', [grants, calls]), grants, calls, texts };
}

export function deployArtistResolverTx(opts) {
  const salt = opts.salt ?? saltFor('resolver', opts.name);
  const { data } = artistResolverInit(opts);
  return { ...deploy(ADDR.PermissionedResolverImpl, salt, data), salt };
}

/** Steward-agent write: the only thing its key can do on the artist's resolver. */
export function setStewardStatusTx({ resolver, name, status }) {
  return { to: getAddress(resolver), value: 0n, data: enc('setText', [dnsEncode(name), TEXT.stewardStatus, status]) };
}

export function setAddressTx({ resolver, name, coinType, value }) {
  return { to: getAddress(resolver), value: 0n, data: enc('setAddress', [dnsEncode(name), BigInt(coinType), value]) };
}

export { namehash };
